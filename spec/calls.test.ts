import { afterEach, describe, expect, inject, it } from "vitest";
import { createCalls, iceServersFor } from "../src/calls.ts";
import { type Client, newTrip, share, signUp, startApp, watchEvents } from "./helpers.ts";

// Voice-call signalling (ADR 0004): authorised, targeted, temporary, and
// never part of the itinerary. Media is checked in spec/browser.test.ts.
const baseUrl = inject("baseUrl");

const sid = () => `tab-${Math.random().toString(36).slice(2, 12)}`;
const open: { close(): void }[] = [];
afterEach(() => {
  for (const w of open.splice(0)) w.close();
});
function tab(c: Client, tripId: string, session = sid(), url = baseUrl) {
  const w = watchEvents(url, c, tripId, session);
  open.push(w);
  const call = (pred: (d: any) => boolean = () => true, ms = 3000) => w.next((e) => e.event === "call" && pred(e.data), ms).then((e) => e.data);
  return { session, w, call, ready: w.ready };
}

async function pair() {
  const owner = await signUp(baseUrl);
  const guest = await signUp(baseUrl);
  const trip = await newTrip(owner);
  await share(owner, guest, trip.id);
  const a = tab(owner, trip.id);
  const b = tab(guest, trip.id);
  await Promise.all([a.ready, b.ready]);
  return { owner, guest, trip, a, b, base: `/api/trips/${trip.id}/call` };
}

const SDP = "v=0\r\no=- 1 2 IN IP4 127.0.0.1\r\ns=-\r\nt=0 0\r\n";

describe("voice call signalling", () => {
  it("invite, accept, relay to the one tab in the call, mute, hang up; never a revision", async () => {
    const { owner, guest, trip, a, b, base } = await pair();
    const rev = (await owner.get(`/api/trips/${trip.id}`)).data.rev;

    const inv = await owner.send("POST", base, { session: a.session, to: guest.userId });
    expect(inv.status).toBe(201);
    const callId = inv.data.callId;
    expect(await b.call((d) => d.type === "invite")).toMatchObject({ callId, peer: { id: owner.userId } });

    // the guest opens a second tab: it rings too, until one answers
    const b2 = tab(guest, trip.id);
    await b2.ready;
    expect(await b2.call((d) => d.type === "invite")).toMatchObject({ callId });

    expect((await guest.send("POST", `${base}/${callId}/accept`, { session: b.session })).status).toBe(200);
    expect(await a.call((d) => d.type === "accepted")).toMatchObject({ callId, session: a.session });
    expect(await b2.call((d) => d.type === "accepted")).toMatchObject({ session: b.session }); // tells the other tab it's elsewhere

    // an offer from the caller reaches only the answering tab
    expect((await owner.send("POST", `${base}/${callId}/signal`, { session: a.session, kind: "description", description: { type: "offer", sdp: SDP } })).status).toBe(200);
    expect(await b.call((d) => d.type === "signal")).toMatchObject({ kind: "description", description: { type: "offer" } });
    await new Promise((r) => setTimeout(r, 150));
    expect(b2.w.events.some((e) => e.event === "call" && e.data.type === "signal")).toBe(false);

    // a candidate, end-of-candidates and mute
    await guest.send("POST", `${base}/${callId}/signal`, { session: b.session, kind: "candidate", candidate: { candidate: "candidate:1 1 udp 1 1.2.3.4 5 typ host", sdpMid: "0", sdpMLineIndex: 0 } });
    expect(await a.call((d) => d.type === "signal")).toMatchObject({ kind: "candidate", candidate: { sdpMid: "0" } });
    await guest.send("POST", `${base}/${callId}/signal`, { session: b.session, kind: "mute", muted: true });
    expect(await a.call((d) => d.type === "mute")).toMatchObject({ muted: true });

    // a second tab of the same person can't speak for the call
    expect((await guest.send("POST", `${base}/${callId}/signal`, { session: b2.session, kind: "mute", muted: false })).status).toBe(409);

    expect((await owner.send("POST", `${base}/${callId}/hangup`, { session: a.session })).status).toBe(200);
    expect(await b.call((d) => d.type === "ended")).toMatchObject({ reason: "hangup", by: owner.userId });
    expect(await b2.call((d) => d.type === "ended")).toMatchObject({ callId });
    expect((await owner.send("POST", `${base}/${callId}/signal`, { session: a.session, kind: "mute", muted: true })).status).toBe(404);
    expect((await owner.get(`/api/trips/${trip.id}`)).data.rev).toBe(rev);
    expect(a.w.events.concat(b.w.events).filter((e) => e.event === "snapshot")).toHaveLength(2); // only each stream's opening snapshot
  });

  it("decline and no-answer end the call for both", async () => {
    const { owner, guest, a, b, base } = await pair();
    const { callId } = (await owner.send("POST", base, { session: a.session, to: guest.userId })).data;
    await b.call((d) => d.type === "invite");
    expect((await owner.send("POST", `${base}/${callId}/decline`, {})).status).toBe(409); // only the callee declines
    expect((await guest.send("POST", `${base}/${callId}/decline`, {})).status).toBe(200);
    expect(await a.call((d) => d.type === "ended")).toMatchObject({ reason: "declined" });
    expect((await guest.send("POST", `${base}/${callId}/accept`, { session: b.session })).status).toBe(404);
  });

  it("rejects outsiders, other trips, forged identities and bad messages", async () => {
    const { owner, guest, trip, a, b, base } = await pair();
    const outsider = await signUp(baseUrl);
    const other = await newTrip(outsider);
    const o = tab(outsider, other.id);
    await o.ready;

    expect((await outsider.send("POST", base, { session: o.session, to: owner.userId })).status).toBe(404);
    expect((await outsider.send("POST", `/api/trips/${trip.id}/call/ice`, {})).status).toBe(404);
    expect((await owner.send("POST", base, { session: a.session, to: outsider.userId })).status).toBe(400);
    expect((await owner.send("POST", base, { session: a.session, to: owner.userId })).status).toBe(400);
    expect((await owner.send("POST", base, { session: b.session, to: guest.userId })).status).toBe(409); // someone else's tab id
    expect((await owner.send("POST", base, { to: guest.userId })).status).toBe(400);
    const anon = await fetch(new URL(base, baseUrl), { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ to: guest.userId }) });
    expect(anon.status).toBe(401);
    const cross = await fetch(new URL(base, baseUrl), { method: "POST", headers: { "content-type": "application/json", cookie: owner.cookie, origin: "https://evil.example" }, body: JSON.stringify({ session: a.session, to: guest.userId }) });
    expect(cross.status).toBe(403);

    const { callId } = (await owner.send("POST", base, { session: a.session, to: guest.userId })).data;
    await b.call((d) => d.type === "invite");
    // the caller can't answer their own call, the outsider can't touch it even with its id
    expect((await owner.send("POST", `${base}/${callId}/accept`, { session: a.session })).status).toBe(403);
    expect((await outsider.send("POST", `/api/trips/${other.id}/call/${callId}/hangup`, { session: o.session })).status).toBe(404);
    expect((await outsider.send("POST", `/api/trips/${other.id}/call/${callId}/accept`, { session: o.session })).status).toBe(404);
    await guest.send("POST", `${base}/${callId}/accept`, { session: b.session });
    const bad = (body: any) => owner.send("POST", `${base}/${callId}/signal`, { session: a.session, ...body });
    expect((await bad({ kind: "description", description: { type: "offer", sdp: "x".repeat(20_000) } })).status).toBe(413); // body limit
    expect((await bad({ kind: "description", description: { type: "pranswer", sdp: SDP } })).status).toBe(400);
    expect((await bad({ kind: "description", description: { type: "offer", sdp: "not sdp" } })).status).toBe(400);
    expect((await bad({ kind: "candidate", candidate: { candidate: "x".repeat(2000) } })).status).toBe(400);
    expect((await bad({ kind: "candidate", candidate: { candidate: "c", sdpMLineIndex: -1 } })).status).toBe(400);
    expect((await bad({ kind: "chat", text: "hello" })).status).toBe(400);
    expect(o.w.events.filter((e) => e.event === "call")).toHaveLength(0);
  });

  it("busy, offline and simultaneous invitations behave predictably", async () => {
    const { owner, guest, trip, a, b, base } = await pair();
    // simultaneous: both press Call; the second becomes an answer to the first
    const first = await owner.send("POST", base, { session: a.session, to: guest.userId });
    const second = await guest.send("POST", base, { session: b.session, to: owner.userId });
    expect(second.status).toBe(201);
    expect(second.data).toMatchObject({ merged: true, callId: first.data.callId, state: "active" });
    expect(await a.call((d) => d.type === "accepted")).toMatchObject({ callId: first.data.callId });

    // a third member is busy-checked, and can't start a second call with either
    const third = await signUp(baseUrl);
    await share(owner, third, trip.id);
    const c = tab(third, trip.id);
    await c.ready;
    const busy = await third.send("POST", base, { session: c.session, to: owner.userId });
    expect(busy.status).toBe(409);
    expect(busy.data.code).toBe("busy");
    // another of the owner's tabs can't start a second call
    const a2 = tab(owner, trip.id);
    await a2.ready;
    expect(await a2.call((d) => d.type === "elsewhere")).toMatchObject({ callId: first.data.callId });
    expect((await owner.send("POST", base, { session: a2.session, to: third.userId })).data.code).toBe("self_busy");
    await owner.send("POST", `${base}/${first.data.callId}/hangup`, { session: a.session });

    // offline: someone who isn't on the trip page can't be rung
    c.w.close();
    await new Promise((r) => setTimeout(r, 100));
    expect((await owner.send("POST", base, { session: a.session, to: third.userId })).data.code).toBe("offline");
  });

  it("removing someone from the trip ends their call and cleans up", async () => {
    const { owner, guest, trip, a, b, base } = await pair();
    const { callId } = (await owner.send("POST", base, { session: a.session, to: guest.userId })).data;
    await b.call((d) => d.type === "invite");
    await guest.send("POST", `${base}/${callId}/accept`, { session: b.session });
    expect((await owner.send("DELETE", `/api/trips/${trip.id}/members/${guest.userId}`)).status).toBe(200);
    expect(await a.call((d) => d.type === "ended")).toMatchObject({ callId, reason: "removed" });
    expect((await owner.get(`/api/trips/${trip.id}/call`)).data.call).toBeNull();
    expect((await guest.send("POST", `${base}/${callId}/signal`, { session: b.session, kind: "mute", muted: true })).status).toBe(404);
  });

  it("signing out ends the call", async () => {
    const { owner, guest, a, b, base } = await pair();
    const { callId } = (await owner.send("POST", base, { session: a.session, to: guest.userId })).data;
    await b.call((d) => d.type === "invite");
    await guest.send("POST", `${base}/${callId}/accept`, { session: b.session });
    await guest.send("POST", "/api/auth/logout", {});
    expect(await a.call((d) => d.type === "ended")).toMatchObject({ callId, reason: "signed-out" });
  });

  it("a reconnecting stream resumes without replaying old offers; a stream that stays gone ends the call", async () => {
    const app = await startApp({});
    try {
      const owner = await signUp(app.url);
      const guest = await signUp(app.url);
      const trip = await newTrip(owner);
      await share(owner, guest, trip.id);
      const base = `/api/trips/${trip.id}/call`;
      const a = tab(owner, trip.id, sid(), app.url);
      const b = tab(guest, trip.id, sid(), app.url);
      await Promise.all([a.ready, b.ready]);
      const { callId } = (await owner.send("POST", base, { session: a.session, to: guest.userId })).data;
      await b.call((d) => d.type === "invite");
      await guest.send("POST", `${base}/${callId}/accept`, { session: b.session });
      await owner.send("POST", `${base}/${callId}/signal`, { session: a.session, kind: "description", description: { type: "offer", sdp: SDP } });
      await b.call((d) => d.type === "signal");

      // the guest's stream drops and comes back with the same tab id
      b.w.close();
      await new Promise((r) => setTimeout(r, 100));
      const b3 = tab(guest, trip.id, b.session, app.url);
      await b3.ready;
      const resume = await b3.call((d) => d.type === "resume");
      expect(resume).toMatchObject({ callId, state: "active" });
      await new Promise((r) => setTimeout(r, 150));
      expect(b3.w.events.filter((e) => e.event === "call" && e.data.type === "signal")).toHaveLength(0); // no replayed offer
      expect(resume.seq).toBeGreaterThan(0);
    } finally {
      await app.stop();
    }
  });
});

describe("call state, unit", () => {
  const harness = (online = new Set(["A:tab-one-1", "B:tab-two-2"])) => {
    const sent: { to: string; data: any }[] = [];
    const calls = createCalls({
      send: (_t, userId, session, data) => (sent.push({ to: `${userId}:${session ?? "*"}`, data }), 1),
      hasSession: (_t, u, s) => online.has(`${u}:${s}`),
      isOnline: (_t, u) => [...online].some((k) => k.startsWith(`${u}:`)),
      isMember: (_t, u) => u === "A" || u === "B",
      nameOf: (_t, u) => u,
      limits: { ringMs: 40, graceMs: 40, signalsPerMinute: 3 },
    });
    return { calls, sent, online };
  };

  it("unanswered invitations expire", async () => {
    const { calls, sent } = harness();
    calls.invite("T", "A", { session: "tab-one-1", to: "B" });
    await new Promise((r) => setTimeout(r, 80));
    expect(sent.filter((s) => s.data.type === "ended").map((s) => s.data.reason)).toEqual(["no-answer", "no-answer"]);
    expect(calls.size()).toBe(0);
  });

  it("a tab that disappears gets a grace period, then the call ends", async () => {
    const { calls, sent, online } = harness();
    const { callId } = calls.invite("T", "A", { session: "tab-one-1", to: "B" });
    calls.accept("T", "B", callId, { session: "tab-two-2" });
    online.delete("B:tab-two-2");
    calls.left("T", "B", "tab-two-2");
    expect(calls.size()).toBe(1);
    await new Promise((r) => setTimeout(r, 80));
    expect(sent.at(-1)?.data).toMatchObject({ type: "ended", reason: "disconnected" });
    expect(calls.size()).toBe(0);
  });

  it("signals are rate limited per person", () => {
    const { calls } = harness();
    const { callId } = calls.invite("T", "A", { session: "tab-one-1", to: "B" });
    calls.accept("T", "B", callId, { session: "tab-two-2" });
    for (let i = 0; i < 3; i++) calls.signal("T", "A", callId, { session: "tab-one-1", kind: "mute", muted: true });
    expect(() => calls.signal("T", "A", callId, { session: "tab-one-1", kind: "mute", muted: true })).toThrow(/Too many/);
  });

  it("events carry an increasing sequence so clients can drop duplicates and stale ones", () => {
    const { calls, sent } = harness();
    const { callId } = calls.invite("T", "A", { session: "tab-one-1", to: "B" });
    calls.accept("T", "B", callId, { session: "tab-two-2" });
    const seqs = sent.map((s) => s.data.seq);
    expect(seqs).toEqual([...seqs].sort((x, y) => x - y));
    expect(new Set(seqs).size).toBe(seqs.length);
  });
});

describe("ICE servers", () => {
  it("without TURN configured: STUN only (or nothing), and says relay is unavailable", async () => {
    expect(await iceServersFor("u", {})).toEqual({ iceServers: [], relay: false, ttl: null });
    expect((await iceServersFor("u", { WAYLINE_STUN_URLS: "stun:stun.example.org:3478, http://bad" })).iceServers).toEqual([{ urls: ["stun:stun.example.org:3478"] }]);
  });

  it("coturn: short-lived HMAC credentials, never the shared secret", async () => {
    const cfg = await iceServersFor("user-1", { WAYLINE_TURN_URLS: "turn:turn.example.org:3478?transport=udp,turns:turn.example.org:5349", WAYLINE_TURN_SECRET: "long-lived-shared-secret" }, 1_700_000_000_000);
    expect(cfg.relay).toBe(true);
    const t = cfg.iceServers[0];
    expect(t.username).toBe(`${1_700_000_000 + 5 * 3600}:user-1`);
    expect(t.credential).toMatch(/^[A-Za-z0-9+/]+=*$/);
    expect(JSON.stringify(cfg)).not.toContain("long-lived-shared-secret");
  });

  it("Cloudflare: asks for credentials server-side with the token, drops port 53, and hides failures", async () => {
    const { createServer } = await import("node:http");
    let auth = "";
    let fail = false;
    const srv = createServer((req, res) => {
      auth = req.headers.authorization ?? "";
      res.writeHead(fail ? 401 : 201, { "content-type": "application/json" });
      res.end(JSON.stringify({ iceServers: [{ urls: ["stun:stun.cloudflare.com:3478", "stun:stun.cloudflare.com:53"] }, { urls: ["turn:turn.cloudflare.com:3478?transport=udp", "turn:turn.cloudflare.com:53?transport=udp"], username: "u", credential: "c" }] }));
    });
    await new Promise<void>((r) => srv.listen(0, "127.0.0.1", r));
    const env = { CLOUDFLARE_TURN_KEY_ID: "key-id", CLOUDFLARE_TURN_API_TOKEN: "api-token-secret", CLOUDFLARE_TURN_API_BASE: `http://127.0.0.1:${(srv.address() as any).port}` };
    try {
      const cfg = await iceServersFor("u", env);
      expect(auth).toBe("Bearer api-token-secret");
      expect(cfg.relay).toBe(true);
      expect(JSON.stringify(cfg)).not.toMatch(/:53|api-token-secret/);
      fail = true;
      expect(await iceServersFor("u", env)).toMatchObject({ relay: false, iceServers: [] });
    } finally {
      srv.close();
    }
  });

  it("the ICE endpoint needs membership and doesn't leak configuration", async () => {
    const owner = await signUp(baseUrl);
    const trip = await newTrip(owner);
    const res = await owner.send("POST", `/api/trips/${trip.id}/call/ice`, {});
    expect(res.status).toBe(200);
    expect(res.data).toHaveProperty("iceServers");
    expect(JSON.stringify(res.data)).not.toMatch(/SECRET|TOKEN|KEY_ID/);
  });
});
