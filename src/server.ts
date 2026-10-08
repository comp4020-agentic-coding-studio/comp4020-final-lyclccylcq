import { existsSync, readFileSync } from "node:fs";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { extname, join } from "node:path";
import { aiProvider } from "./ai.ts";
import { clearCookie, COOKIE, createAuth, readCookie, sessionCookie, type User } from "./auth.ts";
import { createCopilot } from "./copilot.ts";
import { openDb } from "./db.ts";
import { HttpError } from "./errors.ts";
import { computeRouteOptions, DEMO_PLACES, googleConfigured, placeDetails, searchPlaces } from "./google.ts";
import { renderMarkdown } from "./markdown.ts";
import { createHub } from "./realtime.ts";
import { zonedTimeToUtc } from "./schedule.ts";
import { createTripStore, type TripSnapshot } from "./trips.ts";

const db = openDb();
const auth = createAuth(db);
const hub = createHub();
const trips = createTripStore(db, Date.now, (tripId) => {
  let snap: TripSnapshot | null = null;
  try {
    snap = trips.snapshot(tripId);
  } catch {
    snap = null; // the trip was deleted
  }
  hub.publish(tripId, snap, (userId) => trips.roleOf(tripId, userId) !== null);
});
const copilot = createCopilot(aiProvider());
const port = Number(process.env.PORT ?? 8080);

const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".webp": "image/webp",
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

// Files only by a plain name (no slashes, no dots up front), so nothing
// outside the folder can be asked for.
function serveFile(res: ServerResponse, dir: string, name: string): boolean {
  if (!/^[\w-][\w.-]*$/.test(name)) return false;
  const path = join(dir, name);
  if (!existsSync(path)) return false;
  send(res, 200, readFileSync(path), TYPES[extname(name)] ?? "application/octet-stream");
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
    });
  }

  if (method === "POST" && (path === "/api/auth/signup" || path === "/api/auth/login")) {
    const input = await body(req);
    const { user, token } = path.endsWith("signup") ? await auth.signup(input) : await auth.login(input);
    return json(res, path.endsWith("signup") ? 201 : 200, { user }, { "set-cookie": sessionCookie(token, isSecure(req)) });
  }
  if (method === "POST" && path === "/api/auth/logout") {
    auth.logout(readCookie(req.headers.cookie, COOKIE));
    return json(res, 200, { ok: true }, { "set-cookie": clearCookie(isSecure(req)) });
  }

  const user: User | null = auth.userForToken(readCookie(req.headers.cookie, COOKIE));
  if (!user) return json(res, 401, { error: "Sign in to continue." });

  if (method === "GET" && path === "/api/auth/me") return json(res, 200, { user });

  if (path === "/api/trips") {
    if (method === "GET") return json(res, 200, trips.list(user.id));
    if (method === "POST") {
      const snap = trips.create(user.id, await body(req));
      await locateDestination(snap);
      return json(res, 201, trips.snapshot(snap.id));
    }
  }

  if (method === "GET" && path === "/api/places/search") {
    const query = (url.searchParams.get("q") ?? "").trim();
    if (query.length < 2 || query.length > 120) throw new HttpError(400, "Search for at least two characters.");
    const tripId = url.searchParams.get("tripId");
    const center = tripId ? trips.view(user.id, tripId).center : null;
    return json(res, 200, await searchPlaces(query, center));
  }
  let m = path.match(/^\/api\/places\/([^/]+)$/);
  if (method === "GET" && m) return json(res, 200, await placeDetails(decodeURIComponent(m[1])));

  m = path.match(/^\/api\/invites\/([A-Za-z0-9_-]+)(\/accept)?$/);
  if (m) {
    if (method === "GET" && !m[2]) return json(res, 200, trips.previewInvite(user.id, m[1]));
    if (method === "POST" && m[2]) return json(res, 200, { tripId: trips.acceptInvite(user.id, m[1]) });
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
    return hub.join(tripId, user, res, snap);
  }

  if (rest === "/invite") {
    if (method === "POST") return json(res, 201, { token: trips.createInvite(user.id, tripId) });
    if (method === "DELETE") {
      trips.revokeInvite(user.id, tripId);
      return json(res, 200, { ok: true });
    }
  }

  let r = rest.match(/^\/members\/([0-9a-f-]{36})$/);
  if (method === "DELETE" && r) {
    trips.removeMember(user.id, tripId, r[1]);
    return json(res, 200, { ok: true });
  }

  if (method === "POST" && rest === "/activities") {
    const { created, activityId, trip } = trips.addActivity(user.id, tripId, await body(req));
    return json(res, created ? 201 : 200, { activityId, trip });
  }
  r = rest.match(/^\/activities\/([0-9a-f-]{36})(\/move)?$/);
  if (r) {
    if (method === "PATCH" && !r[2]) return json(res, 200, trips.updateActivity(user.id, tripId, r[1], await body(req)));
    if (method === "DELETE" && !r[2]) return json(res, 200, trips.deleteActivity(user.id, tripId, r[1]));
    if (method === "POST" && r[2]) return json(res, 200, trips.moveActivity(user.id, tripId, r[1], await body(req)));
  }

  if (method === "POST" && rest === "/routes") return json(res, 200, await calculateRoute(user, tripId, await body(req)));

  r = rest.match(/^\/segments\/([0-9a-f-]{36})\/mode$/);
  if (method === "POST" && r) return json(res, 200, trips.selectMode(user.id, tripId, r[1], (await body(req)).mode));

  if (method === "POST" && rest === "/proposals/apply") {
    const input = await body(req);
    return json(res, 200, trips.applyProposal(user.id, tripId, input.dayId, input.proposalId));
  }

  if (method === "POST" && rest === "/copilot") {
    const input = await body(req);
    const snap = trips.view(user.id, tripId);
    const day = snap.days.find((d) => d.id === input.dayId);
    if (!day) throw new HttpError(404, "That day isn't part of this trip.");
    if (!copilot.configured) {
      return json(res, 503, {
        configured: false,
        error: "AI suggestions need an AI provider key on the server (ANTHROPIC_API_KEY). The schedule checks above are rule-based and work without it.",
      });
    }
    if (day.analysis.issues.length === 0) {
      return json(res, 200, { configured: true, rev: snap.rev, model: copilot.model, answer: null, note: "No scheduling problems to explain on this day." });
    }
    try {
      const { answer, cached } = await copilot.ask(user.id, day, snap);
      return json(res, 200, { configured: true, rev: snap.rev, model: copilot.model, cached, answer });
    } catch (err) {
      const status = (err as { status?: number }).status ?? 502;
      return json(res, status, { configured: true, error: err instanceof Error ? err.message : "The copilot failed." });
    }
  }

  json(res, 404, { error: "No such endpoint." });
}

async function calculateRoute(user: User, tripId: string, input: Record<string, unknown>): Promise<TripSnapshot> {
  if (!googleConfigured()) {
    throw new HttpError(503, "Route calculation needs Google Maps configured on the server (GOOGLE_MAPS_SERVER_KEY). No route was estimated.");
  }
  const reqInfo = trips.routeRequest(user.id, tripId, input.fromId, input.toId);
  if (reqInfo.from.place?.source !== "google" || reqInfo.to.place?.source !== "google") {
    throw new HttpError(400, "Demo places aren't real Google places, so routes can't be calculated between them.");
  }
  // Already calculated for this departure: no new API calls.
  if (reqInfo.existing && reqInfo.existing.departKey === reqInfo.departKey && input.force !== true) return trips.snapshot(tripId);

  const key = `${reqInfo.from.id}>${reqInfo.to.id}|${reqInfo.departKey}`;
  const running = inflight.get(key);
  if (running) return running;
  const job = (async () => {
    const departure = reqInfo.departMin === null ? null : zonedTimeToUtc(reqInfo.date, reqInfo.departMin, reqInfo.timezone);
    const options = await computeRouteOptions(reqInfo.from.place!.placeId, reqInfo.to.place!.placeId, departure);
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
    console.warn("couldn't locate destination:", err instanceof Error ? err.message : err);
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

const APP_PAGES = /^\/(login|trips\/[0-9a-f-]{36}|join\/[A-Za-z0-9_-]+)?$/;

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", "http://localhost");
  const { pathname } = url;
  try {
    if (pathname.startsWith("/api/")) return await api(req, res, url);
    if (req.method !== "GET" && req.method !== "HEAD") return send(res, 405, "Method not allowed", "text/plain");
    if (pathname === "/readme") {
      res.writeHead(301, { location: "/readme/" });
      return res.end();
    }
    if (pathname === "/readme/") return send(res, 200, readmePage(), TYPES[".html"]);
    if (pathname.startsWith("/readme/docs/") && serveFile(res, "docs", pathname.slice(13))) return;
    if (APP_PAGES.test(pathname)) return void serveFile(res, "public", "index.html");
    if (serveFile(res, "public", pathname.slice(1))) return;
    send(res, 404, "Not found", "text/plain; charset=utf-8");
  } catch (err) {
    if (res.headersSent) return void res.end();
    if (err instanceof HttpError) return json(res, err.status, { error: err.message, ...err.details });
    console.error(err);
    json(res, 500, { error: "Something went wrong on our side." });
  }
});

server.listen(port, "0.0.0.0", () => console.log(`Wayline listening on http://localhost:${port}`));

// Fly stops the machine when nobody's around; close streams and the database cleanly.
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    hub.closeAll();
    server.close();
    db.close();
    process.exit(0);
  });
}
