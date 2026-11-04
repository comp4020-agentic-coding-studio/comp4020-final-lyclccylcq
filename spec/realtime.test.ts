import { describe, expect, inject, it } from "vitest";
import { addActivity, logIn, newTrip, share, signUp, uniqueName, watchEvents } from "./helpers.ts";

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

  it("ends every stream of a signed-out session at once, and only that session's", async () => {
    const name = uniqueName("so");
    const owner = await signUp(baseUrl, name);
    const other = await logIn(baseUrl, name); // the same person in another browser: a separate session
    const guest = await signUp(baseUrl);
    const trip = await newTrip(owner);
    await share(owner, guest, trip.id);
    // two tabs of one session on the trip, plus that session's own stream
    const tabA = watchEvents(baseUrl, owner, trip.id, "tab-aaaaaaaa");
    const tabB = watchEvents(baseUrl, owner, trip.id, "tab-bbbbbbbb");
    const mine = watchEvents(baseUrl, owner, null);
    const elsewhere = watchEvents(baseUrl, other, trip.id, "tab-cccccccc");
    for (const s of [tabA, tabB, mine, elsewhere]) expect(await s.ready).toBe(200);
    await tabB.next((e) => e.event === "snapshot");

    // tab A signs out: the session's streams are told and closed
    expect((await owner.send("POST", "/api/auth/logout", {})).status).toBe(200);
    await Promise.all([tabA.ended, tabB.ended, mine.ended]);
    expect(tabB.events.some((e) => e.event === "signed-out")).toBe(true);
    expect(mine.events.some((e) => e.event === "signed-out")).toBe(true);
    const seen = tabB.events.length;

    // a collaborator's later note reaches the other session, never the signed-out one
    const { data } = await addActivity(guest, trip, { title: "Private note stop" });
    await guest.send("PATCH", `/api/trips/${trip.id}/activities/${data.activityId}`, { baseVersion: 1, notes: "door code 4411" });
    await elsewhere.next((e) => e.event === "snapshot" && e.data.days[0].activities.some((a: any) => a.notes === "door code 4411"));
    expect(tabB.events.length).toBe(seen);
    expect(JSON.stringify(tabB.events)).not.toContain("door code 4411");

    // the old session gets 401 everywhere, a new stream included
    expect((await owner.get(`/api/trips/${trip.id}`)).status).toBe(401);
    const again = watchEvents(baseUrl, owner, trip.id, "tab-dddddddd");
    await expect(again.ready).rejects.toThrow(/401/);
    // the other session is still signed in and still live
    expect((await other.get(`/api/trips/${trip.id}`)).status).toBe(200);
    // and the guest saw the owner's signed-out tabs leave, but the other one stay
    const presence = (await watchEvents(baseUrl, guest, trip.id).next((e) => e.event === "presence")).data;
    expect(presence.map((p: any) => p.id)).toContain(owner.userId);
    for (const s of [tabA, tabB, mine, elsewhere, again]) s.close();
  });
});
