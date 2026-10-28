import { createServer, type IncomingMessage, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { addActivity, type Client, newTrip, signUp, startApp, text } from "./helpers.ts";

// "Optimize my day" when the person leaves before it's done (CLAUDE.md, "a
// timeout and cancellation"): the server stops its own work, not just the
// browser's wait. The model call is cancelled upstream, its usage row closes
// as cancelled (freeing its slot), no draft is kept, and a person who leaves
// while the plan is still being prepared never starts a model call at all.

// Holds each request it gets until the test releases it, and notices when the
// other end closes the connection first.
function gate() {
  const waiting: (() => void)[] = [];
  return {
    hold: () => new Promise<void>((r) => waiting.push(r)),
    release: () => waiting.splice(0).forEach((r) => r()),
    get held() {
      return waiting.length;
    },
  };
}
const listen = (s: Server) => new Promise<string>((r) => s.listen(0, "127.0.0.1", () => r(`http://127.0.0.1:${(s.address() as AddressInfo).port}`)));
const readBody = async (req: IncomingMessage) => {
  let raw = "";
  for await (const c of req) raw += c;
  return raw ? JSON.parse(raw) : {};
};
async function until(test: () => boolean | Promise<boolean>, what: string, ms = 5000) {
  const end = Date.now() + ms;
  while (!(await test())) {
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 20));
  }
}

describe("cancelling Optimize my day", () => {
  const model = gate();
  const places = gate();
  let modelCalls = 0;
  let upstreamClosed = 0; // provider requests the app hung up on before an answer
  let holdModel = true;
  let holdPlaces = false;
  let provider: Server;
  let google: Server;
  let urls: { p: string; g: string };
  let app: Awaited<ReturnType<typeof startApp>>;

  beforeAll(async () => {
    provider = createServer(async (req, res) => {
      const body = await readBody(req);
      modelCalls++;
      let answered = false;
      res.on("close", () => {
        if (!answered) upstreamClosed++;
      });
      if (holdModel) await model.hold();
      if (res.destroyed) return;
      answered = true;
      const ids = [...String(body.input).matchAll(/"id":"([0-9a-f-]{36})","title":"[^"]+","type":"[a-z]+","fixed":false/g)].map((m) => m[1]);
      const r = text({ summary: "Swap the two untimed stops.", order: [...ids].reverse(), suggestions: [], caveats: [] });
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify(r.body));
    });
    google = createServer(async (req, res) => {
      await readBody(req);
      if (req.url?.includes("searchNearby") && holdPlaces) await places.hold();
      if (res.destroyed) return;
      res.writeHead(200, { "content-type": "application/json" });
      res.end(req.url?.includes("computeRoutes") ? JSON.stringify({ routes: [{ duration: "600s", distanceMeters: 800 }] }) : JSON.stringify({ places: [] }));
    });
    const [p, g] = await Promise.all([listen(provider), listen(google)]);
    urls = { p, g };
  });
  // each test gets its own app and database, so a call one test leaves
  // running can't hold the next test's slot
  beforeEach(async () => {
    app = await startApp({
      OPENAI_API_KEY: "cancel-test-secret",
      OPENAI_BASE_URL: urls.p,
      GOOGLE_MAPS_SERVER_KEY: "mock-google",
      GOOGLE_PLACES_BASE_URL: urls.g,
      GOOGLE_ROUTES_BASE_URL: urls.g,
      WAYLINE_AI_CONCURRENT: "1",
      WAYLINE_AI_ADMINS: "canceldev",
    });
  });
  afterEach(async () => {
    model.release();
    places.release();
    await app.stop();
  });
  afterAll(() => {
    provider.close();
    google.close();
  });

  // the usage rows as stored, read-only, from the app's own database
  const usageRows = () => {
    const db = new DatabaseSync(join(app.dataDir, "wayline.db"), { readOnly: true });
    try {
      return db.prepare("select status, error_kind from ai_usage order by started_at").all() as { status: string; error_kind: string | null }[];
    } finally {
      db.close();
    }
  };
  const logLines = () =>
    app
      .output()
      .split("\n")
      .filter(Boolean)
      .map((l) => JSON.parse(l) as Record<string, unknown>);

  // a person with preferences set and a day the planner can work on; the stops
  // have places, so the server also searches Google before calling the model
  async function plannable(name: string) {
    const c = await signUp(app.url, name);
    await c.send("PUT", "/api/me/preferences", { food: {}, travel: {} });
    const trip = await newTrip(c);
    const place = (i: number) => ({ placeId: `ChIJ_cancel_${i}_${name}`.slice(0, 60), source: "google", lat: -33.86 + i / 1000, lng: 151.21 });
    await addActivity(c, trip, { title: "Gallery", startMin: null, place: place(1) });
    await addActivity(c, trip, { title: "Rocks", startMin: null, place: place(2) });
    return { c, trip };
  }
  // POST /plan with a connection the test can cut, as a browser tab closing would
  function planRequest(c: Client, tripId: string, dayId: string) {
    const ac = new AbortController();
    const done = fetch(new URL(`/api/trips/${tripId}/plan`, app.url), {
      method: "POST",
      headers: { cookie: c.cookie, "content-type": "application/json" },
      body: JSON.stringify({ dayId }),
      signal: ac.signal,
    }).then(
      async (r) => ({ status: r.status, data: await r.json() }),
      (err: Error) => ({ status: 0, data: { aborted: err.name } }),
    );
    return { abort: () => ac.abort(), done };
  }

  it("cancels the model call upstream when the person leaves, closes its usage as cancelled and keeps no draft", { timeout: 15_000 }, async () => {
    holdModel = true;
    holdPlaces = false;
    const dev = await plannable("canceldev");
    const before = { calls: modelCalls, closed: upstreamClosed, rows: usageRows().length };
    const req = planRequest(dev.c, dev.trip.id, dev.trip.days[0].id);
    await until(() => model.held === 1, "the model call to reach the provider");
    expect(modelCalls).toBe(before.calls + 1);
    expect(usageRows().at(-1)?.status).toBe("running");

    req.abort();
    expect((await req.done).data).toEqual({ aborted: "AbortError" });
    // the server hung up on the provider: the SDK request was cancelled, not left running
    await until(() => upstreamClosed === before.closed + 1, "the provider connection to be cancelled");
    await until(() => usageRows().at(-1)?.status !== "running", "the usage row to close");
    expect(usageRows()).toHaveLength(before.rows + 1);
    expect(usageRows().at(-1)).toEqual({ status: "cancelled", error_kind: "cancelled" });
    const usage = (await dev.c.get("/api/admin/ai-usage")).data;
    expect(usage.today.running).toBe(0); // the slot is free again
    expect(usage.today.requests).toBe(before.rows + 1); // a cancelled call still used its request
    model.release(); // nothing is waiting any more

    const lines = logLines();
    expect(lines.some((l) => l.event === "AI_REQUEST_FAILED" && l.errorCode === "AI_CANCELLED")).toBe(true);
    expect(lines.some((l) => l.event === "AI_REQUEST_COMPLETED" && l.tripId === dev.trip.id)).toBe(false);
    expect(lines.some((l) => l.event === "AI_PLAN_DRAFTED" && l.tripId === dev.trip.id && l.status === "success")).toBe(false);

    // the slot really is free: with one call allowed at once, the next plan goes through
    holdModel = false;
    const next = await dev.c.send("POST", `/api/trips/${dev.trip.id}/plan`, { dayId: dev.trip.days[0].id });
    expect(next.status).toBe(200);
    expect(next.data.summary).toBe("Swap the two untimed stops.");
    // and only that plan can be applied: the cancelled one left nothing behind
    expect((await dev.c.send("POST", `/api/trips/${dev.trip.id}/plan/apply`, { draftId: next.data.draftId })).status).toBe(200);
  });

  it("doesn't start a model call for a person who left while the plan was being prepared", { timeout: 15_000 }, async () => {
    holdModel = false;
    holdPlaces = true;
    const { c, trip } = await plannable(`prep${Date.now().toString(36)}`);
    // the same request, left alone, does go on to the model once the search answers
    let before = modelCalls;
    const stayed = planRequest(c, trip.id, trip.days[0].id);
    await until(() => places.held > 0, "the Google search before the model call");
    expect(modelCalls).toBe(before);
    places.release();
    expect((await stayed.done).status).toBe(200);
    expect(modelCalls).toBe(before + 1);
    expect(usageRows()).toHaveLength(1);

    before = modelCalls;
    const req = planRequest(c, trip.id, trip.days[0].id);
    await until(() => places.held > 0, "the Google search before the model call");
    req.abort();
    expect((await req.done).data).toEqual({ aborted: "AbortError" });
    // The server can only stop for a disconnect it has seen. The closed socket
    // reached it before these requests did; once they're answered, its event
    // loop has handled the close too (no clock involved).
    for (let i = 0; i < 3; i++) expect((await c.get("/api/auth/me")).status).toBe(200);
    // the person is gone before the search answers; now let the search finish.
    // Without a cancellation the planner goes straight on to the model.
    holdPlaces = false;
    places.release();
    await until(() => modelCalls > before, "a model call", 1000).catch(() => {});
    expect(modelCalls).toBe(before);
    expect(usageRows()).toHaveLength(1); // no request used, no slot taken
  });

  it("still plans and applies normally, recording the call as ok", async () => {
    holdModel = false;
    holdPlaces = false;
    const { c, trip } = await plannable(`ok${Date.now().toString(36)}`);
    const plan = await c.send("POST", `/api/trips/${trip.id}/plan`, { dayId: trip.days[0].id });
    expect(plan.status).toBe(200);
    expect(usageRows().at(-1)).toEqual({ status: "ok", error_kind: null });
    expect((await c.send("POST", `/api/trips/${trip.id}/plan/apply`, { draftId: plan.data.draftId })).status).toBe(200);
  });
});
