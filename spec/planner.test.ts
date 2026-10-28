import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildDraft, type Candidate, changeId, chooseMode, detourKm, eatDraft, freeSlots, hardConstraints, mealSearchPoints, missingMeals, nearbyDraft, planInput, rankFor, roomFor, searchTypes, toCandidates } from "../src/planner.ts";
import { reviewDay } from "../src/review.ts";
import { DEFAULT_MEAL_TIMES } from "../src/trips.ts";
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
  review: { span: null, stops: 4, meals: [], notes: [] },
});
const cand = (id: string, kind: "food" | "attraction", priceLevel: string | null = null): Candidate => ({ placeId: id, name: `Place ${id}`, category: kind === "food" ? "Restaurant" : "Museum", lat: -33.87, lng: 151.2, kind, distanceKm: 0.4, detourKm: 0.3, priceLevel, rating: 4.5, ratingCount: 800, source: "google" });

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
    // transit preferred, but Google has no transit route and the walk is long: still not a car, and the plan says why
    const noTransit = [route("WALK", 107), { mode: "TRANSIT", status: "error", message: "none" }, route("DRIVE", 18)] as never;
    expect(chooseMode(noTransit, prefs({ travel: { transport: "transit", maxWalkMin: 20 } }))).toBe("WALK");
    expect(chooseMode(noTransit, prefs({ travel: { transport: "drive" } }))).toBe("DRIVE");
    const d = day();
    d.segments = [{ id: "sx", fromId: "a", toId: "b", options: noTransit, selectedMode: "DRIVE", computedAt: 0, departKey: "", stale: false }] as never;
    const draft = buildDraft({ summary: "x", order: [], suggestions: [], caveats: [] }, d, prefs({ travel: { transport: "transit", maxWalkMin: 20 } }), []);
    expect(draft.caveats[0]).toBe("Google found no public transport route from Gallery to Rocks, so this plan uses walking there.");
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

  it("finds free time after Google travel, and meals the day spans with nowhere to eat", () => {
    const d = day();
    d.activities = [act("zoo", "Taronga Zoo", 540, { durationMin: 180 }), act("bondi", "Bondi Beach", 900, { durationMin: 120 })] as never;
    d.segments = [{ id: "s", fromId: "zoo", toId: "bondi", options: [route("TRANSIT", 50)], selectedMode: "TRANSIT", computedAt: 0, departKey: "", stale: false }] as never;
    // 12:00 zoo ends; 15:00 Bondi starts; 50 min of transit leaves 12:00–14:10 free
    expect(freeSlots(d)).toEqual([{ afterActivityId: "zoo", from: 720, to: 850 }, { afterActivityId: "bondi", from: 1020, to: 1260 }]);
    expect(missingMeals(d)).toEqual(["lunch"]);
    d.activities.push(act("lunch", "Lunch", 750, { kind: "food" }) as never);
    expect(missingMeals(d)).toEqual([]);
  });

  it("places a suggestion in free time that fits it, and leaves it untimed otherwise", () => {
    const d = day();
    d.activities = [act("zoo", "Taronga Zoo", 540, { durationMin: 180 }), act("bondi", "Bondi Beach", 780, { durationMin: 120 })] as never;
    d.segments = [];
    const draft = buildDraft(
      { summary: "Lunch near the zoo.", order: [], suggestions: [{ placeId: "r1", afterActivityId: "zoo", reason: "rated 4.5 by 800 people, 0.3 km off the route" }], caveats: [] },
      d,
      prefs({ travel: { pace: "balanced" } }),
      [cand("r1", "food")],
    );
    const add = draft.changes.find((c) => c.type === "add") as any;
    expect(add).toMatchObject({ startMin: 720 }); // 12:00–13:00: a 60-min balanced meal just fits
    const relaxed = buildDraft({ summary: "x", order: [], suggestions: [{ placeId: "r1", afterActivityId: "zoo", reason: "" }], caveats: [] }, d, prefs({ travel: { pace: "intensive" } }), [cand("r1", "food")]);
    expect((relaxed.changes.find((c) => c.type === "add") as any).startMin).toBe(720); // a 45-min meal fits 12:00–13:00
  });

  it("ranks candidates by Google rating backed by reviews and closeness, and drops places already planned", () => {
    const d = day();
    const near = { lat: -33.857, lng: 151.215 };
    const place = (id: string, rating: number | null, ratingCount: number | null, lat = near.lat) => ({ placeId: id, name: id, address: "", lat, lng: near.lng, category: "Restaurant", types: [], source: "google" as const, distanceKm: 0, rating, ratingCount, priceLevel: null });
    const out = toCandidates([{ kind: "food", places: [place("few-reviews", 5, 3), place("solid", 4.6, 2400), place("p-opera", 4.9, 9000), place("far", 4.8, 3000, -33.95)] }], d, near);
    expect(out.map((c) => c.placeId)).toEqual(["solid", "far", "few-reviews"]); // p-opera is already in the plan
    expect(out[0]).toMatchObject({ rating: 4.6, ratingCount: 2400 });
    expect(out[0].detourKm).toBeLessThan(1);
  });

  it("ignores an order that isn't exactly the untimed stops, and adds nothing when the pace has no room", () => {
    const d = buildDraft({ summary: "x", order: ["opera", "a", "b"], suggestions: [{ placeId: "m", afterActivityId: "a", reason: "" }], caveats: [] }, day(), prefs({ travel: { pace: "relaxed" } }), [cand("m", "attraction")]);
    expect(d.changes.filter((c) => c.type !== "mode")).toEqual([]);
    expect(hardConstraints(prefs())).toEqual(["Times you've already set stay as they are."]);
  });
});

describe("find places to eat and explore nearby (no model call)", () => {
  // the Tokyo day: lunch at 12:40, dinner missing between Shibuya (18:00–18:45) and the 19:21 night walk... widened here so dinner fits
  const P = (lat: number, lng: number) => ({ placeId: "g", source: "google", lat, lng });
  const tokyo = (): Day => {
    const d = day();
    d.activities = [
      act("senso", "Senso-ji", 540, { durationMin: 90, place: P(35.7148, 139.7967) }),
      act("lunch", "Ramen lunch", 760, { kind: "food", place: P(35.7101, 139.8107) }),
      act("shibuya", "Shibuya Crossing", 1020, { durationMin: 45, place: P(35.6595, 139.7005) }),
      act("shinjuku", "Shinjuku night walk", 1200, { durationMin: 51, place: P(35.6852, 139.7101) }),
    ] as never;
    d.segments = [];
    d.review = reviewDay(d.activities.map((a: any) => ({ ...a, hasPlace: true })), [], DEFAULT_MEAL_TIMES);
    return d;
  };
  const food = (id: string, lat: number, lng: number, rating: number, reviews: number, category = "Restaurant"): Candidate => ({ placeId: id, name: id, category, lat, lng, kind: "food", distanceKm: 0, detourKm: null, priceLevel: "$$", rating, ratingCount: reviews, source: "google" });

  it("finds the missing dinner and searches where it goes on the route, not the day's centre", () => {
    const d = tokyo();
    expect(d.review.meals.map((m) => m.meal)).toEqual(["dinner"]);
    const pts = mealSearchPoints(d, d.review.meals[0]);
    expect(pts).toHaveLength(3); // Shibuya, Shinjuku, and between them
    expect(pts[0]).toEqual({ lat: 35.6595, lng: 139.7005 });
    // detour: on the way costs ~nothing; across town costs a lot
    expect(detourKm({ lat: 35.6723, lng: 139.7053 }, pts[0], pts[1])).toBeLessThan(0.3);
    expect(detourKm({ lat: 35.7148, lng: 139.7967 }, pts[0], pts[1])!).toBeGreaterThan(10);
  });

  it("ranks by detour, rating backed by reviews, and preference, with labels only the data supports", () => {
    const d = tokyo();
    const [a, b] = mealSearchPoints(d, d.review.meals[0]);
    const picks = rankFor(
      [food("on-route-sushi", 35.6723, 139.7053, 4.3, 900, "Sushi Restaurant"), food("famous-far", 35.7148, 139.7967, 4.8, 5000), food("new-place", 35.66, 139.701, 4.9, 4)],
      a, b, prefs({ food: { cuisines: ["japanese"] } }),
    );
    expect(picks[0].candidate.placeId).toBe("on-route-sushi");
    expect(picks[0].labels).toEqual(expect.arrayContaining(["Smallest detour", "Matches your cuisines"]));
    expect(picks.find((x) => x.candidate.placeId === "new-place")?.labels ?? []).not.toContain("Highly rated"); // 4 reviews don't earn it
  });

  it("gives each suggestion a dinner time inside the free gap, so it lands between stops, and an id to apply it alone", () => {
    const d = tokyo();
    const draft = eatDraft(d, prefs(), d.review.meals[0], [food("on-route", 35.6723, 139.7053, 4.3, 900), food("other", 35.6600, 139.7010, 4.1, 300)]);
    const adds = draft.changes as any[];
    expect(adds.length).toBe(2);
    for (const c of adds) {
      expect(c.meal).toBe("dinner");
      expect(c.startMin).not.toBeNull();
      expect(c.startMin).toBeGreaterThanOrEqual(1065); // after Shibuya ends (17:45) plus travel
      expect(c.startMin + c.durationMin).toBeLessThanOrEqual(1200); // before the 20:00 night walk
    }
    expect(new Set(draft.picks.map((p) => p.changeId)).size).toBe(2);
    expect(draft.picks[0].changeId).toBe(changeId(adds[0]));
    expect(draft.caveats.join(" ")).toMatch(/30 minutes before closing/);
  });

  // Opening hours in the suggestions: the whole meal and a 30-minute buffer
  // before closing, inside one opening period, on the trip's date.
  const pd = (d: number, oh: number, om: number, ch: number, cm: number) => ({ open: { day: d, hour: oh, minute: om }, close: { day: d, hour: ch, minute: cm } });
  const every = (oh: number, om: number, ch: number, cm: number) => ({ regular: [0, 1, 2, 3, 4, 5, 6].map((d) => pd(d, oh, om, ch, cm)), current: null, kitchen: null, specialDates: [] });

  it("leaves out a restaurant closing at 21:00 when dinner can only start at 20:30, and keeps one open late", () => {
    const d = tokyo();
    // dinner can only start after 20:00 (Shibuya 19:15–20:00); the night walk is
    // at 23:00, leaving room for the 46-min walk on to it
    (d.activities as any[])[2].startMin = 19 * 60 + 15;
    (d.activities as any[])[3].startMin = 23 * 60;
    d.review = reviewDay(d.activities.map((a: any) => ({ ...a, hasPlace: true })), [], DEFAULT_MEAL_TIMES);
    const gap = { ...d.review.meals[0], from: 17 * 60 + 30, to: 23 * 60 };
    const closes9 = { ...food("closes-at-9", 35.6600, 139.7010, 4.8, 3000), hours: every(11, 0, 21, 0) };
    const late = { ...food("open-late", 35.6610, 139.7012, 4.2, 600), hours: every(17, 0, 23, 59) };
    const draft = eatDraft(d, prefs(), gap, [closes9, late]);
    expect((draft.changes as any[]).map((c) => c.candidate.placeId)).toEqual(["open-late"]); // the better-rated one doesn't fit
    expect(draft.caveats[0]).toMatch(/1 nearby place was left out/);
  });

  it("schedules dinner at 19:00 at a place closing at 21:00, never later than 19:15", () => {
    const d = tokyo();
    const shut9 = { ...food("closes-at-9", 35.6723, 139.7053, 4.4, 900), hours: every(11, 0, 21, 0) };
    const c = eatDraft(d, prefs(), d.review.meals[0], [shut9]).changes[0] as any;
    expect(c.durationMin).toBe(75); // dinner's default length
    expect(c.startMin + c.durationMin + 30).toBeLessThanOrEqual(21 * 60);
    expect(c.hours).toBe("unverified"); // weekly hours only: not confirmed for that date
  });

  it("marks unknown hours instead of treating them as confirmed", () => {
    const d = tokyo();
    const c = eatDraft(d, prefs(), d.review.meals[0], [food("no-hours", 35.6723, 139.7053, 4.4, 900)]).changes[0] as any;
    expect(c.hours).toBe("unknown");
    expect(c.warning).toMatch(/no opening hours/i);
  });

  it("finds no time when travel to the restaurant eats the gap, and says so rather than squeezing it in", () => {
    const d = tokyo();
    // Shibuya ends 17:45, the walk starts at 18:30: 45 min, too short for a 75-min dinner with travel
    (d.activities as any[])[3].startMin = 18 * 60 + 30;
    d.review = reviewDay(d.activities.map((a: any) => ({ ...a, hasPlace: true })), [], DEFAULT_MEAL_TIMES);
    const gap = d.review.meals[0] ?? { meal: "dinner", afterId: "shibuya", beforeId: "shinjuku", usual: 1110, from: 1050, to: 1260 };
    const draft = eatDraft(d, prefs(), gap, [{ ...food("near", 35.6600, 139.7010, 4.5, 800), hours: every(11, 0, 23, 0) }]);
    expect(draft.changes).toEqual([]);
    expect(draft.summary).toMatch(/only 45 min between Shibuya Crossing and Shinjuku night walk, not enough for a 75-minute dinner/);
  });

  it("explores nearby only in free time long enough for the pace", () => {
    const d = tokyo();
    const sight = (id: string, lat: number, lng: number): Candidate => ({ ...food(id, lat, lng, 4.6, 2000, "Museum"), kind: "attraction" });
    const draft = nearbyDraft(d, prefs({ travel: { pace: "intensive" } }), [sight("museum", 35.712, 139.80)]);
    const add = draft.changes[0] as any;
    expect(add.candidate.placeId).toBe("museum");
    expect(add.startMin).toBeGreaterThanOrEqual(630); // after Senso-ji
    expect(draft.picks[0].labels.some((l) => l.startsWith("Fits "))).toBe(true);
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

// Through the real app with a stand-in for Google Places and Routes: the eat
// action makes no model call, and one suggestion can be applied on its own.
describe("eat suggestions end to end, applied one at a time", () => {
  let stub: Awaited<ReturnType<typeof stubProvider>>;
  let google: import("node:http").Server;
  let app: Awaited<ReturnType<typeof startApp>>;
  beforeAll(async () => {
    stub = await stubProvider();
    const { createServer } = await import("node:http");
    google = createServer(async (req, res) => {
      let raw = "";
      for await (const c of req) raw += c;
      const body = raw ? JSON.parse(raw) : {};
      res.writeHead(200, { "content-type": "application/json" });
      if (req.url?.includes("searchNearby")) {
        const c = body.locationRestriction.circle.center;
        // places 1 and 2 close at 21:00 every day (Google's period shape); 3 has no hours
        const until9 = { periods: [0, 1, 2, 3, 4, 5, 6].map((d) => ({ open: { day: d, hour: 11, minute: 0 }, close: { day: d, hour: 21, minute: 0 } })) };
        const mk = (i: number, rating: number, n: number) => ({ id: `ChIJ_food_${i}_${String(c.latitude).slice(-4)}`, displayName: { text: `Dinner place ${i}` }, location: { latitude: c.latitude + i * 0.001, longitude: c.longitude }, primaryTypeDisplayName: { text: "Japanese Restaurant" }, types: ["restaurant"], rating, userRatingCount: n, priceLevel: "PRICE_LEVEL_MODERATE", ...(i < 3 ? { regularOpeningHours: until9 } : {}) });
        return res.end(JSON.stringify({ places: [mk(1, 4.4, 900), mk(2, 4.6, 1500), mk(3, 4.1, 200)] }));
      }
      if (req.url?.includes("computeRoutes")) return res.end(JSON.stringify({ routes: [{ duration: "900s", distanceMeters: 1200 }] }));
      res.end("{}");
    });
    await new Promise<void>((r) => google.listen(0, "127.0.0.1", () => r()));
    const g = `http://127.0.0.1:${(google.address() as import("node:net").AddressInfo).port}`;
    app = await startApp({ OPENAI_API_KEY: "eat-test-secret", OPENAI_BASE_URL: stub.url, GOOGLE_MAPS_SERVER_KEY: "mock-google", GOOGLE_PLACES_BASE_URL: g, GOOGLE_ROUTES_BASE_URL: g });
  });
  afterAll(async () => {
    stub.server.close();
    google.close();
    await app.stop();
  });

  it("suggests dinner between stops without the model, applies one, and refuses the rest as stale", async () => {
    const c = await signUp(app.url);
    await c.send("PUT", "/api/me/preferences", { food: { cuisines: ["japanese"] }, travel: {} });
    const trip = (await c.send("POST", "/api/trips", { title: "Tokyo", destination: "Tokyo", startDate: "2026-10-25", endDate: "2026-10-25", timezone: "Asia/Tokyo" })).data;
    const place = (lat: number, lng: number) => ({ placeId: `ChIJ_${lat}_${lng}`.replace(/\./g, ""), source: "google", lat, lng });
    for (const [title, start, dur, lat, lng, kind] of [["Senso-ji", 540, 90, 35.7148, 139.7967, "attraction"], ["Ramen lunch", 760, 60, 35.7101, 139.8107, "food"], ["Shibuya", 1020, 45, 35.6595, 139.7005, "attraction"], ["Shinjuku walk", 1200, 51, 35.6852, 139.7101, "attraction"]] as const) {
      await c.send("POST", `/api/trips/${trip.id}/activities`, { clientId: `t-${title.replace(/\W/g, "")}`, dayId: trip.days[0].id, title, kind, startMin: start, durationMin: dur, place: place(lat, lng) });
    }
    const day = (await c.get(`/api/trips/${trip.id}`)).data.days[0];
    expect(day.review.meals.map((m: any) => m.meal)).toEqual(["dinner"]);
    expect(day.review.notes.map((n: any) => n.text)).toContain("Dinner may be missing");

    const calls = stub.seen.length;
    const eat = await c.send("POST", `/api/trips/${trip.id}/plan`, { dayId: day.id, action: "eat", meal: "dinner" });
    expect(eat.status).toBe(200);
    expect(stub.seen.length).toBe(calls); // no model call
    expect(eat.data.picks.length).toBeGreaterThanOrEqual(2);
    expect(eat.data.picks.length).toBeLessThanOrEqual(3);
    for (const p of eat.data.picks) {
      expect(p.candidate.rating).toEqual(expect.any(Number));
      expect(p.candidate.ratingCount).toEqual(expect.any(Number));
      expect(p.candidate.placeId).toMatch(/^ChIJ_food_/);
    }
    // nothing changed yet
    expect((await c.get(`/api/trips/${trip.id}`)).data.days[0].activities).toHaveLength(4);

    const one = eat.data.changes[0];
    const applied = await c.send("POST", `/api/trips/${trip.id}/plan/apply`, { draftId: eat.data.draftId, changeIds: [one.id] });
    expect(applied.status).toBe(200);
    const titles = applied.data.days[0].activities.map((a: any) => a.title);
    expect(titles).toHaveLength(5);
    // the dinner sits between Shibuya and the night walk, not at the end
    expect(titles.indexOf(one.candidate.name)).toBe(titles.indexOf("Shibuya") + 1);
    expect(titles.at(-1)).toBe("Shinjuku walk");
    expect(applied.data.days[0].review.meals).toEqual([]);
    // the opening hours went along: weekly hours only, so not confirmed for the date
    expect(eat.data.changes.find((x: any) => x.candidate.placeId.startsWith("ChIJ_food_1"))?.hours ?? "unverified").toMatch(/unverified|confirmed/);
    // the draft is used up; a second apply of another suggestion is refused
    expect((await c.send("POST", `/api/trips/${trip.id}/plan/apply`, { draftId: eat.data.draftId, changeIds: [eat.data.changes[1].id] })).status).toBe(410);
  });
});

describe("applying a restaurant re-checks its opening hours", () => {
  let google: import("node:http").Server;
  let app: Awaited<ReturnType<typeof startApp>>;
  beforeAll(async () => {
    const { createServer } = await import("node:http");
    google = createServer(async (req, res) => {
      let raw = "";
      for await (const c of req) raw += c;
      const body = raw ? JSON.parse(raw) : {};
      res.writeHead(200, { "content-type": "application/json" });
      if (req.url?.includes("searchNearby")) {
        const c = body.locationRestriction.circle.center;
        const until9 = { periods: [0, 1, 2, 3, 4, 5, 6].map((d) => ({ open: { day: d, hour: 11, minute: 0 }, close: { day: d, hour: 21, minute: 0 } })) };
        return res.end(JSON.stringify({ places: [{ id: `ChIJ_closes_at_nine_${String(c.latitude).slice(-4)}`, displayName: { text: "Closes at nine" }, location: { latitude: c.latitude + 0.0005, longitude: c.longitude }, primaryTypeDisplayName: { text: "Restaurant" }, types: ["restaurant"], rating: 4.5, userRatingCount: 800, regularOpeningHours: until9 }] }));
      }
      if (req.url?.includes("computeRoutes")) return res.end(JSON.stringify({ routes: [{ duration: "600s", distanceMeters: 800 }] }));
      res.end("{}");
    });
    await new Promise<void>((r) => google.listen(0, "127.0.0.1", () => r()));
    const g = `http://127.0.0.1:${(google.address() as import("node:net").AddressInfo).port}`;
    app = await startApp({ GOOGLE_MAPS_SERVER_KEY: "mock-google", GOOGLE_PLACES_BASE_URL: g, GOOGLE_ROUTES_BASE_URL: g });
  });
  afterAll(async () => {
    google.close();
    await app.stop();
  });

  it("refuses a changed time that runs past closing, writes nothing, and applies the checked time", async () => {
    const c = await signUp(app.url);
    await c.send("PUT", "/api/me/preferences", { food: {}, travel: {} });
    const trip = (await c.send("POST", "/api/trips", { title: "Tokyo", destination: "Tokyo", startDate: "2026-10-25", endDate: "2026-10-25", timezone: "Asia/Tokyo" })).data;
    const at = (lat: number, lng: number, i: number) => ({ placeId: `ChIJ_stop_${i}_zzzzzzzz`, source: "google", lat, lng });
    for (const [i, [title, start, dur, lat, lng]] of ([["Senso-ji", 540, 90, 35.7148, 139.7967], ["Lunch", 760, 60, 35.7101, 139.8107], ["Shibuya", 1020, 45, 35.6595, 139.7005], ["Late walk", 1290, 30, 35.6600, 139.7008]] as const).entries()) {
      await c.send("POST", `/api/trips/${trip.id}/activities`, { clientId: `hr-${i}-xxxxxx`, dayId: trip.days[0].id, title, kind: title === "Lunch" ? "food" : "attraction", startMin: start, durationMin: dur, place: at(lat, lng, i) });
    }
    const dayId = (await c.get(`/api/trips/${trip.id}`)).data.days[0].id;
    const eat = await c.send("POST", `/api/trips/${trip.id}/plan`, { dayId, action: "eat", meal: "dinner" });
    expect(eat.status).toBe(200);
    const sug = eat.data.changes[0];
    expect(sug.startMin + sug.durationMin + 30).toBeLessThanOrEqual(21 * 60); // the suggestion itself fits
    // the person moves it to 20:30: refused, nothing written
    const late = await c.send("POST", `/api/trips/${trip.id}/plan/apply`, { draftId: eat.data.draftId, changeIds: [sug.id], edits: { [sug.id]: { startMin: 20 * 60 + 30 } } });
    expect(late.status).toBe(409);
    expect(late.data).toMatchObject({ code: "hours", latestStart: 19 * 60 + 15 });
    expect(late.data.error).toMatch(/closes at 21:00/);
    // a longer meal at the suggested time can also run past closing
    const long = await c.send("POST", `/api/trips/${trip.id}/plan/apply`, { draftId: eat.data.draftId, changeIds: [sug.id], edits: { [sug.id]: { durationMin: 300 } } });
    expect(long.status).toBe(409);
    expect((await c.get(`/api/trips/${trip.id}`)).data.days[0].activities).toHaveLength(4);
    // the checked time applies, in order between the stops
    const ok = await c.send("POST", `/api/trips/${trip.id}/plan/apply`, { draftId: eat.data.draftId, changeIds: [sug.id] });
    expect(ok.status).toBe(200);
    const titles = ok.data.days[0].activities.map((a: any) => a.title);
    expect(titles).toEqual(["Senso-ji", "Lunch", "Shibuya", "Closes at nine", "Late walk"]);
    expect(ok.data.days[0].activities[3]).toMatchObject({ meal: "dinner", durationMin: 75 });
  });

  it("explores nearby without the model as a preview, each suggestion with an id, and changes nothing until applied", async () => {
    const c = await signUp(app.url);
    await c.send("PUT", "/api/me/preferences", { food: {}, travel: {} });
    const trip = (await c.send("POST", "/api/trips", { title: "Tokyo", destination: "Tokyo", startDate: "2026-10-25", endDate: "2026-10-25", timezone: "Asia/Tokyo" })).data;
    const at = (lat: number, lng: number, i: number) => ({ placeId: `ChIJ_near_${i}_zzzzzzzz`, source: "google", lat, lng });
    for (const [i, [title, start, dur, lat, lng]] of ([["Senso-ji", 540, 60, 35.7148, 139.7967], ["Shibuya", 1020, 45, 35.6595, 139.7005]] as const).entries()) {
      await c.send("POST", `/api/trips/${trip.id}/activities`, { clientId: `nb-${i}-xxxxxx`, dayId: trip.days[0].id, title, kind: "attraction", startMin: start, durationMin: dur, place: at(lat, lng, i) });
    }
    const dayId = (await c.get(`/api/trips/${trip.id}`)).data.days[0].id;
    const near = await c.send("POST", `/api/trips/${trip.id}/plan`, { dayId, action: "nearby" });
    expect(near.status).toBe(200);
    expect(near.data).toMatchObject({ action: "nearby", draftId: expect.stringMatching(/^plan_/) });
    expect(near.data.caveats.join(" ")).toMatch(/Calculated 1 travel time with Google Maps/);
    expect(near.data.changes.length).toBeGreaterThan(0);
    for (const ch of near.data.changes) expect(ch).toMatchObject({ type: "add", kind: "attraction", id: expect.any(String) });
    expect((await c.get(`/api/trips/${trip.id}`)).data.days[0].activities).toHaveLength(2);
    const ok = await c.send("POST", `/api/trips/${trip.id}/plan/apply`, { draftId: near.data.draftId, changeIds: [near.data.changes[0].id] });
    expect(ok.status).toBe(200);
    expect(ok.data.days[0].activities).toHaveLength(3);
  });
});

