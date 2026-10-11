import { DatabaseSync } from "node:sqlite";
import { join } from "node:path";
import { describe, expect, inject, it } from "vitest";
import { addActivity, logIn, newTrip, share, signUp, startApp, uniqueName, watchEvents } from "./helpers.ts";

// Time decides where a timed stop sits in its day, on the server; meals are
// saved with food stops; a stop can change place without losing anything
// else; and where someone's map is looking is shared live but never saved.
const baseUrl = inject("baseUrl");
const titles = (trip: any, day = 0) => trip.days[day].activities.map((a: any) => a.title);
const at = (hh: number, mm = 0) => hh * 60 + mm;

describe("stops in time order", () => {
  it("puts a new stop where its time belongs, not at the end", async () => {
    const c = await signUp(baseUrl);
    const trip = await newTrip(c);
    await addActivity(c, trip, { title: "Opera House", startMin: at(9) });
    await addActivity(c, trip, { title: "Lunch", startMin: at(12) });
    await addActivity(c, trip, { title: "Darling Harbour", startMin: at(16) });
    let r = await addActivity(c, trip, { title: "Botanic Garden", startMin: at(14) });
    expect(titles(r.data.trip)).toEqual(["Opera House", "Lunch", "Botanic Garden", "Darling Harbour"]);
    r = await addActivity(c, trip, { title: "Breakfast", startMin: at(7) });
    r = await addActivity(c, trip, { title: "Dinner", startMin: at(19) });
    expect(titles(r.data.trip)).toEqual(["Breakfast", "Opera House", "Lunch", "Botanic Garden", "Darling Harbour", "Dinner"]);
    expect(r.data.trip.days[0].activities.map((a: any) => a.position)).toEqual([0, 1, 2, 3, 4, 5]);
  });

  it("moves a stop when its time changes, keeping the same stop", async () => {
    const c = await signUp(baseUrl);
    const trip = await newTrip(c);
    const zoo = (await addActivity(c, trip, { title: "Zoo", startMin: at(9), notes: "Book online" })).data;
    await addActivity(c, trip, { title: "Lunch", startMin: at(12) });
    const r = await c.send("PATCH", `/api/trips/${trip.id}/activities/${zoo.activityId}`, { baseVersion: 1, startMin: at(15) });
    expect(titles(r.data)).toEqual(["Lunch", "Zoo"]);
    const moved = r.data.days[0].activities[1];
    expect(moved).toMatchObject({ id: zoo.activityId, version: 2, notes: "Book online", startMin: at(15) });
  });

  it("keeps both of two stops at the same time, in a fixed order", async () => {
    const c = await signUp(baseUrl);
    const trip = await newTrip(c);
    await addActivity(c, trip, { title: "First at noon", startMin: at(12) });
    const r = await addActivity(c, trip, { title: "Second at noon", startMin: at(12) });
    expect(titles(r.data.trip)).toEqual(["First at noon", "Second at noon"]);
    // an unrelated change elsewhere doesn't swap them
    const r2 = await addActivity(c, trip, { title: "Morning", startMin: at(8) });
    expect(titles(r2.data.trip)).toEqual(["Morning", "First at noon", "Second at noon"]);
  });

  it("puts untimed stops after the timed ones, in the order people chose", async () => {
    const c = await signUp(baseUrl);
    const trip = await newTrip(c);
    await addActivity(c, trip, { title: "Gelato", startMin: null });
    await addActivity(c, trip, { title: "Museum", startMin: at(10) });
    const r = await addActivity(c, trip, { title: "Souvenirs", startMin: null, index: 0 });
    expect(titles(r.data.trip)).toEqual(["Museum", "Souvenirs", "Gelato"]);
  });

  it("refuses to shuffle a timed stop within its day, but moves it to another day by its time", async () => {
    const c = await signUp(baseUrl);
    const trip = await newTrip(c);
    const zoo = (await addActivity(c, trip, { title: "Zoo", startMin: at(9) })).data.activityId;
    await addActivity(c, trip, { title: "Lunch", startMin: at(12) });
    const refused = await c.send("POST", `/api/trips/${trip.id}/activities/${zoo}/move`, { dayId: trip.days[0].id, index: 1 });
    expect(refused.status).toBe(400);
    expect(refused.data.error).toMatch(/Change its time/);
    await addActivity(c, trip, { title: "Day 2 dinner", dayId: trip.days[1].id, startMin: at(19) });
    await addActivity(c, trip, { title: "Day 2 breakfast", dayId: trip.days[1].id, startMin: at(8) });
    const r = await c.send("POST", `/api/trips/${trip.id}/activities/${zoo}/move`, { dayId: trip.days[1].id, index: 99 });
    expect(titles(r.data, 0)).toEqual(["Lunch"]);
    expect(titles(r.data, 1)).toEqual(["Day 2 breakfast", "Zoo", "Day 2 dinner"]);
    expect(r.data.days[1].activities[1].startMin).toBe(at(9));
  });

  it("puts trips saved before this in time order when the app starts", async () => {
    const app = await startApp();
    const name = uniqueName("old");
    const c = await signUp(app.url, name);
    const trip = await newTrip(c);
    for (const [t, m] of [["Late", at(18)], ["Early", at(8)], ["Noon", at(12)]] as const) await addActivity(c, trip, { title: t, startMin: m });
    await app.stop();
    // simulate the old order: positions as they were added
    const db = new DatabaseSync(join(app.dataDir, "wayline.db"));
    const rows = db.prepare("select id, title from activities where trip_id = ?").all(trip.id) as { id: string; title: string }[];
    const old = ["Late", "Early", "Noon"];
    for (const r of rows) db.prepare("update activities set position = ? where id = ?").run(old.indexOf(r.title), r.id);
    db.close();
    const again = await startApp({}, app.dataDir);
    try {
      const c2 = await logIn(again.url, name);
      expect(titles((await c2.get(`/api/trips/${trip.id}`)).data)).toEqual(["Early", "Noon", "Late"]);
    } finally {
      await again.stop();
    }
  });
});

describe("changing a stop's place", () => {
  const place = (id: string) => ({ placeId: `custom:${id}-0123456789`, source: "custom", lat: -33.86, lng: 151.21 });

  it("keeps the stop, its time, notes, meal and position", async () => {
    const c = await signUp(baseUrl);
    const trip = await newTrip(c);
    await addActivity(c, trip, { title: "Museum", startMin: at(10) });
    const lunch = (await addActivity(c, trip, { title: "Cafe A", kind: "food", meal: "lunch", startMin: at(12), notes: "Ask for a window seat" })).data;
    await addActivity(c, trip, { title: "Park", startMin: at(14) });
    const r = await c.send("PUT", `/api/trips/${trip.id}/activities/${lunch.activityId}/place`, { baseVersion: 1, title: "Cafe B", place: place("cafeb") });
    expect(r.status).toBe(200);
    expect(titles(r.data)).toEqual(["Museum", "Cafe B", "Park"]);
    expect(r.data.days[0].activities[1]).toMatchObject({ id: lunch.activityId, startMin: at(12), notes: "Ask for a window seat", meal: "lunch", version: 2, place: { source: "custom" } });
  });

  it("refuses a change based on an outdated stop, and isn't for the start", async () => {
    const c = await signUp(baseUrl);
    const trip = await newTrip(c);
    const a = (await addActivity(c, trip, { title: "Museum", startMin: at(10) })).data.activityId;
    await c.send("PATCH", `/api/trips/${trip.id}/activities/${a}`, { baseVersion: 1, notes: "changed by someone" });
    const stale = await c.send("PUT", `/api/trips/${trip.id}/activities/${a}/place`, { baseVersion: 1, place: place("x") });
    expect(stale.status).toBe(409);
    expect(stale.data.current.notes).toBe("changed by someone");
    const start = (await c.send("PUT", `/api/trips/${trip.id}/start`, { clientId: crypto.randomUUID(), title: "Hotel", place: place("hotel"), baseVersion: null })).data.activityId;
    expect((await c.send("PUT", `/api/trips/${trip.id}/activities/${start}/place`, { baseVersion: 1, place: place("y") })).status).toBe(400);
  });
});

describe("meals", () => {
  it("saves the meal of a food stop and refuses an unknown one", async () => {
    const c = await signUp(baseUrl);
    const trip = await newTrip(c);
    const r = await addActivity(c, trip, { title: "Bills", kind: "food", meal: "brunch", startMin: at(10, 30) });
    expect(r.data.trip.days[0].activities[0].meal).toBe("brunch");
    expect((await addActivity(c, trip, { title: "Odd", meal: "second_breakfast" })).status).toBe(400);
  });

  it("has usual meal times per trip, which only the owner changes", async () => {
    const owner = await signUp(baseUrl);
    const guest = await signUp(baseUrl);
    const trip = await newTrip(owner);
    expect(trip.mealTimes.lunch).toEqual({ from: at(11, 30), to: at(14), usual: at(12) });
    await share(owner, guest, trip.id);
    const late = { ...trip.mealTimes, dinner: { from: at(20), to: at(23), usual: at(21) } };
    expect((await guest.send("PATCH", `/api/trips/${trip.id}`, { mealTimes: late })).status).toBe(403);
    expect((await owner.send("PATCH", `/api/trips/${trip.id}`, { mealTimes: { ...late, lunch: { from: at(14), to: at(12), usual: at(13) } } })).status).toBe(400);
    const r = await owner.send("PATCH", `/api/trips/${trip.id}`, { mealTimes: late });
    expect(r.data.mealTimes.dinner).toEqual({ from: at(20), to: at(23), usual: at(21) });
  });
});

describe("where collaborators' maps are looking", () => {
  it("reaches the others live, never the sender, and never changes the itinerary or its revision", async () => {
    const a = await signUp(baseUrl);
    const b = await signUp(baseUrl);
    const trip = await newTrip(a);
    await share(a, b, trip.id);
    const [sa, sb] = [crypto.randomUUID(), crypto.randomUUID()];
    const aStream = watchEvents(baseUrl, a, trip.id, sa);
    const bStream = watchEvents(baseUrl, b, trip.id, sb);
    await Promise.all([aStream.ready, bStream.ready]);
    const rev = (await a.get(`/api/trips/${trip.id}`)).data.rev;
    const sent = await a.send("POST", `/api/trips/${trip.id}/view`, { session: sa, lat: -33.8568, lng: 151.2153, zoom: 15.2, heading: 0 });
    expect(sent.status).toBe(200);
    const seen = await bStream.next((e) => e.event === "view");
    expect(seen.data).toMatchObject({ session: sa, userId: a.userId, lat: -33.8568, lng: 151.2153, zoom: 15.2 });
    expect(Object.keys(seen.data).sort()).toEqual(["at", "displayName", "heading", "lat", "lng", "session", "userId", "zoom"]);
    await new Promise((r) => setTimeout(r, 200));
    expect(aStream.events.some((e) => e.event === "view")).toBe(false);
    expect(bStream.events.some((e) => e.event === "snapshot" && e.data.rev !== rev)).toBe(false);
    expect((await a.get(`/api/trips/${trip.id}`)).data.rev).toBe(rev);
    // someone joining later gets the current view at once
    const late = watchEvents(baseUrl, b, trip.id, crypto.randomUUID());
    await late.ready;
    expect((await late.next((e) => e.event === "view")).data.session).toBe(sa);
    // closing the tab removes it for everyone
    aStream.close();
    expect((await bStream.next((e) => e.event === "view-gone")).data.session).toBe(sa);
    bStream.close();
    late.close();
  });

  it("is refused to outsiders and checked for shape", async () => {
    const a = await signUp(baseUrl);
    const outsider = await signUp(baseUrl);
    const trip = await newTrip(a);
    expect((await outsider.send("POST", `/api/trips/${trip.id}/view`, { session: crypto.randomUUID(), lat: 1, lng: 1, zoom: 10 })).status).toBe(404);
    for (const bad of [{ session: "x", lat: 1, lng: 1, zoom: 1 }, { session: crypto.randomUUID(), lat: 100, lng: 1, zoom: 1 }, { session: crypto.randomUUID(), lat: 1, lng: 1, zoom: 99 }]) {
      expect((await a.send("POST", `/api/trips/${trip.id}/view`, bad)).status, JSON.stringify(bad)).toBe(400);
    }
    // a tab without an open stream has nobody to tell
    expect((await a.send("POST", `/api/trips/${trip.id}/view`, { session: crypto.randomUUID(), lat: 1, lng: 1, zoom: 10 })).status).toBe(409);
  });
});

describe("trip cover photos in My Trips", () => {
  it("uses the curated itinerary a trip came from, else the nearest curated city, else none", async () => {
    const c = await signUp(baseUrl);
    const copied = (await c.send("POST", "/api/itineraries/tpl-sydney-harbour-highlights/copy", { startDate: "2026-12-01" })).data;
    const sydney = await newTrip(c, { destination: "Sydney" }); // without a key, the demo fixtures place Sydney
    const far = await newTrip(c, { destination: "Reykjavik", timezone: "Atlantic/Reykjavik" });
    const tokyo = await newTrip(c, { destination: "Somewhere in Japan", timezone: "Asia/Tokyo" });
    await addActivity(c, tokyo, { title: "Asakusa", startMin: at(9), place: { placeId: `custom:${crypto.randomUUID()}`, source: "custom", lat: 35.7148, lng: 139.7967 } });
    const list = (await c.get("/api/trips")).data.owned;
    const cover = (id: string) => list.find((t: any) => t.id === id).cover;
    expect(cover(copied.id)).toBe("tpl-sydney-harbour-highlights");
    expect(cover(sydney.id)).toBe("dest-sydney");
    expect(cover(tokyo.id)).toBe("dest-tokyo");
    expect(cover(far.id)).toBe(null);
  });
});
