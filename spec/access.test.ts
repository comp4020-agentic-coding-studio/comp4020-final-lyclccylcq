import { describe, expect, inject, it } from "vitest";
import { addActivity, anon, newTrip, share, signUp } from "./helpers.ts";

// "Only authorised users may edit a private trip": owner, collaborator and
// outsider are told apart on the server, for every kind of request.
const baseUrl = inject("baseUrl");

describe("who can see and change a trip", () => {
  it("refuses everything to someone who isn't signed in", async () => {
    const owner = await signUp(baseUrl);
    const trip = await newTrip(owner);
    const nobody = anon(baseUrl);
    expect((await nobody.get("/api/trips")).status).toBe(401);
    expect((await nobody.get(`/api/trips/${trip.id}`)).status).toBe(401);
    expect((await nobody.get(`/api/trips/${trip.id}/events`)).status).toBe(401);
    // discovery is public; searching within a private trip is not
    expect((await nobody.get(`/api/places/search?q=zoo&tripId=${trip.id}`)).status).toBe(401);
  });

  it("shows an outsider nothing, not even that the trip exists", async () => {
    const owner = await signUp(baseUrl);
    const outsider = await signUp(baseUrl);
    const trip = await newTrip(owner);
    const { data } = await addActivity(owner, trip);
    const act = data.activityId;

    const missing = await outsider.get(`/api/trips/00000000-0000-4000-8000-000000000000`);
    const real = await outsider.get(`/api/trips/${trip.id}`);
    expect(real.status).toBe(404);
    expect(real.data).toEqual(missing.data);

    expect((await outsider.get(`/api/trips/${trip.id}/events`)).status).toBe(404);
    expect((await addActivity(outsider, trip)).status).toBe(404);
    expect((await outsider.send("PATCH", `/api/trips/${trip.id}/activities/${act}`, { baseVersion: 1, title: "x" })).status).toBe(404);
    expect((await outsider.send("DELETE", `/api/trips/${trip.id}/activities/${act}`)).status).toBe(404);
    expect((await outsider.send("POST", `/api/trips/${trip.id}/invite`, {})).status).toBe(404);
    expect((await outsider.get("/api/trips")).data).toEqual({ owned: [], shared: [] });

    const after = await owner.get(`/api/trips/${trip.id}`);
    expect(after.data.days[0].activities.map((a: any) => a.title)).toEqual(["Somewhere"]);
  });

  it("lets an invited collaborator edit the itinerary but not run the trip", async () => {
    const owner = await signUp(baseUrl);
    const guest = await signUp(baseUrl);
    const trip = await newTrip(owner);
    await share(owner, guest, trip.id);

    expect((await addActivity(guest, trip, { title: "Guest's pick" })).status).toBe(201);
    expect((await guest.get("/api/trips")).data.shared.map((t: any) => t.id)).toEqual([trip.id]);
    expect((await guest.send("POST", `/api/trips/${trip.id}/invite`, {})).status).toBe(403);
    expect((await guest.send("PATCH", `/api/trips/${trip.id}`, { title: "Mine now" })).status).toBe(403);
    expect((await guest.send("DELETE", `/api/trips/${trip.id}`)).status).toBe(403);
    expect((await guest.send("DELETE", `/api/trips/${trip.id}/members/${owner.userId}`)).status).toBe(403);
  });

  it("uses unguessable invite links that stop working when replaced or turned off", async () => {
    const owner = await signUp(baseUrl);
    const a = await signUp(baseUrl);
    const b = await signUp(baseUrl);
    const trip = await newTrip(owner);

    const first = (await owner.send("POST", `/api/trips/${trip.id}/invite`, {})).data.token as string;
    expect(first.length).toBeGreaterThanOrEqual(40);
    expect(first).not.toContain(trip.id);
    const second = (await owner.send("POST", `/api/trips/${trip.id}/invite`, {})).data.token as string;
    expect(second).not.toBe(first);

    expect((await a.send("POST", `/api/invites/${first}/accept`, {})).status).toBe(404);
    expect((await a.send("POST", `/api/invites/${second}/accept`, {})).status).toBe(200);

    await owner.send("DELETE", `/api/trips/${trip.id}/invite`);
    expect((await b.send("POST", `/api/invites/${second}/accept`, {})).status).toBe(404);
    expect((await b.get(`/api/trips/${trip.id}`)).status).toBe(404);
    // the trip never reveals its link to anyone, owner included
    expect(JSON.stringify((await owner.get(`/api/trips/${trip.id}`)).data)).not.toContain(second);
  });

  it("cuts off a removed collaborator at once", async () => {
    const owner = await signUp(baseUrl);
    const guest = await signUp(baseUrl);
    const trip = await newTrip(owner);
    await share(owner, guest, trip.id);
    expect((await owner.send("DELETE", `/api/trips/${trip.id}/members/${guest.userId}`)).status).toBe(200);
    expect((await guest.get(`/api/trips/${trip.id}`)).status).toBe(404);
    expect((await addActivity(guest, trip)).status).toBe(404);
  });

  it("refuses writes that a cross-site page could forge", async () => {
    const owner = await signUp(baseUrl);
    const formPost = await fetch(new URL("/api/trips", baseUrl), {
      method: "POST",
      headers: { cookie: owner.cookie, "content-type": "application/x-www-form-urlencoded" },
      body: "title=x",
    });
    expect(formPost.status).toBe(415);
    const foreign = await fetch(new URL("/api/trips", baseUrl), {
      method: "POST",
      headers: { cookie: owner.cookie, "content-type": "application/json", origin: "https://evil.example" },
      body: JSON.stringify({ title: "x", destination: "y", startDate: "2026-12-01", endDate: "2026-12-01", timezone: "UTC" }),
    });
    expect(foreign.status).toBe(403);
    expect((await owner.get("/api/trips")).data.owned).toEqual([]);

    const trip = await newTrip(owner);
    const bodyless = await fetch(new URL(`/api/trips/${trip.id}`, baseUrl), { method: "DELETE", headers: { cookie: owner.cookie, origin: "https://evil.example" } });
    expect(bodyless.status).toBe(403);
    expect((await owner.get(`/api/trips/${trip.id}`)).status).toBe(200);
  });

  it("keeps sessions server-side: a signed-out cookie stops working", async () => {
    const owner = await signUp(baseUrl);
    expect((await owner.get("/api/auth/me")).status).toBe(200);
    await owner.send("POST", "/api/auth/logout", {});
    expect((await owner.get("/api/auth/me")).status).toBe(401);
  });
});
