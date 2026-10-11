import { describe, expect, inject, it } from "vitest";
import { addActivity, logIn, newTrip, signUp, startApp, uniqueName } from "./helpers.ts";

// The starting point and spots picked on the map: the start is the first
// stop of the first day and stays there; changing it keeps every other stop;
// a picked spot keeps its own coordinates and never gets a made-up Google id.
const baseUrl = inject("baseUrl");
const titles = (trip: any, day = 0) => trip.days[day].activities.map((a: any) => a.title);
const custom = (lat: number, lng: number) => ({ placeId: `custom:${crypto.randomUUID()}`, source: "custom", lat, lng });
const setStart = (c: any, trip: any, title: string, place: any) => c.send("PUT", `/api/trips/${trip.id}/start`, { clientId: crypto.randomUUID(), title, place });

describe("the starting point", () => {
  it("goes first on day one, ahead of stops already planned, and only once", async () => {
    const c = await signUp(baseUrl);
    const trip = await newTrip(c);
    await addActivity(c, trip, { title: "Opera House" });
    const r = await setStart(c, trip, "Central Station", custom(-33.8832, 151.2069));
    expect(r.status).toBe(200);
    expect(titles(r.data.trip)).toEqual(["Central Station", "Opera House"]);
    expect(r.data.trip.days[0].activities[0]).toMatchObject({ role: "start", place: { source: "custom", lat: -33.8832, lng: 151.2069 } });
    expect(r.data.trip.days[0].activities[1].role).toBe(null);
  });

  it("changes in place, keeping the other stops and their order", async () => {
    const c = await signUp(baseUrl);
    const trip = await newTrip(c);
    const first = (await setStart(c, trip, "Hotel", custom(-33.87, 151.2))).data;
    for (const t of ["Zoo", "Lunch"]) await addActivity(c, trip, { title: t });
    const r = await setStart(c, trip, "Airport", custom(-33.94, 151.17));
    expect(r.data.activityId).toBe(first.activityId);
    expect(titles(r.data.trip)).toEqual(["Airport", "Zoo", "Lunch"]);
    expect(r.data.trip.days[0].activities[0].place.lat).toBe(-33.94);
  });

  it("can't be moved, and nothing can be put or moved ahead of it", async () => {
    const c = await signUp(baseUrl);
    const trip = await newTrip(c);
    const start = (await setStart(c, trip, "Hotel", custom(-33.87, 151.2))).data.activityId;
    const zoo = (await addActivity(c, trip, { title: "Zoo", startMin: null })).data.activityId;
    const early = await addActivity(c, trip, { title: "Breakfast", startMin: null, index: 0 });
    expect(titles(early.data.trip)).toEqual(["Hotel", "Breakfast", "Zoo"]);
    const moved = await c.send("POST", `/api/trips/${trip.id}/activities/${zoo}/move`, { dayId: trip.days[0].id, index: 0 });
    expect(titles(moved.data)).toEqual(["Hotel", "Zoo", "Breakfast"]);
    const refused = await c.send("POST", `/api/trips/${trip.id}/activities/${start}/move`, { dayId: trip.days[0].id, index: 2 });
    expect(refused.status).toBe(400);
    expect(titles((await c.get(`/api/trips/${trip.id}`)).data)).toEqual(["Hotel", "Zoo", "Breakfast"]);
  });

  it("is kept across a restart, and older trips without one still open", async () => {
    const app = await startApp();
    try {
      const name = uniqueName("start");
      const c = await signUp(app.url, name);
      const old = await newTrip(c);
      await addActivity(c, old, { title: "Before starting points" });
      const trip = await newTrip(c);
      await setStart(c, trip, "Tokyo Station", custom(35.6812, 139.7671));
      await addActivity(c, trip, { title: "Senso-ji" });
      const dataDir = app.dataDir;
      await app.stop();
      const again = await startApp({}, dataDir);
      try {
        const c2 = await logIn(again.url, name);
        const kept = (await c2.get(`/api/trips/${trip.id}`)).data;
        expect(titles(kept)).toEqual(["Tokyo Station", "Senso-ji"]);
        expect(kept.days[0].activities[0]).toMatchObject({ role: "start", place: { lat: 35.6812, lng: 139.7671 } });
        const before = (await c2.get(`/api/trips/${old.id}`)).data;
        expect(before.days[0].activities.map((a: any) => a.role)).toEqual([null]);
      } finally {
        await again.stop();
      }
    } finally {
      await app.stop();
    }
  });
});

describe("the starting point with several people", () => {
  it("refuses a change based on a start someone else has replaced, instead of overwriting it", async () => {
    const a = await signUp(baseUrl);
    const trip = await newTrip(a);
    const put = (title: string, baseVersion: number | null) =>
      a.send("PUT", `/api/trips/${trip.id}/start`, { clientId: crypto.randomUUID(), title, place: custom(-33.87, 151.2), baseVersion });
    const first = await put("Hotel", null);
    expect(first.status).toBe(200);
    const v = first.data.trip.days[0].activities[0].version;
    // two people both saw version v and both press "Start here"
    const [x, y] = await Promise.all([put("Airport", v), put("Station", v)]);
    expect([x.status, y.status].sort()).toEqual([200, 409]);
    const loser = x.status === 409 ? x : y;
    const winner = x.status === 200 ? "Airport" : "Station";
    expect(loser.data.current.title).toBe(winner);
    // a second start can't be created by someone who thought there was none
    expect((await put("Somewhere", null)).status).toBe(409);
    // retrying on the version they were shown replaces it on purpose
    expect((await put("Ferry wharf", loser.data.current.version)).status).toBe(200);
  });

  it("can't be set or routed on someone else's trip", async () => {
    const owner = await signUp(baseUrl);
    const outsider = await signUp(baseUrl);
    const trip = await newTrip(owner);
    const r = await outsider.send("PUT", `/api/trips/${trip.id}/start`, { clientId: crypto.randomUUID(), title: "Mine now", place: custom(1, 1) });
    expect(r.status).toBe(404);
    const route = await outsider.send("POST", `/api/trips/${trip.id}/routes`, { fromId: crypto.randomUUID(), toId: crypto.randomUUID() });
    expect(route.status).toBe(404);
    expect((await owner.get(`/api/trips/${trip.id}`)).data.days[0].activities).toEqual([]);
  });
});

describe("spots picked on the map", () => {
  it("are stored with their coordinates and a custom id, never a Google id", async () => {
    const c = await signUp(baseUrl);
    const trip = await newTrip(c);
    const place = custom(-33.8915, 151.2767);
    const r = await addActivity(c, trip, { title: "Bondi lookout", place });
    expect(r.status).toBe(201);
    expect(r.data.trip.days[0].activities[0].place).toEqual(place);
  });

  it("refuses an id that pretends to be something else, writing nothing", async () => {
    const c = await signUp(baseUrl);
    const trip = await newTrip(c);
    for (const place of [
      { placeId: "ChIJ_real_looking", source: "custom", lat: 1, lng: 1 },
      { placeId: "custom:x", source: "custom", lat: 1, lng: 1 },
      { placeId: "custom:0123456789", source: "google", lat: 1, lng: 1 },
      { placeId: "custom:0123456789", source: "custom", lat: 200, lng: 1 },
    ]) {
      expect((await addActivity(c, trip, { title: "Nope", place })).status, JSON.stringify(place)).toBe(400);
    }
    expect(titles((await c.get(`/api/trips/${trip.id}`)).data)).toEqual([]);
  });

  it("allows a deliberate second visit to the same place", async () => {
    const c = await signUp(baseUrl);
    const trip = await newTrip(c);
    const place = { placeId: "demo:opera-house", source: "demo", lat: -33.8568, lng: 151.2153 };
    await addActivity(c, trip, { title: "Opera House", place });
    const again = await addActivity(c, trip, { title: "Opera House", place });
    expect(again.status).toBe(201);
    expect(titles(again.data.trip)).toEqual(["Opera House", "Opera House"]);
  });
});
