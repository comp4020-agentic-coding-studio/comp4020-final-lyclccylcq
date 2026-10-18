import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { log, sanitize, setUser, withRequest } from "../src/log.ts";
import { addActivity, newTrip, share, signUp, startApp, watchEvents } from "./helpers.ts";

// Structured server logs (docs/logging.md): one JSON object per line, the
// user resolved from the session, one business event per action, no secrets.

type Entry = Record<string, any>;
const REQUIRED = ["timestamp", "level", "event", "userId", "tripId", "action", "status", "message"];

function capture(fn: () => void): string[] {
  const lines: string[] = [];
  const out = process.stdout.write.bind(process.stdout);
  const err = process.stderr.write.bind(process.stderr);
  process.stdout.write = ((s: string) => (lines.push(s), true)) as typeof process.stdout.write;
  process.stderr.write = ((s: string) => (lines.push(s), true)) as typeof process.stderr.write;
  try {
    fn();
  } finally {
    process.stdout.write = out;
    process.stderr.write = err;
  }
  return lines;
}

describe("the logger", () => {
  it("writes one JSON line with the required fields, the user taken from the request context", () => {
    const [line] = capture(() =>
      withRequest("req_test", () => {
        setUser({ id: "u-1", username: "alice" });
        log.info("TRIP_DESTINATION_ADDED", { tripId: "t-1", action: "add_destination", status: "success", message: "added" });
      }),
    );
    expect(line.endsWith("\n")).toBe(true);
    const e = JSON.parse(line);
    for (const k of REQUIRED) expect(e).toHaveProperty(k);
    expect(e).toMatchObject({ level: "INFO", event: "TRIP_DESTINATION_ADDED", userId: "u-1", username: "alice", tripId: "t-1", requestId: "req_test" });
    expect(new Date(e.timestamp).toISOString()).toBe(e.timestamp);
  });

  it("drops secret-looking fields and redacts secrets inside messages", () => {
    const [line] = capture(() =>
      log.warn("X", {
        message: "failed https://x.test/?key=AIzaSyA1234567890abcdefghijklmnop with Bearer abc.def and sk-ant-0123456789abcdefghij",
        token: "t0ps3cret",
        password: "hunter22",
        cookie: "wl_session=abc",
        authorization: "Bearer xyz",
        sdp: "v=0",
      }),
    );
    expect(line).not.toMatch(/AIzaSy|abc\.def|sk-ant|t0ps3cret|hunter22|wl_session|v=0/);
    const e = JSON.parse(line);
    expect(e).not.toHaveProperty("token");
    expect(e).not.toHaveProperty("password");
    expect(e.level).toBe("WARN");
  });

  it("never throws, even on values JSON can't encode", () => {
    const loop: any = {};
    loop.self = loop;
    expect(() => capture(() => log.error("X", { message: "m", loop, big: 10n }))).not.toThrow();
  });

  it("keeps sanitized messages short", () => {
    expect(sanitize("x".repeat(1000)).length).toBeLessThanOrEqual(301);
  });
});

describe("server logs for a collaborative session", () => {
  let app: Awaited<ReturnType<typeof startApp>>;
  const entries = (): Entry[] =>
    app
      .output()
      .split("\n")
      .filter(Boolean)
      .map((l) => JSON.parse(l));
  const until = async (test: (e: Entry[]) => boolean) => {
    for (let i = 0; i < 50 && !test(entries()); i++) await new Promise((r) => setTimeout(r, 40));
    return entries();
  };

  beforeAll(async () => {
    app = await startApp();
  });
  afterAll(() => app.stop());

  it("attributes each action to the user who did it, from the session cookie", async () => {
    const a = await signUp(app.url);
    const b = await signUp(app.url);
    expect(a.userId).not.toBe(b.userId);
    const trip = await newTrip(a, { title: "Logged trip" });
    await a.get(`/api/trips/${trip.id}`);
    await share(a, b, trip.id);
    const sa = watchEvents(app.url, a, trip.id, "tab-a-000001");
    const sb = watchEvents(app.url, b, trip.id, "tab-b-000001");
    await Promise.all([sa.ready, sb.ready]);

    // B claims to be A in the body; the log must still say B
    const added = await addActivity(a, trip, { title: "Opera House", notes: "door code 4421" });
    const id = added.data.activityId;
    const bStop = (await addActivity(b, trip, { title: "Bob's pick", startMin: 700 })).data.activityId;
    expect((await b.send("PATCH", `/api/trips/${trip.id}/activities/${bStop}`, { baseVersion: 1, startMin: 600, userId: a.userId })).status).toBe(200);
    // high-frequency map views never log
    for (let i = 0; i < 5; i++) await b.send("POST", `/api/trips/${trip.id}/view`, { session: "tab-b-000001", lat: -33.8, lng: 151.2 + i / 100, zoom: 12 });
    sb.close();
    sa.close();

    const all = await until((e) => e.filter((x) => x.event === "COLLAB_COLLABORATOR_LEFT" && x.tripId === trip.id).length === 2);
    const mine = all.filter((e) => e.tripId === trip.id);
    for (const e of mine) for (const k of REQUIRED) expect(e, `${e.event} has ${k}`).toHaveProperty(k);

    const one = (event: string) => {
      const hits = mine.filter((e) => e.event === event);
      expect(hits, event).toHaveLength(1);
      return hits[0];
    };
    expect(one("TRIP_CREATED").userId).toBe(a.userId);
    expect(one("TRIP_OPENED").userId).toBe(a.userId);
    expect(one("COLLAB_REQUEST_CREATED").userId).toBe(b.userId);
    expect(one("COLLAB_REQUEST_APPROVED")).toMatchObject({ userId: a.userId, targetUserId: b.userId });
    expect(one("COLLABORATOR_ADDED")).toMatchObject({ userId: a.userId, targetUserId: b.userId });
    const adds = mine.filter((e) => e.event === "TRIP_DESTINATION_ADDED");
    expect(adds.map((e) => e.userId)).toEqual([a.userId, b.userId]);
    const add = adds[0];
    expect(add).toMatchObject({ userId: a.userId, status: "success", activityId: id, level: "INFO" });
    const sched = one("TRIP_SCHEDULE_MODIFIED");
    expect(sched).toMatchObject({ userId: b.userId, fields: ["startMin"], status: "success" });
    expect(typeof sched.requestId).toBe("string");
    expect(typeof sched.durationMs).toBe("number");

    // each change: its business event first, then one broadcast from the same request
    const broadcasts = mine.filter((e) => e.event === "COLLAB_UPDATE_BROADCAST");
    const addCast = broadcasts.find((e) => e.requestId === add.requestId);
    expect(addCast).toMatchObject({ userId: a.userId, recipients: 2, status: "success" });
    expect(mine.indexOf(addCast!)).toBeGreaterThan(mine.indexOf(add));
    expect(broadcasts.filter((e) => e.requestId === sched.requestId)).toHaveLength(1);

    const connected = mine.filter((e) => e.event === "REALTIME_CONNECTED");
    expect(connected.map((e) => e.userId).sort()).toEqual([a.userId, b.userId].sort());
    expect(new Set(connected.map((e) => e.connectionId)).size).toBe(2);
    expect(mine.filter((e) => e.event === "REALTIME_DISCONNECTED").map((e) => e.userId).sort()).toEqual([a.userId, b.userId].sort());
    expect(mine.filter((e) => e.event === "COLLAB_COLLABORATOR_JOINED")).toHaveLength(2);

    expect(mine.some((e) => /view/i.test(e.event) || String(e.path ?? "").endsWith("/view"))).toBe(false);
    const text = app.output();
    expect(text).not.toContain("door code 4421");
    expect(text).not.toContain("correct horse battery");
    expect(text).not.toContain("wl_session");
    expect(text).not.toContain(a.cookie.split("=")[1]);
  });

  it("logs refused operations as WARN with the refusing user and an error code", async () => {
    const owner = await signUp(app.url);
    const guest = await signUp(app.url);
    const stranger = await signUp(app.url);
    const trip = await newTrip(owner);
    await share(owner, guest, trip.id);
    const id = (await addActivity(guest, trip)).data.activityId; // the guest's own stop

    expect((await guest.send("DELETE", `/api/trips/${trip.id}`)).status).toBe(403);
    expect((await stranger.send("DELETE", `/api/trips/${trip.id}/activities/${id}`)).status).toBe(404);
    expect((await guest.send("PATCH", `/api/trips/${trip.id}/activities/${id}`, { baseVersion: 99, notes: "x" })).status).toBe(409);
    expect((await addActivity(owner, trip, { title: "" })).status).toBe(400);
    const s = watchEvents(app.url, stranger, trip.id);
    await expect(s.ready).rejects.toThrow();

    const mine = (await until((e) => e.some((x) => x.event === "REALTIME_CONNECTION_FAILED" && x.tripId === trip.id))).filter((e) => e.tripId === trip.id && e.level === "WARN");
    const find = (event: string, userId: string) => mine.find((e) => e.event === event && e.userId === userId);
    expect(find("UNAUTHORIZED_MODIFICATION_ATTEMPT", guest.userId)).toMatchObject({ status: "denied", errorCode: "FORBIDDEN", attemptedEvent: "TRIP_DELETED" });
    expect(find("UNAUTHORIZED_MODIFICATION_ATTEMPT", stranger.userId)).toMatchObject({ status: "denied", errorCode: "NOT_FOUND", attemptedEvent: "TRIP_DESTINATION_REMOVED" });
    expect(find("INVALID_TRIP_OPERATION", guest.userId)).toMatchObject({ status: "failure", errorCode: "CONFLICT" });
    expect(find("INVALID_TRIP_OPERATION", owner.userId)).toMatchObject({ status: "failure", errorCode: "INVALID_INPUT" });
    expect(find("REALTIME_CONNECTION_FAILED", stranger.userId)).toMatchObject({ status: "denied" });
    // a refused change broadcasts nothing
    expect(entries().filter((e) => e.event === "COLLAB_UPDATE_BROADCAST" && e.tripId === trip.id && e.userId !== owner.userId)).toEqual([]);
  });

  it("prints only JSON lines", () => {
    for (const line of app.output().split("\n").filter(Boolean)) expect(() => JSON.parse(line), line).not.toThrow();
  });
});
