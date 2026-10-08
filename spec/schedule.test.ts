import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { openDb } from "../src/db.ts";
import { analyseDay, type DaySegment, defaultMode, type RouteOption, zonedTimeToUtc } from "../src/schedule.ts";
import { createTripStore } from "../src/trips.ts";

// The deterministic half of the copilot: time arithmetic, conflicts and
// candidate fixes, and how transport segments follow the plan. Driven
// directly, with a clock the test controls.
const act = (id: string, startMin: number | null, durationMin: number, placeId: string | null = `p-${id}`) => ({ id, title: id, startMin, durationMin, placeId });
const route = (mode: RouteOption["mode"], minutes: number): RouteOption => ({ mode, status: "ok", durationSec: minutes * 60, distanceM: 1000 });
const seg = (options: RouteOption[], selectedMode: RouteOption["mode"] | null, stale = false): DaySegment => ({ id: "s1", fromId: "Zoo", toId: "Lunch", options, selectedMode, stale });

describe("schedule analysis", () => {
  it("flags travel that doesn't fit the gap, with the exact shortfall", () => {
    const { issues, gaps } = analyseDay([act("Zoo", 540, 180), act("Lunch", 735, 60)], [seg([route("TRANSIT", 35), route("WALK", 80)], "TRANSIT")]);
    expect(gaps[0]).toMatchObject({ availableMin: 15, travelMin: 35, status: "ok", mode: "TRANSIT" });
    expect(issues).toEqual([expect.objectContaining({ kind: "travel_tight", minutes: 20, severity: "conflict" })]);
    expect(issues[0].message).toContain("20 min short");
  });

  it("offers fixes that each exactly close the gap", () => {
    const { proposals } = analyseDay(
      [act("Zoo", 540, 180), act("Lunch", 735, 60), act("Ferry", 840, 60)],
      [seg([route("TRANSIT", 35), route("DRIVE", 12)], "TRANSIT")],
    );
    const by = Object.fromEntries(proposals.map((p) => [p.kind, p]));
    expect(by.delay_next.changes).toEqual([{ type: "activity", activityId: "Lunch", field: "startMin", from: 735, to: 755 }]);
    expect(by.push_rest.changes.map((c: any) => [c.activityId, c.to])).toEqual([["Lunch", 755], ["Ferry", 860]]);
    expect(by.shorten_prev.changes).toEqual([{ type: "activity", activityId: "Zoo", field: "durationMin", from: 180, to: 160 }]);
    expect(by.switch_mode.changes).toEqual([{ type: "mode", segmentId: "s1", from: "TRANSIT", to: "DRIVE" }]);
  });

  it("doesn't suggest a mode that wouldn't fit, or one with no route", () => {
    const { proposals } = analyseDay(
      [act("Zoo", 540, 180), act("Lunch", 735, 60)],
      [seg([route("TRANSIT", 35), route("WALK", 80), { mode: "DRIVE", status: "error", message: "nope" }], "TRANSIT")],
    );
    expect(proposals.filter((p) => p.kind === "switch_mode")).toEqual([]);
  });

  it("finds overlaps and leaves untimed or unrouted gaps unjudged", () => {
    const { issues, gaps } = analyseDay([act("A", 600, 90), act("B", 660, 30), act("C", null, 30), act("D", 900, 30, null)], []);
    expect(issues.map((i) => [i.kind, i.minutes])).toEqual([["overlap", 30]]);
    expect(gaps.map((g) => g.status)).toEqual(["not_calculated", "not_calculated", "no_places"]);
    expect(gaps[1].availableMin).toBeNull();
  });

  it("warns about a stop that runs past midnight", () => {
    expect(analyseDay([act("Late", 23 * 60, 120)], []).issues[0]).toMatchObject({ kind: "past_midnight", minutes: 60 });
  });

  it("defaults to the quickest of walking and transit, driving only as a last resort", () => {
    expect(defaultMode([route("WALK", 20), route("TRANSIT", 15), route("DRIVE", 5)])).toBe("TRANSIT");
    expect(defaultMode([route("WALK", 9), route("TRANSIT", 15)])).toBe("WALK");
    expect(defaultMode([{ mode: "WALK", status: "none" }, route("DRIVE", 30)])).toBe("DRIVE");
    expect(defaultMode([{ mode: "WALK", status: "none" }])).toBeNull();
  });

  it("converts local trip times to UTC across a daylight-saving change", () => {
    // Sydney: AEST (+10) until 5 Oct 2026, AEDT (+11) after
    expect(zonedTimeToUtc("2026-07-01", 9 * 60, "Australia/Sydney").toISOString()).toBe("2026-06-30T23:00:00.000Z");
    expect(zonedTimeToUtc("2026-12-01", 9 * 60, "Australia/Sydney").toISOString()).toBe("2026-11-30T22:00:00.000Z");
    expect(zonedTimeToUtc("2026-12-01", 12 * 60, "Asia/Tokyo").toISOString()).toBe("2026-12-01T03:00:00.000Z");
  });
});

describe("transport segments follow the plan", () => {
  function setup() {
    let t = Date.UTC(2026, 9, 9);
    const db = openDb(mkdtempSync(join(tmpdir(), "wayline-unit-")));
    const store = createTripStore(db, () => t);
    db.prepare("insert into users (id, username, display_name, password_hash, created_at) values ('u1', 'u1', 'U', 'x', 0)").run();
    const trip = store.create("u1", { title: "T", destination: "Sydney", startDate: "2026-10-20", endDate: "2026-10-20", timezone: "Australia/Sydney" });
    const place = (id: string) => ({ placeId: `ChIJ${id}xxxxxxxxxx`, source: "google", lat: -33.8, lng: 151.2 });
    const add = (title: string, startMin: number) =>
      store.addActivity("u1", trip.id, { clientId: `c-${title}-1234`, dayId: trip.days[0].id, title, startMin, durationMin: 60, place: place(title) }).activityId;
    return { store, trip, add, wait: (ms: number) => (t += ms) };
  }
  const opts = [route("WALK", 20), route("TRANSIT", 12)];

  it("stores a calculated route between neighbours and selects a default mode", () => {
    const { store, trip, add } = setup();
    const a = add("A", 540);
    const b = add("B", 660);
    const info = store.routeRequest("u1", trip.id, a, b);
    const snap = store.saveRoute("u1", trip.id, a, b, info.departKey, opts, null);
    expect(snap.days[0].segments).toEqual([expect.objectContaining({ fromId: a, toId: b, selectedMode: "TRANSIT", stale: false })]);
  });

  it("marks the route stale when the departure time changes, without recalculating", () => {
    const { store, trip, add } = setup();
    const a = add("A", 540);
    const b = add("B", 660);
    store.saveRoute("u1", trip.id, a, b, store.routeRequest("u1", trip.id, a, b).departKey, opts, null);
    const snap = store.updateActivity("u1", trip.id, a, { baseVersion: 1, durationMin: 90 });
    expect(snap.days[0].segments[0].stale).toBe(true);
    expect(snap.days[0].analysis.gaps[0].status).toBe("stale");
  });

  it("drops a route as soon as its two stops stop being neighbours", () => {
    const { store, trip, add } = setup();
    const a = add("A", 540);
    const b = add("B", 660);
    store.saveRoute("u1", trip.id, a, b, store.routeRequest("u1", trip.id, a, b).departKey, opts, null);
    add("C", 800);
    const snap = store.moveActivity("u1", trip.id, b, { index: 2 });
    expect(snap.days[0].segments).toEqual([]);
    expect(() => store.routeRequest("u1", trip.id, a, b)).toThrow(/next to each other/);
  });

  it("forgets route data and coordinates after 30 days, but keeps the place id", () => {
    const { store, trip, add, wait } = setup();
    const a = add("A", 540);
    const b = add("B", 660);
    store.saveRoute("u1", trip.id, a, b, store.routeRequest("u1", trip.id, a, b).departKey, opts, null);
    wait(31 * 86_400_000);
    const snap = store.snapshot(trip.id);
    expect(snap.days[0].segments).toEqual([]);
    expect(snap.days[0].activities[0].place).toMatchObject({ placeId: "ChIJAxxxxxxxxxx", lat: null, lng: null });
    expect(store.stalePlaces(trip.id)).toHaveLength(2);
  });

  it("only selects a mode that has a route", () => {
    const { store, trip, add } = setup();
    const a = add("A", 540);
    const b = add("B", 660);
    const snap = store.saveRoute("u1", trip.id, a, b, store.routeRequest("u1", trip.id, a, b).departKey, [route("WALK", 20), { mode: "TRANSIT", status: "none" }], null);
    expect(() => store.selectMode("u1", trip.id, snap.days[0].segments[0].id, "TRANSIT")).toThrow(/no route/);
  });
});
