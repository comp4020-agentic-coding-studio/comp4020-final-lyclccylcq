import { createHmac, randomUUID } from "node:crypto";
import { HttpError } from "./errors.ts";

// Two-person voice calls between members of a trip (ADR 0004). This module
// is signalling only: who is calling whom, and relaying WebRTC session
// descriptions and ICE candidates between the two tabs in the call. Audio
// goes browser to browser (or through a TURN relay), never through here.
//
// Everything lives in memory and is gone when the call ends: no SDP, ICE
// candidate or audio is ever written down, and nothing here touches the
// itinerary or its revision. Like the SSE hub it rides on, this holds only
// while Fly runs one machine.

export type CallEvent = Record<string, unknown> & { type: string; callId: string };
type Send = (tripId: string, userId: string, session: string | null, data: CallEvent) => number;

type Party = { userId: string; name: string; session: string | null; muted: boolean };
type Call = {
  id: string;
  tripId: string;
  state: "ringing" | "active";
  caller: Party;
  callee: Party;
  createdAt: number;
  ringTimer: NodeJS.Timeout | null;
  graceTimers: Map<string, NodeJS.Timeout>; // userId -> pending drop after their tab vanished
  maxTimer: NodeJS.Timeout;
  seq: number;
  signals: Map<string, number[]>; // userId -> recent signal times
};

export type CallLimits = { ringMs: number; graceMs: number; maxMs: number; signalsPerMinute: number; descriptionBytes: number; candidateBytes: number };
const DEFAULTS: CallLimits = { ringMs: 30_000, graceMs: 20_000, maxMs: 4 * 3_600_000, signalsPerMinute: 240, descriptionBytes: 16_000, candidateBytes: 1_500 };

export const SESSION_RE = /^[A-Za-z0-9-]{8,64}$/;
const CALL_RE = /^[0-9a-f-]{36}$/;

export type CallDeps = {
  send: Send;
  hasSession: (tripId: string, userId: string, session: string) => boolean;
  isOnline: (tripId: string, userId: string) => boolean;
  isMember: (tripId: string, userId: string) => boolean;
  nameOf: (tripId: string, userId: string) => string | null;
  limits?: Partial<CallLimits>;
};

export function createCalls(deps: CallDeps) {
  const L = { ...DEFAULTS, ...deps.limits };
  const calls = new Map<string, Call>();
  const byUser = new Map<string, string>(); // userId -> the one call they're in (ringing or active)

  const party = (c: Call, userId: string): Party | null => (c.caller.userId === userId ? c.caller : c.callee.userId === userId ? c.callee : null);
  const other = (c: Call, userId: string): Party => (c.caller.userId === userId ? c.callee : c.caller);
  const view = (c: Call, forUser: string) => {
    const peer = other(c, forUser);
    return { callId: c.id, state: c.state, role: c.caller.userId === forUser ? "caller" : "callee", peer: { id: peer.userId, displayName: peer.name, muted: peer.muted } };
  };
  const emit = (c: Call, p: Party, session: string | null, data: Record<string, unknown> & { type: string }) => deps.send(c.tripId, p.userId, session, { ...data, callId: c.id, seq: ++c.seq });

  function end(c: Call, reason: string, by: string | null = null): void {
    if (!calls.delete(c.id)) return;
    if (c.ringTimer) clearTimeout(c.ringTimer);
    clearTimeout(c.maxTimer);
    for (const t of c.graceTimers.values()) clearTimeout(t);
    for (const p of [c.caller, c.callee]) {
      if (byUser.get(p.userId) === c.id) byUser.delete(p.userId);
      // every tab, so a ringing or "in a call elsewhere" tab clears too
      emit(c, p, null, { type: "ended", reason, by });
    }
  }

  function get(tripId: string, callId: unknown, userId: string): { c: Call; me: Party } {
    if (typeof callId !== "string" || !CALL_RE.test(callId)) throw new HttpError(404, "That call has ended.");
    const c = calls.get(callId);
    const me = c && c.tripId === tripId ? party(c, userId) : null;
    if (!c || !me) throw new HttpError(404, "That call has ended.");
    // membership is checked on every action; losing it ends the call
    if (!deps.isMember(tripId, c.caller.userId) || !deps.isMember(tripId, c.callee.userId)) {
      end(c, "removed");
      throw new HttpError(404, "That call has ended.");
    }
    return { c, me };
  }

  // The tab must be the one that holds this end of the call, and must have
  // the trip open.
  function requireTab(tripId: string, userId: string, session: unknown): string {
    if (typeof session !== "string" || !SESSION_RE.test(session)) throw new HttpError(400, "Missing tab id.");
    if (!deps.hasSession(tripId, userId, session)) throw new HttpError(409, "Open the trip first.");
    return session;
  }

  return {
    invite(tripId: string, userId: string, input: Record<string, unknown>) {
      const session = requireTab(tripId, userId, input.session);
      const to = input.to;
      if (typeof to !== "string" || to === userId || !deps.isMember(tripId, to)) throw new HttpError(400, "Choose someone on this trip to call.");

      // Both pressed Call at once: the second invitation answers the first.
      const theirs = byUser.get(to) ? calls.get(byUser.get(to)!) : undefined;
      if (theirs && theirs.state === "ringing" && theirs.tripId === tripId && theirs.callee.userId === userId && theirs.caller.userId === to) {
        return { ...this.accept(tripId, userId, theirs.id, { session }), merged: true };
      }
      if (byUser.has(userId)) throw new HttpError(409, "You're already in a call (maybe in another tab).", { code: "self_busy" });
      if (!deps.isOnline(tripId, to)) throw new HttpError(409, "They aren't on this trip right now.", { code: "offline" });
      if (byUser.has(to)) throw new HttpError(409, "They're in another call.", { code: "busy" });

      const c: Call = {
        id: randomUUID(),
        tripId,
        state: "ringing",
        caller: { userId, name: deps.nameOf(tripId, userId) ?? "Someone", session, muted: false },
        callee: { userId: to, name: deps.nameOf(tripId, to) ?? "Someone", session: null, muted: false },
        createdAt: Date.now(),
        ringTimer: null,
        graceTimers: new Map(),
        maxTimer: setTimeout(() => end(c, "time-limit"), L.maxMs),
        seq: 0,
        signals: new Map(),
      };
      c.maxTimer.unref();
      c.ringTimer = setTimeout(() => end(c, "no-answer"), L.ringMs);
      c.ringTimer.unref();
      calls.set(c.id, c);
      byUser.set(userId, c.id);
      byUser.set(to, c.id);
      // every tab of the callee rings; the caller's other tabs know they're busy
      emit(c, c.callee, null, { type: "invite", ...view(c, to), expiresAt: c.createdAt + L.ringMs });
      emit(c, c.caller, null, { type: "outgoing", ...view(c, userId), session });
      return view(c, userId);
    },

    accept(tripId: string, userId: string, callId: unknown, input: Record<string, unknown>) {
      const session = requireTab(tripId, userId, input.session);
      const { c, me } = get(tripId, callId, userId);
      if (me !== c.callee) throw new HttpError(403, "Only the person being called can answer.");
      if (c.state !== "ringing") throw new HttpError(409, "This call was already answered.");
      if (c.ringTimer) clearTimeout(c.ringTimer);
      c.ringTimer = null;
      c.state = "active";
      c.callee.session = session;
      emit(c, c.callee, null, { type: "accepted", ...view(c, userId), session });
      emit(c, c.caller, null, { type: "accepted", ...view(c, c.caller.userId), session: c.caller.session });
      return view(c, userId);
    },

    decline(tripId: string, userId: string, callId: unknown) {
      const { c, me } = get(tripId, callId, userId);
      if (me !== c.callee || c.state !== "ringing") throw new HttpError(409, "There's no call to decline.");
      end(c, "declined", userId);
      return { ok: true };
    },

    // Leaving: the caller cancelling, either side hanging up, or the callee
    // declining from a tab that hadn't answered.
    hangup(tripId: string, userId: string, callId: unknown, input: Record<string, unknown>) {
      const { c, me } = get(tripId, callId, userId);
      if (me.session !== null && input.session !== me.session) throw new HttpError(409, "This call is in another tab.");
      end(c, c.state === "ringing" ? (me === c.caller ? "cancelled" : "declined") : "hangup", userId);
      return { ok: true };
    },

    // Relays one WebRTC message to the other tab in the call.
    signal(tripId: string, userId: string, callId: unknown, input: Record<string, unknown>) {
      const { c, me } = get(tripId, callId, userId);
      if (c.state !== "active" || me.session === null || input.session !== me.session) throw new HttpError(409, "This call isn't connected in this tab.");
      const now = Date.now();
      const recent = (c.signals.get(userId) ?? []).filter((t) => now - t < 60_000);
      if (recent.length >= L.signalsPerMinute) throw new HttpError(429, "Too many call messages.");
      c.signals.set(userId, [...recent, now]);

      const peer = other(c, userId);
      const kind = input.kind;
      if (kind === "description") {
        const d = input.description as Record<string, unknown> | undefined;
        if (!d || (d.type !== "offer" && d.type !== "answer") || typeof d.sdp !== "string" || d.sdp.length > L.descriptionBytes || !d.sdp.startsWith("v=0")) {
          throw new HttpError(400, "Invalid session description.");
        }
        emit(c, peer, peer.session, { type: "signal", kind, description: { type: d.type, sdp: d.sdp } });
      } else if (kind === "candidate") {
        const k = input.candidate as Record<string, unknown> | null | undefined;
        const ok =
          k === null ||
          (k && typeof k === "object" && typeof k.candidate === "string" && k.candidate.length <= L.candidateBytes && (k.sdpMid === undefined || k.sdpMid === null || (typeof k.sdpMid === "string" && k.sdpMid.length <= 32)) && (k.sdpMLineIndex === undefined || k.sdpMLineIndex === null || (Number.isInteger(k.sdpMLineIndex) && (k.sdpMLineIndex as number) >= 0 && (k.sdpMLineIndex as number) < 16)));
        if (!ok) throw new HttpError(400, "Invalid ICE candidate.");
        emit(c, peer, peer.session, { type: "signal", kind, candidate: k ? { candidate: k.candidate, sdpMid: k.sdpMid ?? null, sdpMLineIndex: k.sdpMLineIndex ?? null } : null });
      } else if (kind === "mute") {
        if (typeof input.muted !== "boolean") throw new HttpError(400, "Invalid mute state.");
        me.muted = input.muted;
        emit(c, peer, peer.session, { type: "mute", muted: me.muted });
      } else {
        throw new HttpError(400, "Unknown call message.");
      }
      return { ok: true };
    },

    // A tab (re)opened its stream. A tab holding a call gets told it's still
    // on (so it can restart ICE if needed); a ringing callee's tabs ring
    // again. Nothing old is replayed: no offers, no candidates.
    joined(tripId: string, userId: string, session: string | null): void {
      const c = calls.get(byUser.get(userId) ?? "");
      if (!c || c.tripId !== tripId || !session) return;
      const me = party(c, userId)!;
      if (me.session === session) {
        const t = c.graceTimers.get(userId);
        if (t) clearTimeout(t);
        c.graceTimers.delete(userId);
        emit(c, me, session, { type: "resume", ...view(c, userId), session });
      } else if (c.state === "ringing" && me === c.callee) {
        emit(c, me, session, { type: "invite", ...view(c, userId), expiresAt: c.createdAt + L.ringMs });
      } else {
        emit(c, me, session, { type: "elsewhere", ...view(c, userId) });
      }
    },

    // A tab's stream closed. Losing the trip ends the call now; a tab that
    // held the call gets a short grace period to reconnect.
    left(tripId: string, userId: string, session: string | null): void {
      const c = calls.get(byUser.get(userId) ?? "");
      if (!c || c.tripId !== tripId) return;
      if (!deps.isMember(tripId, userId)) return end(c, "removed");
      const me = party(c, userId)!;
      const holds = me.session !== null && me.session === session;
      const calleeGone = c.state === "ringing" && me === c.callee && !deps.isOnline(tripId, userId);
      if (!holds && !calleeGone) return;
      if (c.graceTimers.has(userId)) return;
      const t = setTimeout(() => {
        c.graceTimers.delete(userId);
        const back = me.session ? deps.hasSession(tripId, userId, me.session) : deps.isOnline(tripId, userId);
        if (!back) end(c, "disconnected", userId);
      }, L.graceMs);
      t.unref();
      c.graceTimers.set(userId, t);
    },

    // Sign-out, or the trip went away for this person.
    endFor(userId: string, reason: string): void {
      const c = calls.get(byUser.get(userId) ?? "");
      if (c) end(c, reason, userId);
    },

    // After a membership change: any call with someone no longer on the trip ends.
    checkTrip(tripId: string): void {
      for (const c of [...calls.values()]) {
        if (c.tripId === tripId && (!deps.isMember(tripId, c.caller.userId) || !deps.isMember(tripId, c.callee.userId))) end(c, "removed");
      }
    },

    stateFor(tripId: string, userId: string) {
      const c = calls.get(byUser.get(userId) ?? "");
      return c && c.tripId === tripId ? view(c, userId) : null;
    },

    size: () => calls.size,

    closeAll(): void {
      for (const c of [...calls.values()]) end(c, "server-restart");
    },
  };
}

export type Calls = ReturnType<typeof createCalls>;

// ICE servers for one browser. TURN credentials are minted per request and
// expire; the long-lived secret or API token never leaves the server.
//   Cloudflare Realtime TURN: CLOUDFLARE_TURN_KEY_ID + CLOUDFLARE_TURN_API_TOKEN
//   Self-hosted coturn (use-auth-secret): WAYLINE_TURN_URLS + WAYLINE_TURN_SECRET
//   STUN only: WAYLINE_STUN_URLS (comma-separated)
export type IceConfig = { iceServers: { urls: string[]; username?: string; credential?: string }[]; relay: boolean; ttl: number | null };

export function iceConfigured(env: NodeJS.ProcessEnv = process.env): { stun: boolean; turn: "cloudflare" | "coturn" | null } {
  const turn = env.CLOUDFLARE_TURN_KEY_ID && env.CLOUDFLARE_TURN_API_TOKEN ? "cloudflare" : env.WAYLINE_TURN_URLS && env.WAYLINE_TURN_SECRET ? "coturn" : null;
  return { stun: Boolean(env.WAYLINE_STUN_URLS), turn };
}

const list = (v: string | undefined) => (v ?? "").split(",").map((s) => s.trim()).filter((s) => /^(stun|turn|turns):/.test(s));

export async function iceServersFor(userId: string, env: NodeJS.ProcessEnv = process.env, now = Date.now()): Promise<IceConfig> {
  const ttl = 5 * 3600; // outlasts the 4 h call limit; Cloudflare allows up to 48 h
  const stun = list(env.WAYLINE_STUN_URLS);
  const base: IceConfig["iceServers"] = stun.length ? [{ urls: stun }] : [];
  const mode = iceConfigured(env).turn;
  if (mode === "cloudflare") {
    const api = (env.CLOUDFLARE_TURN_API_BASE || "https://rtc.live.cloudflare.com").replace(/\/+$/, "");
    try {
      const res = await fetch(`${api}/v1/turn/keys/${encodeURIComponent(env.CLOUDFLARE_TURN_KEY_ID!)}/credentials/generate-ice-servers`, {
        method: "POST",
        headers: { authorization: `Bearer ${env.CLOUDFLARE_TURN_API_TOKEN}`, "content-type": "application/json" },
        body: JSON.stringify({ ttl }),
        signal: AbortSignal.timeout(8000),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as { iceServers?: { urls: string | string[]; username?: string; credential?: string }[] };
      const servers = (data.iceServers ?? []).map((s) => ({
        // port 53 is blocked by browsers and only slows gathering
        urls: (Array.isArray(s.urls) ? s.urls : [s.urls]).filter((u) => typeof u === "string" && !/:53(\?|$)/.test(u)),
        ...(s.username ? { username: s.username, credential: s.credential } : {}),
      }));
      return { iceServers: [...base, ...servers.filter((s) => s.urls.length)], relay: servers.some((s) => s.username), ttl };
    } catch (err) {
      console.warn("TURN credentials unavailable:", err instanceof Error ? err.message : "error");
      return { iceServers: base, relay: false, ttl: null };
    }
  }
  if (mode === "coturn") {
    const username = `${Math.floor(now / 1000) + ttl}:${userId}`;
    const credential = createHmac("sha1", env.WAYLINE_TURN_SECRET!).update(username).digest("base64");
    return { iceServers: [...base, { urls: list(env.WAYLINE_TURN_URLS), username, credential }], relay: true, ttl };
  }
  return { iceServers: base, relay: false, ttl: null };
}
