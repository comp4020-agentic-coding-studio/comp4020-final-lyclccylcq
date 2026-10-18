import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildDraft, type Candidate, chooseMode, hardConstraints, planInput, roomFor, searchTypes } from "../src/planner.ts";
import { DEFAULT_FOOD, DEFAULT_TRAVEL, type Effective } from "../src/preferences.ts";
import type { Day } from "../src/trips.ts";
import { addActivity, newTrip, share, signUp, startApp, stubProvider, text } from "./helpers.ts";

// "Plan with AI" and travel preferences (docs/ai.md). The model only chooses
// among ids; hard constraints are enforced in code; nothing changes until a
// previewed plan is applied, as previewed, against an unchanged day.

const prefs = (over: { food?: Partial<Effective["food"]>; travel?: Partial<Effective["travel"]> } = {}): Effective => ({
  food: { ...DEFAULT_FOOD, ...over.food },
  travel: { ...DEFAULT_TRAVEL, ...over.travel },
  source: { user: true, trip: false },
  confirmed: true,
});
const act = (id: string, title: string, startMin: number | null, over: Record<string, unknown> = {}) => ({
  id, dayId: "d", position: 0, title, kind: "attraction" as const, startMin, durationMin: 60, notes: "", place: { placeId: `p-${id}`, source: "google", lat: -33.86, lng: 151.21 },
  role: null, meal: null, version: 1, createdBy: "u", updatedBy: null, updatedAt: 0, ...over,
});
const route = (mode: "WALK" | "TRANSIT" | "DRIVE", min: number, transfers = 0) => ({ mode, status: "ok" as const, durationSec: min * 60, distanceM: 1000, steps: Array.from({ length: transfers }, () => ({ kind: "transit" })) });
const day = (): Day => ({
  id: "d",
  date: "2026-12-01",
  fingerprint: "fp1",
  activities: [act("opera", "Opera House", 540), act("a", "Gallery", null), act("b", "Rocks", null), act("c", "Garden", null)] as never,
  segments: [{ id: "s1", fromId: "opera", toId: "a", options: [route("WALK", 25), route("TRANSIT", 12, 2), route("DRIVE", 8)], selectedMode: "WALK", computedAt: 0, departKey: "", stale: false }] as never,
  analysis: { gaps: [], issues: [], proposals: [] } as never,
});
const cand = (id: string, kind: "food" | "attraction", priceLevel: string | null = null): Candidate => ({ placeId: id, name: `Place ${id}`, category: kind === "food" ? "Restaurant" : "Museum", lat: -33.87, lng: 151.2, kind, distanceKm: 0.4, priceLevel, source: "google" });

describe("preferences shape the plan", () => {
  it("never sends allergy text to the model, only that a constraint exists", () => {
    const input = planInput(day(), prefs({ food: { allergies: "peanuts, shellfish", diets: ["halal"], cuisines: ["japanese"] } }), []);
    expect(JSON.stringify(input)).not.toMatch(/peanut|shellfish/);
    expect(input.preferences.hard).toEqual({ excludedModes: [], hasAllergies: true, dietaryNeeds: ["halal"] });
    expect(input.preferences.soft.cuisines).toEqual(["japanese"]);
    expect(input.stops.find((s) => s.id === "opera")?.fixed).toBe(true);
  });

  it("chooses transport by preference, and never an excluded mode", () => {
    const opts = day().segments[0].options as never;
    expect(chooseMode(opts, prefs({ travel: { transport: "walk" } }))).toBe("WALK");
    expect(chooseMode(opts, prefs({ travel: { transport: "walk", avoidModes: ["WALK"] } }))).not.toBe("WALK");
    expect(chooseMode(opts, prefs({ travel: { maxWalkMin: 15, avoidModes: ["DRIVE"] } }))).toBe("TRANSIT"); // the walk is too long
    expect(chooseMode(opts, prefs({ travel: { avoidModes: ["DRIVE"], maxWalkMin: 30 } }))).toBe("TRANSIT"); // 12 min beats a 25-min walk
    expect(chooseMode([route("WALK", 20), route("TRANSIT", 12, 3)] as never, prefs({ travel: { fewerTransfers: true } }))).toBe("WALK"); // 12 + 2 extra transfers × 10 > 20
    expect(chooseMode([route("DRIVE", 5)] as never, prefs({ travel: { avoidModes: ["DRIVE"] } }))).toBeNull();
  });

  it("fits the number of suggestions to the pace", () => {
    expect(roomFor(day(), "relaxed")).toBe(0); // 4 stops already
    expect(roomFor(day(), "balanced")).toBe(2);
    expect(roomFor(day(), "intensive")).toBe(4);
    expect(searchTypes(prefs({ travel: { interests: ["architecture", "museums", "nature"] } })).map((t) => t.type)).toEqual(["restaurant", "tourist_attraction", "museum", "park"]);
  });

  it("turns the model's choice into exact edits, dropping anything it may not do", () => {
    const candidates = [cand("ramen", "food", "Moderate"), cand("museum", "attraction")];
    const draft = buildDraft(
      {
        summary: "Reorder the afternoon and add ramen.",
        order: ["c", "a", "b"],
        suggestions: [
          { placeId: "ramen", afterActivityId: "opera", reason: "Japanese, moderate price" },
          { placeId: "ChIJ-invented", afterActivityId: "opera", reason: "made up" },
          { placeId: "museum", afterActivityId: "not-a-stop", reason: "bad anchor" },
          { placeId: "ramen", afterActivityId: "a", reason: "duplicate" },
        ],
        caveats: [],
      },
      day(),
      prefs({ travel: { pace: "balanced", transport: "transit" }, food: { allergies: "peanuts" } }),
      candidates,
    );
    const moves = draft.changes.filter((c) => c.type === "move");
    expect(moves.map((m) => (m as { activityId: string }).activityId)).toEqual(["c", "a", "b"]);
    expect(moves.some((m) => (m as { activityId: string }).activityId === "opera")).toBe(false); // timed stops never move
    expect(draft.changes.find((c) => c.type === "mode")).toMatchObject({ segmentId: "s1", to: "TRANSIT" });
    const adds = draft.changes.filter((c) => c.type === "add") as Extract<(typeof draft.changes)[number], { type: "add" }>[];
    expect(adds.map((a) => a.candidate.placeId)).toEqual(["ramen"]);
    expect(adds[0]).toMatchObject({ startMin: 600, durationMin: 60, meal: "lunch" }); // the stop before it ends at 10:00
    expect(adds[0].warning).toMatch(/can't confirm allergens/);
    expect(draft.caveats.join(" ")).toMatch(/Ask each restaurant/);
    expect(draft.preferences.hard.join(" ")).toMatch(/Allergies \(peanuts\)/);
  });

  it("ignores an order that isn't exactly the untimed stops, and adds nothing when the pace has no room", () => {
    const d = buildDraft({ summary: "x", order: ["opera", "a", "b"], suggestions: [{ placeId: "m", afterActivityId: "a", reason: "" }], caveats: [] }, day(), prefs({ travel: { pace: "relaxed" } }), [cand("m", "attraction")]);
    expect(d.changes.filter((c) => c.type !== "mode")).toEqual([]);
    expect(hardConstraints(prefs())).toEqual(["Times you've already set stay as they are."]);
  });
});

describe("the plan and preferences endpoints", () => {
  let stub: Awaited<ReturnType<typeof stubProvider>>;
  let app: Awaited<ReturnType<typeof startApp>>;
  beforeAll(async () => {
    stub = await stubProvider();
    app = await startApp({ OPENAI_API_KEY: "planner-test-secret-value", OPENAI_BASE_URL: stub.url, WAYLINE_AI_DAILY_LIMIT: "8", WAYLINE_AI_ADMINS: "plannerdev" });
  });
  afterAll(async () => {
    stub.server.close();
    await app.stop();
  });
  const reorder = (body: any) => {
    const ids = [...body.input.matchAll(/"id":"([0-9a-f-]{36})","title":"([^"]+)","type":"[a-z]+","fixed":false/g)].map((m) => m[1]);
    return text({ summary: "Swap the two untimed stops.", order: [...ids].reverse(), suggestions: [], caveats: [] });
  };

  it("keeps food private to the person and shared choices on the trip", async () => {
    const owner = await signUp(app.url);
    const guest = await signUp(app.url);
    const trip = await newTrip(owner);
    await share(owner, guest, trip.id);
    expect((await owner.get("/api/me/preferences")).data.preferences).toMatchObject({ confirmed: false });
    const saved = await owner.send("PUT", "/api/me/preferences", { food: { cuisines: ["japanese"], allergies: "peanuts", diets: ["vegetarian"], price: "moderate" }, travel: { pace: "relaxed", transport: "transit" } });
    expect(saved.status).toBe(200);
    expect((await owner.send("PUT", "/api/me/preferences", { food: { cuisines: ["martian"] } })).status).toBe(400);
    expect((await owner.send("PUT", `/api/trips/${trip.id}/preferences`, { food: { allergies: "x" } })).status).toBe(400); // food is personal
    expect((await guest.send("PUT", `/api/trips/${trip.id}/preferences`, { travel: { pace: "intensive", interests: ["museums"] } })).status).toBe(200);

    const forOwner = (await owner.get(`/api/trips/${trip.id}/preferences`)).data;
    expect(forOwner.effective.travel).toMatchObject({ pace: "intensive", transport: "transit", interests: ["museums"] }); // trip wins, own defaults fill in
    expect(forOwner.effective.food.allergies).toBe("peanuts");
    expect((await owner.get("/api/me/preferences")).data.preferences.travel.pace).toBe("relaxed"); // defaults untouched
    // the guest sees the trip's choices, never the owner's food
    const forGuest = (await guest.get(`/api/trips/${trip.id}/preferences`)).data;
    expect(JSON.stringify(forGuest)).not.toMatch(/peanuts|vegetarian|japanese/);
    expect(JSON.stringify((await guest.get(`/api/trips/${trip.id}`)).data)).not.toMatch(/peanuts/);
    const outsider = await signUp(app.url);
    expect((await outsider.get(`/api/trips/${trip.id}/preferences`)).status).toBe(404);
  });

  it("asks for preferences first, previews, then applies exactly the preview", async () => {
    stub.reply.fn = reorder;
    const c = await signUp(app.url);
    const trip = await newTrip(c);
    await addActivity(c, trip, { title: "Opera House", startMin: 540 });
    await addActivity(c, trip, { title: "Gallery", startMin: null });
    await addActivity(c, trip, { title: "Rocks", startMin: null });
    const dayId = trip.days[0].id;
    const before = stub.seen.length;
    const first = await c.send("POST", `/api/trips/${trip.id}/plan`, { dayId });
    expect(first).toMatchObject({ status: 409, data: { code: "preferences" } });
    expect(stub.seen.length).toBe(before); // no model call without preferences
    await c.send("PUT", "/api/me/preferences", { food: {}, travel: { pace: "balanced" } });

    const plan = await c.send("POST", `/api/trips/${trip.id}/plan`, { dayId });
    expect(plan.status).toBe(200);
    expect(plan.data).toMatchObject({ summary: "Swap the two untimed stops.", basedOn: expect.any(String), draftId: expect.any(String) });
    expect(plan.data.changes.filter((x: any) => x.type === "move").map((x: any) => x.title)).toEqual(["Rocks", "Gallery"]);
    expect(stub.seen.at(-1)!.body.input).not.toContain(c.userId);
    // nothing changed yet
    const titles = async () => (await c.get(`/api/trips/${trip.id}`)).data.days[0].activities.map((a: any) => a.title);
    expect(await titles()).toEqual(["Opera House", "Gallery", "Rocks"]);
    // a client can't send its own version of the plan
    expect((await c.send("POST", `/api/trips/${trip.id}/plan/apply`, { draftId: "plan_forged", changes: [] })).status).toBe(410);
    const applied = await c.send("POST", `/api/trips/${trip.id}/plan/apply`, { draftId: plan.data.draftId });
    expect(applied.status).toBe(200);
    expect(await titles()).toEqual(["Opera House", "Rocks", "Gallery"]);
    expect((await c.send("POST", `/api/trips/${trip.id}/plan/apply`, { draftId: plan.data.draftId })).status).toBe(410); // used up
  });

  it("refuses a plan once the day has changed", async () => {
    stub.reply.fn = reorder;
    const c = await signUp(app.url);
    await c.send("PUT", "/api/me/preferences", { food: {}, travel: {} });
    const trip = await newTrip(c);
    await addActivity(c, trip, { title: "A", startMin: null });
    await addActivity(c, trip, { title: "B", startMin: null });
    const plan = await c.send("POST", `/api/trips/${trip.id}/plan`, { dayId: trip.days[0].id });
    await addActivity(c, trip, { title: "C", startMin: 700 });
    const res = await c.send("POST", `/api/trips/${trip.id}/plan/apply`, { draftId: plan.data.draftId });
    expect(res).toMatchObject({ status: 409, data: { code: "stale" } });
  });

  it("holds collaborators to their rights when they apply a plan", async () => {
    stub.reply.fn = reorder;
    const owner = await signUp(app.url);
    const guest = await signUp(app.url);
    const trip = await newTrip(owner);
    await share(owner, guest, trip.id);
    await addActivity(owner, trip, { title: "Owner A", startMin: null });
    await addActivity(owner, trip, { title: "Owner B", startMin: null });
    await guest.send("PUT", "/api/me/preferences", { food: {}, travel: {} });
    const plan = await guest.send("POST", `/api/trips/${trip.id}/plan`, { dayId: trip.days[0].id });
    expect(plan.status).toBe(200);
    expect((await guest.send("POST", `/api/trips/${trip.id}/plan/apply`, { draftId: plan.data.draftId })).status).toBe(403);
    // someone else's draft can't be applied either
    expect((await owner.send("POST", `/api/trips/${trip.id}/plan/apply`, { draftId: plan.data.draftId })).status).toBe(410);
  });

  it("stops at the app-wide daily limit without calling the provider, and reports usage to admins only", async () => {
    stub.reply.fn = reorder;
    const dev = await signUp(app.url, "plannerdev");
    const someone = await signUp(app.url);
    expect((await someone.get("/api/admin/ai-usage")).status).toBe(404);
    await dev.send("PUT", "/api/me/preferences", { food: {}, travel: {} });
    const trip = await newTrip(dev);
    await addActivity(dev, trip, { title: "A", startMin: null });
    await addActivity(dev, trip, { title: "B", startMin: null });
    let last;
    for (let i = 0; i < 10; i++) last = await dev.send("POST", `/api/trips/${trip.id}/plan`, { dayId: trip.days[0].id });
    expect(last).toMatchObject({ status: 503, data: { error: expect.stringMatching(/usage limit/) } });
    const usage = (await dev.get("/api/admin/ai-usage")).data;
    expect(usage.today.requests).toBe(8);
    expect(usage.limits).toMatchObject({ requestsPerDay: 8, concurrent: 3 });
    expect(JSON.stringify(usage)).not.toContain("planner-test-secret-value");
    // the rest of the site still works
    expect((await addActivity(dev, trip, { title: "Still works" })).status).toBe(201);
    // the key appears nowhere the app printed
    expect(app.output()).not.toContain("planner-test-secret-value");
  });
});
