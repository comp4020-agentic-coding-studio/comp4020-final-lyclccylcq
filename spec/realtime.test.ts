import { describe, expect, inject, it } from "vitest";
import { addActivity, newTrip, share, signUp, watchEvents } from "./helpers.ts";

// "A change one person makes appears in every other open session within
// about a second": checked over the same event stream the editor uses.
const baseUrl = inject("baseUrl");

describe("live updates", () => {
  it("delivers one person's change to a collaborator's open stream within a second", async () => {
    const owner = await signUp(baseUrl);
    const guest = await signUp(baseUrl);
    const trip = await newTrip(owner);
    await share(owner, guest, trip.id);
    const stream = watchEvents(baseUrl, guest, trip.id);
    expect(await stream.ready).toBe(200);
    await stream.next((e) => e.event === "snapshot");

    const sent = Date.now();
    const { data } = await addActivity(owner, trip, { title: "Opera House" });
    const got = await stream.next((e) => e.event === "snapshot" && e.data.days[0].activities.some((a: any) => a.title === "Opera House"));
    expect(got.at - sent).toBeLessThan(1000);

    await owner.send("PATCH", `/api/trips/${trip.id}/activities/${data.activityId}`, { baseVersion: 1, notes: "Tour at 2" });
    await stream.next((e) => e.event === "snapshot" && e.data.days[0].activities[0]?.notes === "Tour at 2");
    stream.close();
  });

  it("only broadcasts committed state, with a revision that only goes up", async () => {
    const owner = await signUp(baseUrl);
    const trip = await newTrip(owner);
    const stream = watchEvents(baseUrl, owner, trip.id);
    await stream.ready;
    await addActivity(owner, trip, { title: "One" });
    await addActivity(owner, trip, { title: "" }); // rejected: no event
    await addActivity(owner, trip, { title: "Two" });
    await stream.next((e) => e.event === "snapshot" && e.data.days[0].activities.length === 2);
    const revs = stream.events.filter((e) => e.event === "snapshot").map((e) => e.data.rev);
    expect(revs).toEqual([...revs].sort((a, b) => a - b));
    expect(new Set(revs).size).toBe(revs.length);
    expect(revs.length).toBe(3); // initial + two accepted changes
    stream.close();
  });

  it("tells collaborators who else has the trip open", async () => {
    const owner = await signUp(baseUrl);
    const guest = await signUp(baseUrl);
    const trip = await newTrip(owner);
    await share(owner, guest, trip.id);
    const a = watchEvents(baseUrl, owner, trip.id);
    await a.ready;
    const b = watchEvents(baseUrl, guest, trip.id);
    await b.ready;
    await a.next((e) => e.event === "presence" && e.data.length === 2);
    b.close();
    await a.next((e) => e.event === "presence" && e.data.length === 1 && e.data[0].id === owner.userId);
    a.close();
  });

  it("closes the stream of someone removed from the trip", async () => {
    const owner = await signUp(baseUrl);
    const guest = await signUp(baseUrl);
    const trip = await newTrip(owner);
    await share(owner, guest, trip.id);
    const stream = watchEvents(baseUrl, guest, trip.id);
    await stream.ready;
    await owner.send("DELETE", `/api/trips/${trip.id}/members/${guest.userId}`);
    const e = await stream.next((x) => x.event === "revoked");
    expect(e.data.reason).toBe("removed");
    await addActivity(owner, trip, { title: "Secret plan" });
    await new Promise((r) => setTimeout(r, 200));
    expect(JSON.stringify(stream.events)).not.toContain("Secret plan");
    stream.close();
  });
});
