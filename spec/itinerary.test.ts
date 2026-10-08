import { describe, expect, inject, it } from "vitest";
import { addActivity, newTrip, share, signUp } from "./helpers.ts";

// Itinerary integrity: the server is the authority, a retried add doesn't
// duplicate, concurrent edits are detected rather than overwritten, and bad
// input writes nothing.
const baseUrl = inject("baseUrl");
const titles = (trip: any, day = 0) => trip.days[day].activities.map((a: any) => a.title);

describe("the itinerary", () => {
  it("creates one day per date of the trip", async () => {
    const c = await signUp(baseUrl);
    const trip = await newTrip(c, { startDate: "2026-12-30", endDate: "2027-01-02" });
    expect(trip.days.map((d: any) => d.date)).toEqual(["2026-12-30", "2026-12-31", "2027-01-01", "2027-01-02"]);
  });

  it("adds an activity once, however often the same request is retried", async () => {
    const c = await signUp(baseUrl);
    const trip = await newTrip(c);
    const body = { clientId: "retry-me-123", title: "Taronga Zoo" };
    const results = await Promise.all([addActivity(c, trip, body), addActivity(c, trip, body), addActivity(c, trip, body)]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 200, 201]);
    expect(new Set(results.map((r) => r.data.activityId)).size).toBe(1);
    const now = (await c.get(`/api/trips/${trip.id}`)).data;
    expect(titles(now)).toEqual(["Taronga Zoo"]);
  });

  it("reorders, moves between days and removes, keeping positions tidy", async () => {
    const c = await signUp(baseUrl);
    const trip = await newTrip(c);
    const ids: string[] = [];
    for (const t of ["A", "B", "C"]) ids.push((await addActivity(c, trip, { title: t })).data.activityId);

    let r = await c.send("POST", `/api/trips/${trip.id}/activities/${ids[2]}/move`, { dayId: trip.days[0].id, index: 0 });
    expect(titles(r.data)).toEqual(["C", "A", "B"]);
    r = await c.send("POST", `/api/trips/${trip.id}/activities/${ids[2]}/move`, { dayId: trip.days[0].id, index: 1 });
    expect(titles(r.data)).toEqual(["A", "C", "B"]);
    r = await c.send("POST", `/api/trips/${trip.id}/activities/${ids[0]}/move`, { dayId: trip.days[1].id, index: 0 });
    expect(titles(r.data, 0)).toEqual(["C", "B"]);
    expect(titles(r.data, 1)).toEqual(["A"]);
    r = await c.send("DELETE", `/api/trips/${trip.id}/activities/${ids[2]}`);
    expect(titles(r.data)).toEqual(["B"]);
    expect(r.data.days[0].activities[0].position).toBe(0);
  });

  it("refuses an edit based on an old version, and says what changed", async () => {
    const owner = await signUp(baseUrl);
    const guest = await signUp(baseUrl);
    const trip = await newTrip(owner);
    await share(owner, guest, trip.id);
    const id = (await addActivity(owner, trip, { title: "Lunch" })).data.activityId;

    const a = await owner.send("PATCH", `/api/trips/${trip.id}/activities/${id}`, { baseVersion: 1, startMin: 12 * 60 + 30 });
    expect(a.status).toBe(200);
    const b = await guest.send("PATCH", `/api/trips/${trip.id}/activities/${id}`, { baseVersion: 1, notes: "Window seat" });
    expect(b.status).toBe(409);
    expect(b.data.current).toMatchObject({ id, startMin: 750, version: 2, updatedBy: owner.userId });

    const retry = await guest.send("PATCH", `/api/trips/${trip.id}/activities/${id}`, { baseVersion: 2, notes: "Window seat" });
    expect(retry.status).toBe(200);
    expect(retry.data.days[0].activities[0]).toMatchObject({ startMin: 750, notes: "Window seat", version: 3 });
  });

  it("answers an edit to a removed activity with a 404, not a resurrection", async () => {
    const c = await signUp(baseUrl);
    const trip = await newTrip(c);
    const id = (await addActivity(c, trip)).data.activityId;
    await c.send("DELETE", `/api/trips/${trip.id}/activities/${id}`);
    expect((await c.send("PATCH", `/api/trips/${trip.id}/activities/${id}`, { baseVersion: 1, title: "Back" })).status).toBe(404);
    expect(titles((await c.get(`/api/trips/${trip.id}`)).data)).toEqual([]);
  });

  it("rejects bad input with a 400 and writes nothing", async () => {
    const c = await signUp(baseUrl);
    const trip = await newTrip(c);
    for (const bad of [{ title: "" }, { startMin: 1440 }, { startMin: 9.5 }, { durationMin: 0 }, { kind: "flight" }, { place: { placeId: "demo:x", source: "google", lat: 0, lng: 0 } }, { place: { placeId: "abc", lat: 200, lng: 0 } }]) {
      expect((await addActivity(c, trip, bad)).status, JSON.stringify(bad)).toBe(400);
    }
    for (const bad of [{ endDate: "2026-11-01" }, { startDate: "2026-02-30" }, { timezone: "Mars/Olympus" }, { startDate: "2026-01-01", endDate: "2026-03-01" }]) {
      expect((await c.send("POST", "/api/trips", { title: "x", destination: "y", startDate: "2026-12-01", endDate: "2026-12-03", timezone: "UTC", ...bad })).status, JSON.stringify(bad)).toBe(400);
    }
    expect(titles((await c.get(`/api/trips/${trip.id}`)).data)).toEqual([]);
    expect((await c.get("/api/trips")).data.owned).toHaveLength(1);
  });

  it("won't drop a day that still has plans when the dates shrink", async () => {
    const c = await signUp(baseUrl);
    const trip = await newTrip(c);
    await addActivity(c, trip, { dayId: trip.days[2].id });
    const r = await c.send("PATCH", `/api/trips/${trip.id}`, { endDate: "2026-12-02" });
    expect(r.status).toBe(409);
    expect((await c.get(`/api/trips/${trip.id}`)).data.days).toHaveLength(3);
    const longer = await c.send("PATCH", `/api/trips/${trip.id}`, { endDate: "2026-12-05" });
    expect(longer.data.days).toHaveLength(5);
  });

  it("reports schedule conflicts from plain arithmetic, and applies a fix only on request", async () => {
    const c = await signUp(baseUrl);
    const trip = await newTrip(c);
    await addActivity(c, trip, { title: "Zoo", startMin: 9 * 60, durationMin: 180 });
    const lunch = (await addActivity(c, trip, { title: "Lunch", startMin: 11 * 60 + 45, durationMin: 60 })).data;
    const day = lunch.trip.days[0];
    expect(day.analysis.issues).toEqual([expect.objectContaining({ kind: "overlap", minutes: 15 })]);
    const delay = day.analysis.proposals.find((p: any) => p.kind === "delay_next");
    expect(delay.changes).toEqual([{ type: "activity", activityId: lunch.activityId, field: "startMin", from: 705, to: 720 }]);
    // proposing changed nothing
    expect(day.activities[1].startMin).toBe(705);

    const applied = await c.send("POST", `/api/trips/${trip.id}/proposals/apply`, { dayId: day.id, proposalId: delay.id });
    expect(applied.status).toBe(200);
    expect(applied.data.days[0].activities[1].startMin).toBe(720);
    expect(applied.data.days[0].analysis.issues).toEqual([]);
    // the same proposal can't be applied twice
    expect((await c.send("POST", `/api/trips/${trip.id}/proposals/apply`, { dayId: day.id, proposalId: delay.id })).status).toBe(409);
  });
});
