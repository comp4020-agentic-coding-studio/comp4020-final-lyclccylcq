import { existsSync, readFileSync } from "node:fs";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { extname, join } from "node:path";
import { aiProvider } from "./ai.ts";
import { AiLimitError, createAiUsage, limitsFromEnv, pricesFromEnv } from "./aiusage.ts";
import { clearCookie, COOKIE, createAuth, readCookie, sessionCookie, type User } from "./auth.ts";
import { createCalls, iceConfigured, iceServersFor } from "./calls.ts";
import { cleanHistory, createCopilot, describeAiError, detectLang, LIMITS } from "./copilot.ts";
import { openDb } from "./db.ts";
import { HttpError } from "./errors.ts";
import { createDiscovery } from "./discovery.ts";
import { computeRouteOptions, DEMO_PLACES, googleConfigured, mapsKeyWarnings, placeDetails, searchPlaces } from "./google.ts";
import { createPlanner } from "./planner.ts";
import { createPlanning } from "./planning.ts";
import { createPreferences } from "./preferences.ts";
import { createItineraryStore } from "./itineraries.ts";
import { createPublications } from "./publications.ts";
import { afterEvent, flushAfter, log, note, sanitize, setUser, shortId, withRequest } from "./log.ts";
import { renderMarkdown } from "./markdown.ts";
import { clientIp, createLimiter } from "./ratelimit.ts";
import { createHub } from "./realtime.ts";
import { ERROR_CODES, logRequest } from "./request-log.ts";
import { zonedTimeToUtc } from "./schedule.ts";
import { createTripStore, type TripSnapshot } from "./trips.ts";

const db = openDb();
const auth = createAuth(db);
const hub = createHub({
  onJoin: (tripId, userId, session) => calls.joined(tripId, userId, session),
  onLeave: (tripId, userId, session) => calls.left(tripId, userId, session),
  log: { ...log, afterEvent },
});
const trips = createTripStore(
  db,
  Date.now,
  (tripId) => {
    let snap: TripSnapshot | null = null;
    try {
      snap = trips.snapshot(tripId);
    } catch {
      snap = null; // the trip was deleted
    }
    hub.publish(tripId, snap, (userId) => trips.roleOf(tripId, userId) !== null);
    calls.checkTrip(tripId);
  },
  // only a count goes down the person's own stream; the page then asks for
  // the list with its own session
  (userId) => hub.toUser(userId, "invitations", { pending: trips.pendingFor(userId).length, requests: trips.requestsToMe(userId).length }),
);
const isMember = (tripId: string, userId: string): boolean => {
  try {
    return trips.roleOf(tripId, userId) !== null;
  } catch {
    return false;
  }
};
// Voice-call signalling (ADR 0004): targeted events on the SSE hub, state in memory only.
const calls = createCalls({
  send: (tripId, userId, session, data) => hub.sendTo(tripId, userId, session, "call", data),
  hasSession: hub.hasSession,
  isOnline: hub.isOnline,
  isMember,
  nameOf: (tripId, userId) => {
    try {
      return trips.snapshot(tripId).members.find((m) => m.id === userId)?.displayName ?? null;
    } catch {
      return null;
    }
  },
});
const itineraries = createItineraryStore(db);
itineraries.seed();
const publications = createPublications(db, trips);
const discovery = createDiscovery({ itineraries, trips, publications });
const joinLimit = createLimiter(20, 60_000); // join requests per person per minute
// AI: one provider (src/ai.ts, key from the environment only) and one
// app-wide budget in SQLite (src/aiusage.ts) shared by every AI feature.
const ai = aiProvider();
const aiUsage = createAiUsage(db, limitsFromEnv(process.env, ai?.timeoutMs), pricesFromEnv());
const aiLog = (level: "info" | "warn", event: string, fields: Record<string, unknown>) => log[level](event, fields);
const copilot = createCopilot(ai, { usage: aiUsage, log: aiLog });
const planner = createPlanner(ai, { usage: aiUsage, log: aiLog });
const preferences = createPreferences(db, (tripId, userId) => trips.roleOf(tripId, userId));
const planning = createPlanning({ trips, preferences, planner, calculateRoute });
const callLimit = createLimiter(60, 60_000); // invites, answers and hang-ups per person per minute
const iceLimit = createLimiter(20, 60_000);
const searchLimit = createLimiter(60, 60_000); // nickname searches per owner per minute
const inviteLimit = createLimiter(30, 60_000);
const availabilityLimit = createLimiter(60, 60_000); // per IP, before an account exists
const port = Number(process.env.PORT ?? 8080);

const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".webp": "image/webp",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
};

const BASE_HEADERS = {
  "x-content-type-options": "nosniff",
  "referrer-policy": "strict-origin-when-cross-origin",
  "x-frame-options": "DENY",
};

function send(res: ServerResponse, status: number, body: string | Buffer, type: string, headers: Record<string, string | string[]> = {}): void {
  res.writeHead(status, { ...BASE_HEADERS, "content-type": type, "cache-control": "no-cache", ...headers });
  res.end(body);
}

const json = (res: ServerResponse, status: number, data: unknown, headers: Record<string, string | string[]> = {}): void =>
  send(res, status, JSON.stringify(data), "application/json; charset=utf-8", headers);

// Files only by a plain name (no slashes, no dots up front), under one of a
// few known folders at most, so nothing outside them can be asked for.
function serveFile(res: ServerResponse, dir: string, name: string, range?: string): boolean {
  if (!/^((img\/covers|img\/train|video)\/)?[\w-][\w.-]*$/.test(name)) return false;
  const path = join(dir, name);
  if (!existsSync(path)) return false;
  // media doesn't change in place (a new file gets a new name), so browsers may keep it
  const media = name.startsWith("img/") || name.startsWith("video/");
  const cache: Record<string, string> = media ? { "cache-control": "public, max-age=604800" } : {};
  const type = TYPES[extname(name)] ?? "application/octet-stream";
  const body = readFileSync(path);
  // video players ask for byte ranges (Safari won't play without them)
  if (name.startsWith("video/")) {
    const m = range?.match(/^bytes=(\d*)-(\d*)$/);
    if (m && (m[1] || m[2])) {
      const size = body.length;
      const start = m[1] ? Number(m[1]) : Math.max(0, size - Number(m[2]));
      const end = m[1] && m[2] ? Math.min(Number(m[2]), size - 1) : size - 1;
      if (start > end || start >= size) {
        res.writeHead(416, { ...BASE_HEADERS, "content-range": `bytes */${size}` });
        return void res.end(), true;
      }
      res.writeHead(206, { ...BASE_HEADERS, ...cache, "content-type": type, "accept-ranges": "bytes", "content-range": `bytes ${start}-${end}/${size}`, "content-length": String(end - start + 1) });
      res.end(body.subarray(start, end + 1));
      return true;
    }
    send(res, 200, body, type, { ...cache, "accept-ranges": "bytes" });
    return true;
  }
  send(res, 200, body, type, cache);
  return true;
}

// README.md, rendered fresh each time so the page never drifts from the file.
function readmePage(): string {
  return `<!doctype html>
<html lang="en-AU">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>About · Wayline</title>
<link rel="icon" href="/favicon.svg">
<link rel="stylesheet" href="/styles.css">
</head>
<body class="readme-page">
<header class="topbar"><a class="brand" href="/"><span class="brand-mark" aria-hidden="true"></span>Wayline</a><nav><a href="/">Open Wayline</a></nav></header>
<main class="readme">
${renderMarkdown(readFileSync("README.md", "utf8"))}
</main>
</body>
</html>`;
}

async function body(req: IncomingMessage): Promise<Record<string, unknown>> {
  let raw = "";
  for await (const chunk of req) {
    raw += chunk;
    if (raw.length > 20_000) throw new HttpError(413, "That request is too large.");
  }
  try {
    const parsed: unknown = raw ? JSON.parse(raw) : {};
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed as Record<string, unknown>;
  } catch {
    // fall through
  }
  throw new HttpError(400, "Send a JSON object.");
}

// Browsers can't send a cross-site request with a JSON content type without
// a CORS preflight, which this server never grants; with SameSite cookies,
// that keeps other sites from acting as a signed-in user.
// A request with no body (a DELETE) carries no content type; browsers always
// attach an Origin to a cross-site one, which the second check catches.
function checkWriteOrigin(req: IncomingMessage): void {
  const type = req.headers["content-type"];
  const hasBody = Number(req.headers["content-length"] ?? 0) > 0 || req.headers["transfer-encoding"] !== undefined;
  if ((type !== undefined || hasBody) && !(type ?? "").includes("application/json")) {
    throw new HttpError(415, "Send JSON (content-type: application/json).");
  }
  const origin = req.headers.origin;
  if (origin && new URL(origin).host !== req.headers.host) throw new HttpError(403, "Cross-site requests aren't allowed.");
}

const isSecure = (req: IncomingMessage): boolean => req.headers["x-forwarded-proto"] === "https";

// One route lookup per pair and departure at a time, however many clicks.
const inflight = new Map<string, Promise<TripSnapshot>>();

async function api(req: IncomingMessage, res: ServerResponse, url: URL): Promise<void> {
  const method = req.method ?? "GET";
  const path = url.pathname;
  if (method !== "GET" && method !== "HEAD") checkWriteOrigin(req);

  if (method === "GET" && path === "/api/config") {
    return json(res, 200, {
      mapsBrowserKey: process.env.GOOGLE_MAPS_BROWSER_KEY || null,
      mapId: process.env.GOOGLE_MAPS_MAP_ID || "DEMO_MAP_ID",
      places: googleConfigured() ? "google" : "demo",
      routes: googleConfigured(),
      ai: { configured: copilot.configured, model: copilot.model },
      calls: { enabled: true, relay: iceConfigured().turn !== null },
    });
  }

  if (method === "POST" && (path === "/api/auth/signup" || path === "/api/auth/login")) {
    const input = await body(req);
    const { user, token } = path.endsWith("signup") ? await auth.signup(input) : await auth.login(input);
    setUser(user);
    return json(res, path.endsWith("signup") ? 201 : 200, { user }, { "set-cookie": sessionCookie(token, isSecure(req)) });
  }
  // sign-up form feedback; the insert still has the final say
  if (method === "GET" && path === "/api/auth/available") {
    availabilityLimit(clientIp(req));
    return json(res, 200, auth.availability({ username: url.searchParams.get("username") ?? undefined, displayName: url.searchParams.get("displayName") ?? undefined }));
  }
  if (method === "POST" && path === "/api/auth/logout") {
    const leaving = auth.userForToken(readCookie(req.headers.cookie, COOKIE));
    setUser(leaving);
    if (leaving) calls.endFor(leaving.id, "signed-out");
    if (leaving) hub.closeUser(leaving.id);
    auth.logout(readCookie(req.headers.cookie, COOKIE));
    return json(res, 200, { ok: true }, { "set-cookie": clearCookie(isSecure(req)) });
  }

  const maybeUser: User | null = auth.userForToken(readCookie(req.headers.cookie, COOKIE));
  setUser(maybeUser);
  const found = await discovery(req, url, maybeUser, () => body(req));
  if (found) {
    // a fork or a copy answers with the new trip: name it in the log line
    const made = found.status === 201 && (found.data as { rev?: unknown; id?: unknown }).rev !== undefined ? (found.data as { id: string }).id : null;
    if (made) note({ tripId: made });
    return json(res, found.status, found.data);
  }

  if (!maybeUser) return json(res, 401, { error: "Sign in to continue." });
  const user: User = maybeUser;

  if (method === "GET" && path === "/api/auth/me") return json(res, 200, { user });

  // a person's own travel preferences: private to them
  if (path === "/api/me/preferences") {
    if (method === "GET") return json(res, 200, { preferences: preferences.mine(user.id) });
    if (method === "PUT") return json(res, 200, { preferences: preferences.saveMine(user.id, await body(req)) });
  }

  // AI usage for the developer: totals and limits, no prompts, keys or content.
  // Only accounts named in WAYLINE_AI_ADMINS (comma-separated usernames).
  if (method === "GET" && path === "/api/admin/ai-usage") {
    const admins = (process.env.WAYLINE_AI_ADMINS ?? "").split(",").map((x) => x.trim().toLowerCase()).filter(Boolean);
    if (!admins.includes(user.username.toLowerCase())) return json(res, 404, { error: "No such endpoint." });
    return json(res, 200, aiUsage.summary());
  }

  if (path === "/api/trips") {
    if (method === "GET") return json(res, 200, trips.list(user.id));
    if (method === "POST") {
      const snap = trips.create(user.id, await body(req));
      note({ tripId: snap.id });
      await locateDestination(snap);
      return json(res, 201, trips.snapshot(snap.id));
    }
  }

  // invitations addressed to me (by username, from a trip's owner)
  if (method === "GET" && path === "/api/me/events") return hub.joinUser(user.id, res, { pending: trips.pendingFor(user.id).length, requests: trips.requestsToMe(user.id).length }, user.username);
  if (method === "GET" && path === "/api/invitations") {
    return json(res, 200, { invitations: trips.pendingFor(user.id), requests: trips.requestsToMe(user.id), myRequests: trips.myJoinRequests(user.id) });
  }
  let m = path.match(/^\/api\/invitations\/([0-9a-f-]{36})\/(accept|decline)$/);
  if (method === "POST" && m) {
    if (m[2] === "accept") {
      const joined = trips.acceptInvitation(user.id, m[1]);
      note({ tripId: joined });
      return json(res, 200, { tripId: joined });
    }
    trips.declineInvitation(user.id, m[1]);
    return json(res, 200, { ok: true });
  }

  // An invite link: see whose trip it is, then ask to join. Never joins by itself.
  m = path.match(/^\/api\/invites\/([A-Za-z0-9_-]+)(\/request|\/accept)?$/);
  if (m) {
    if (method === "GET" && !m[2]) {
      const p = trips.previewInvite(user.id, m[1]);
      if (p.state === "expired") note({ event: "INVITATION_EXPIRED", action: "open_expired_link", message: "User opened an invite link that has expired" });
      return json(res, 200, p);
    }
    if (method === "POST" && m[2]) {
      joinLimit(user.id);
      const r = trips.requestToJoin(user.id, m[1]);
      note({ tripId: r.tripId, requestId: r.requestId, ...(r.created ? {} : { event: "COLLAB_REQUEST_REPEATED", message: "User asked again while a request was still pending" }) });
      // the requester isn't a member: they get the request's state, not the trip
      return json(res, r.created ? 201 : 200, { requestId: r.requestId, status: r.status });
    }
  }

  m = path.match(/^\/api\/trips\/([0-9a-f-]{36})(\/.*)?$/);
  if (!m) return json(res, 404, { error: "No such endpoint." });
  const tripId = m[1];
  const rest = m[2] ?? "";

  if (rest === "") {
    if (method === "GET") {
      const snap = trips.view(user.id, tripId);
      void refreshStalePlaces(tripId);
      return json(res, 200, snap);
    }
    if (method === "PATCH") return json(res, 200, trips.update(user.id, tripId, await body(req)));
    if (method === "DELETE") {
      trips.remove(user.id, tripId);
      return json(res, 200, { ok: true });
    }
  }

  if (method === "GET" && rest === "/events") {
    const snap = trips.view(user.id, tripId);
    const session = url.searchParams.get("session");
    return hub.join(tripId, user, res, snap, session && /^[A-Za-z0-9-]{8,64}$/.test(session) ? session : null);
  }

  // Where this tab's map is looking, for the other people on the trip. Not
  // saved, not a revision, never a location from the device.
  if (method === "POST" && rest === "/view") {
    trips.requireMember(tripId, user.id);
    const v = await body(req);
    const num = (x: unknown, lo: number, hi: number) => typeof x === "number" && Number.isFinite(x) && x >= lo && x <= hi;
    if (typeof v.session !== "string" || !/^[A-Za-z0-9-]{8,64}$/.test(v.session) || !num(v.lat, -90, 90) || !num(v.lng, -180, 180) || !num(v.zoom, 0, 23) || !num(v.heading ?? 0, -360, 360)) {
      throw new HttpError(400, "Invalid map view.");
    }
    const round = (x: number) => Math.round(x * 1e5) / 1e5;
    const [lat, lng, zoom] = [v.lat, v.lng, v.zoom] as number[];
    const ok = hub.setView(tripId, user.id, v.session, { lat: round(lat), lng: round(lng), zoom: Math.round(zoom * 10) / 10, heading: Math.round(Number(v.heading ?? 0)) });
    return json(res, ok ? 200 : 409, ok ? { ok: true } : { error: "Open the trip first." });
  }

  if (rest === "/invite") {
    if (method === "GET") return json(res, 200, { link: trips.inviteLink(user.id, tripId) });
    if (method === "POST") {
      const { token, link } = trips.createInvite(user.id, tripId);
      note({ linkId: link.id, expiresAt: new Date(link.expiresAt).toISOString() });
      return json(res, 201, { token, link });
    }
    if (method === "DELETE") {
      trips.revokeInvite(user.id, tripId);
      return json(res, 200, { ok: true });
    }
  }

  // requests to join through a link: the owner approves or rejects each one
  if (method === "GET" && rest === "/requests") return json(res, 200, { requests: trips.joinRequests(user.id, tripId) });
  let jr = rest.match(/^\/requests\/([0-9a-f-]{36})\/(approve|reject)$/);
  if (method === "POST" && jr) {
    const d = trips.decideJoinRequest(user.id, tripId, jr[1], jr[2] as "approve" | "reject");
    note({ requestId: jr[1], targetUserId: d.requesterId });
    if (d.status === "approved") afterEvent(() => log.info("COLLABORATOR_ADDED", { tripId, targetUserId: d.requesterId, action: "add_collaborator", status: "success", message: "Approved requester is now a collaborator" }));
    return json(res, 200, { status: d.status, requests: trips.joinRequests(user.id, tripId) });
  }

  // publishing: a snapshot of the trip, separate from the working copy
  if (rest === "/publication") {
    if (method === "GET") return json(res, 200, { publication: publications.forTrip(user.id, tripId) });
    if (method === "PUT") {
      const p = publications.publish(user.id, tripId, await body(req));
      note({ publicationId: p.id, ...(p.republished ? { event: "TRIP_REPUBLISHED", action: "republish_trip", message: "Owner updated the published version of the trip" } : {}) });
      return json(res, p.republished ? 200 : 201, { publication: publications.forTrip(user.id, tripId) });
    }
    if (method === "DELETE") {
      note({ publicationId: publications.unpublish(user.id, tripId).id });
      return json(res, 200, { publication: publications.forTrip(user.id, tripId) });
    }
  }

  // inviting an existing account by nickname: owner only (checked in the store)
  if (method === "GET" && rest === "/invitees") {
    searchLimit(user.id);
    return json(res, 200, trips.searchInvitees(user.id, tripId, url.searchParams.get("q")));
  }
  if (rest === "/invitations") {
    if (method === "GET") return json(res, 200, { invitations: trips.invitationsFor(user.id, tripId) });
    if (method === "POST") {
      inviteLimit(user.id);
      return json(res, 201, trips.inviteUser(user.id, tripId, await body(req)));
    }
  }
  let r = rest.match(/^\/invitations\/([0-9a-f-]{36})$/);
  if (method === "DELETE" && r) {
    trips.cancelInvitation(user.id, tripId, r[1]);
    return json(res, 200, { ok: true });
  }

  r = rest.match(/^\/members\/([0-9a-f-]{36})$/);
  if (method === "DELETE" && r) {
    trips.removeMember(user.id, tripId, r[1]);
    note(r[1] === user.id ? { targetUserId: r[1] } : { targetUserId: r[1], event: "COLLABORATOR_REMOVED", action: "remove_collaborator", message: "Owner removed a collaborator; their access and live streams were cut off" });
    return json(res, 200, { ok: true });
  }

  if (method === "POST" && rest === "/activities") {
    const { created, activityId, trip } = trips.addActivity(user.id, tripId, await body(req));
    // a replayed clientId changes nothing, so it isn't a second "added"
    note(created ? { activityId } : { activityId, event: "TRIP_DESTINATION_ADD_REPLAYED", message: "Retry of an add that already happened; nothing changed" });
    return json(res, created ? 201 : 200, { activityId, trip });
  }
  if (method === "PUT" && rest === "/start") return json(res, 200, trips.setStart(user.id, tripId, await body(req)));
  r = rest.match(/^\/activities\/([0-9a-f-]{36})\/place$/);
  if (method === "PUT" && r) return json(res, 200, trips.setPlace(user.id, tripId, r[1], await body(req)));
  r = rest.match(/^\/activities\/([0-9a-f-]{36})(\/move)?$/);
  if (r) {
    if (method === "PATCH" && !r[2]) {
      const input = await body(req);
      // which fields changed, never their contents (notes can be personal)
      const fields = ["title", "kind", "startMin", "durationMin", "notes", "meal"].filter((k) => input[k] !== undefined);
      const timing = fields.some((k) => k === "startMin" || k === "durationMin");
      note({ fields, ...(timing ? { event: "TRIP_SCHEDULE_MODIFIED", action: "change_time", message: "User changed a stop's time or length" } : {}) });
      return json(res, 200, trips.updateActivity(user.id, tripId, r[1], input));
    }
    if (method === "DELETE" && !r[2]) return json(res, 200, trips.deleteActivity(user.id, tripId, r[1]));
    if (method === "POST" && r[2]) return json(res, 200, trips.moveActivity(user.id, tripId, r[1], await body(req)));
  }

  if (method === "POST" && rest === "/routes") return json(res, 200, await calculateRoute(user, tripId, await body(req)));

  r = rest.match(/^\/segments\/([0-9a-f-]{36})\/mode$/);
  if (method === "POST" && r) return json(res, 200, trips.selectMode(user.id, tripId, r[1], (await body(req)).mode));

  if (method === "POST" && rest === "/proposals/apply") {
    const input = await body(req);
    return json(res, 200, trips.applyProposal(user.id, tripId, input.dayId, input.proposalId, input.basedOn));
  }

  // Review a day or answer a question about it. Works whether or not the
  // day has issues; the deterministic analysis is returned alongside so the
  // numbers shown come from the server, not the model.
  // shared trip choices (transport, pace, budget, interests); never food or allergies
  if (rest === "/preferences") {
    if (method === "GET") return json(res, 200, { trip: preferences.forTrip(user.id, tripId), effective: preferences.effective(user.id, tripId) });
    if (method === "PUT") {
      preferences.saveTrip(user.id, tripId, await body(req));
      return json(res, 200, { trip: preferences.forTrip(user.id, tripId), effective: preferences.effective(user.id, tripId) });
    }
  }

  // The planning assistant (src/planning.ts): a preview, then an apply of
  // exactly that preview.
  if (method === "POST" && rest === "/plan") {
    const r = await planning.draft(user, tripId, await body(req), res);
    return json(res, r.status, r.data);
  }
  if (method === "POST" && rest === "/plan/apply") return json(res, 200, planning.apply(user, tripId, await body(req)));

  if (method === "POST" && rest === "/copilot") {
    const input = await body(req);
    const snap = trips.view(user.id, tripId);
    const day = snap.days.find((d) => d.id === input.dayId);
    if (!day) throw new HttpError(404, "That day isn't part of this trip.");
    if (!copilot.configured) {
      return json(res, 503, { configured: false, error: "AI answers aren't available on this server. The schedule check works without it." });
    }
    if (input.question !== undefined && typeof input.question !== "string") throw new HttpError(400, "Send the question as text.");
    const question = String(input.question ?? "").trim();
    if (question.length > LIMITS.question) throw new HttpError(400, `Keep the question under ${LIMITS.question} characters.`);
    const lang = detectLang(question, input.lang);
    const ac = new AbortController();
    res.on("close", () => {
      if (!res.writableEnded) ac.abort();
    });
    try {
      const r = await copilot.ask({ userId: user.id, tripId, day, trip: snap, question, history: cleanHistory(input.history), lang, signal: ac.signal });
      return json(res, 200, { configured: true, rev: snap.rev, dayId: day.id, fingerprint: r.fingerprint, model: copilot.model, cached: r.cached, lang: r.lang, question, answer: r.answer });
    } catch (err) {
      const status = (err as { status?: number }).status;
      if (status === 429 || status === 503) return json(res, status, { configured: true, error: (err as Error).message, retry: status === 429 });
      const d = describeAiError(err);
      if (d.status !== 499) log.warn("COPILOT_PROVIDER_ERROR", { tripId, action: "ask_copilot", status: "failure", errorCode: "AI_PROVIDER_ERROR", message: sanitize(err) });
      return json(res, d.status, { configured: true, error: d.error, retry: d.retry });
    }
  }

  // --- voice calls (signalling only; see ADR 0004) ---

  if (method === "GET" && rest === "/call") {
    trips.requireMember(tripId, user.id);
    return json(res, 200, { call: calls.stateFor(tripId, user.id) });
  }
  if (method === "POST" && rest === "/call/ice") {
    trips.requireMember(tripId, user.id);
    iceLimit(user.id);
    return json(res, 200, await iceServersFor(user.id), { "cache-control": "no-store" });
  }
  if (method === "POST" && rest === "/call") {
    trips.requireMember(tripId, user.id);
    callLimit(user.id);
    return json(res, 201, calls.invite(tripId, user.id, await body(req)));
  }
  r = rest.match(/^\/call\/([0-9a-f-]{36})\/(accept|decline|hangup|signal)$/);
  if (method === "POST" && r) {
    trips.requireMember(tripId, user.id);
    const input = await body(req);
    if (r[2] !== "signal") callLimit(user.id);
    if (r[2] === "accept") return json(res, 200, calls.accept(tripId, user.id, r[1], input));
    if (r[2] === "decline") return json(res, 200, calls.decline(tripId, user.id, r[1]));
    if (r[2] === "hangup") return json(res, 200, calls.hangup(tripId, user.id, r[1], input));
    return json(res, 200, calls.signal(tripId, user.id, r[1], input));
  }

  json(res, 404, { error: "No such endpoint." });
}

async function calculateRoute(user: User, tripId: string, input: Record<string, unknown>): Promise<TripSnapshot> {
  const reqInfo = trips.routeRequest(user.id, tripId, input.fromId, input.toId); // membership first
  if (!googleConfigured()) {
    throw new HttpError(503, "Route calculation needs Google Maps configured on the server (GOOGLE_MAPS_SERVER_KEY). No route was estimated.");
  }
  const routable = (p: typeof reqInfo.from.place) => p?.source === "google" || (p?.source === "custom" && p.lat !== null && p.lng !== null);
  if (!routable(reqInfo.from.place) || !routable(reqInfo.to.place)) {
    throw new HttpError(400, "Only places verified with Google or picked on the map can be routed; demo and curated-only places can't.");
  }
  // Already calculated for this departure: no new API calls.
  if (reqInfo.existing && reqInfo.existing.departKey === reqInfo.departKey && input.force !== true) return trips.snapshot(tripId);

  const key = `${reqInfo.from.id}>${reqInfo.to.id}|${reqInfo.departKey}`;
  const running = inflight.get(key);
  if (running) return running;
  const job = (async () => {
    const departure = reqInfo.departMin === null ? null : zonedTimeToUtc(reqInfo.date, reqInfo.departMin, reqInfo.timezone);
    // an untimed earlier stop: transit for midday on the trip's date, labelled as assumed
    const assumed = departure ? null : { at: zonedTimeToUtc(reqInfo.date, 12 * 60, reqInfo.timezone), label: `${reqInfo.date} 12:00` };
    // a custom point has no Google id, so it's routed by its coordinates
    const wp = (p: NonNullable<typeof reqInfo.from.place>) => (p.source === "custom" ? { lat: p.lat!, lng: p.lng! } : { placeId: p.placeId });
    const options = await computeRouteOptions(wp(reqInfo.from.place!), wp(reqInfo.to.place!), departure, Date.now(), assumed);
    return trips.saveRoute(user.id, tripId, reqInfo.from.id, reqInfo.to.id, reqInfo.departKey, options, reqInfo.existing?.selectedMode ?? null);
  })().finally(() => inflight.delete(key));
  inflight.set(key, job);
  return job;
}

// Centres the map on the destination: the first Google result for it, or,
// without a key, the demo fixtures when the destination is Sydney.
async function locateDestination(snap: TripSnapshot): Promise<void> {
  try {
    if (googleConfigured()) {
      const { places } = await searchPlaces(snap.destination, null);
      if (places[0]) trips.setCenter(snap.id, places[0]);
    } else if (/sydney/i.test(snap.destination)) {
      const lat = DEMO_PLACES.reduce((s, p) => s + p.lat, 0) / DEMO_PLACES.length;
      const lng = DEMO_PLACES.reduce((s, p) => s + p.lng, 0) / DEMO_PLACES.length;
      trips.setCenter(snap.id, { placeId: "demo:sydney", lat, lng });
    }
  } catch (err) {
    log.warn("TRIP_DESTINATION_LOOKUP_FAILED", { tripId: snap.id, action: "locate_destination", status: "failure", errorCode: "UPSTREAM_ERROR", message: sanitize(err) });
  }
}

// Google coordinates are a temporary copy; after 30 days they're re-fetched
// by place id the next time the trip is opened.
async function refreshStalePlaces(tripId: string): Promise<void> {
  if (!googleConfigured()) return;
  for (const p of trips.stalePlaces(tripId).slice(0, 10)) {
    try {
      const d = await placeDetails(p.placeId);
      trips.refreshPlace(tripId, p.id, d.lat, d.lng);
    } catch {
      // try again next time
    }
  }
}

const APP_PAGES =/^\/(login|privacy|credits|trips|trips\/[0-9a-f-]{36}|join\/[A-Za-z0-9_-]+|itineraries\/[a-z0-9-]{3,80}|experiments\/pixel-train)?$/;

const server = createServer((req, res) => withRequest(shortId("req"), () => handle(req, res)));

async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = new URL(req.url ?? "/", "http://localhost");
  const { pathname } = url;
  if (pathname.startsWith("/api/")) {
    const started = performance.now();
    let failure: unknown;
    // a stream's "response" lasts as long as the stream; the hub logs those
    const stream = pathname.endsWith("/events");
    if (!stream) {
      res.on("finish", () => logRequest(req.method ?? "GET", pathname, res.statusCode, started, failure));
      // the browser went away before the reply was sent: a broadcast may still be waiting
      res.on("close", () => {
        if (!res.writableFinished) flushAfter();
      });
    }
    try {
      return await api(req, res, url);
    } catch (err) {
      failure = err;
      respondError(res, err);
      if (stream) {
        const status = res.statusCode;
        log.warn("REALTIME_CONNECTION_FAILED", {
          tripId: pathname.match(/^\/api\/trips\/([0-9a-f-]{36})/)?.[1] ?? null,
          action: "sse_connect",
          status: status === 401 || status === 403 || status === 404 ? "denied" : "failure",
          errorCode: ERROR_CODES[status] ?? "INTERNAL_ERROR",
          httpStatus: status,
          message: sanitize(err instanceof Error ? err.message : err),
        });
      }
      return;
    }
  }
  try {
    if (req.method !== "GET" && req.method !== "HEAD") return send(res, 405, "Method not allowed", "text/plain");
    if (pathname === "/readme") {
      res.writeHead(301, { location: "/readme/" });
      return void res.end();
    }
    if (pathname === "/readme/") return send(res, 200, readmePage(), TYPES[".html"]);
    if (pathname.startsWith("/readme/docs/") && serveFile(res, "docs", pathname.slice(13))) return;
    if (APP_PAGES.test(pathname)) return void serveFile(res, "public", "index.html");
    if (serveFile(res, "public", pathname.slice(1), req.headers.range)) return;
    send(res, 404, "Not found", "text/plain; charset=utf-8");
  } catch (err) {
    respondError(res, err);
  }
}

function respondError(res: ServerResponse, err: unknown): void {
  if (res.headersSent) return void res.end();
  if (err instanceof HttpError) return json(res, err.status, { error: err.message, ...err.details });
  if (err instanceof AiLimitError) return json(res, err.status, { error: err.message, code: err.code });
  // the full stack stays on the server, sanitised; the user gets a plain message
  log.error("UNHANDLED_ERROR", { action: "request", status: "failure", errorCode: "INTERNAL_ERROR", message: sanitize(err), stack: err instanceof Error ? sanitize(err.stack, 2000) : undefined });
  json(res, 500, { error: "Something went wrong on our side." });
}

server.listen(port, "0.0.0.0", () => {
  // which integrations are on; never the key values
  const on = (v: string | undefined) => (v ? "set" : "missing");
  log.info("SERVER_STARTED", {
    action: "start",
    status: "success",
    message: `Wayline listening on http://localhost:${port}`,
    port,
    googleBrowserKey: on(process.env.GOOGLE_MAPS_BROWSER_KEY),
    googleServerKey: on(process.env.GOOGLE_MAPS_SERVER_KEY),
    mapId: process.env.GOOGLE_MAPS_MAP_ID ? "set" : "DEMO_MAP_ID",
    ai: on(process.env.OPENAI_API_KEY),
    aiModel: ai?.model ?? null,
    turn: iceConfigured().turn ?? "missing",
    stun: iceConfigured().stun ? "set" : "missing",
  });
  for (const w of mapsKeyWarnings()) log.warn("CONFIG_WARNING", { action: "start", status: "failure", errorCode: "CONFIG", message: w });
});

// Errors that escaped every handler: logged, never silently dropped.
process.on("uncaughtException", (err) => {
  log.error("UNCAUGHT_EXCEPTION", { action: "process", status: "failure", errorCode: "INTERNAL_ERROR", message: sanitize(err), stack: sanitize(err.stack, 2000) });
  process.exit(1);
});
process.on("unhandledRejection", (err) => {
  log.error("UNHANDLED_REJECTION", { action: "process", status: "failure", errorCode: "INTERNAL_ERROR", message: sanitize(err) });
});

// Fly stops the machine when nobody's around; close streams and the database cleanly.
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    log.info("SERVER_STOPPING", { action: "stop", status: "success", message: `Shutting down on ${signal}` });
    calls.closeAll();
    hub.closeAll();
    server.close();
    db.close();
    process.exit(0);
  });
}
