import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, inject, it } from "vitest";
import { openDb } from "../src/db.ts";
import { createTripStore, INVITE_TTL_MS } from "../src/trips.ts";
import { addActivity, anon, type Client, newTrip, requestAndApprove, share, signUp, watchEvents } from "./helpers.ts";

// Invite links that expire and need the owner's approval, the owner /
// collaborator / outsider rules, and publishing, forking and reviewing
// (docs/permissions.md). Checked over HTTP against the running app, except
// the 24-hour expiry, which runs the trip store on a clock the test controls.
const baseUrl = inject("baseUrl");

const link = async (owner: Client, tripId: string) => (await owner.send("POST", `/api/trips/${tripId}/invite`, {})).data;
const ask = (c: Client, token: string) => c.send("POST", `/api/invites/${token}/request`, {});
const trip404 = async (c: Client, tripId: string) => expect((await c.get(`/api/trips/${tripId}`)).status).toBe(404);

describe("invite links: 24 hours, and the owner approves each person", () => {
  it("works before it expires and is refused after 24 hours (server clock)", () => {
    let clock = Date.parse("2026-11-01T00:00:00Z");
    const db = openDb(mkdtempSync(join(tmpdir(), "wayline-expiry-")));
    const store = createTripStore(db, () => clock);
    const ins = db.prepare("insert into users (id, username, display_name, display_name_key, password_hash, created_at) values (?, ?, ?, ?, 'x', 0)");
    ins.run("owner", "owner", "Owner", "owner");
    ins.run("b", "bee", "Bee", "bee");
    ins.run("c", "cee", "Cee", "cee");
    const trip = store.create("owner", { title: "T", destination: "Sydney", startDate: "2026-12-01", endDate: "2026-12-01", timezone: "Australia/Sydney" });
    const { token, link } = store.createInvite("owner", trip.id);
    expect(link.expiresAt - link.createdAt).toBe(INVITE_TTL_MS);
    expect(store.inviteLink("owner", trip.id)?.expired).toBe(false);

    clock += INVITE_TTL_MS - 1000; // one second before expiry
    expect(store.previewInvite("b", token).state).toBe("can_request");
    const req = store.requestToJoin("b", token);
    expect(req.status).toBe("pending");

    clock += 2000; // one second after
    expect(store.previewInvite("c", token).state).toBe("expired");
    expect(() => store.requestToJoin("c", token)).toThrow(/expired/);
    expect(store.inviteLink("owner", trip.id)?.expired).toBe(true);
    expect(store.snapshot(trip.id).hasInvite).toBe(false);
    // a request made in time can still be decided after the link expires
    store.decideJoinRequest("owner", trip.id, req.requestId, "approve");
    expect(store.roleOf(trip.id, "b")).toBe("collaborator");

    // a new link is a new 24 hours; it never extends the old one
    const again = store.createInvite("owner", trip.id);
    expect(again.link.expiresAt).toBe(clock + INVITE_TTL_MS);
    expect(() => store.previewInvite("c", token)).toThrow(/isn't valid/); // the old one is revoked
    db.close();
  });

  it("switches off legacy never-expiring links on startup", () => {
    const dir = mkdtempSync(join(tmpdir(), "wayline-legacy-"));
    let db = openDb(dir);
    db.prepare("insert into users (id, username, display_name, display_name_key, password_hash, created_at) values ('u', 'u1', 'U', 'u', 'x', 0)").run();
    db.prepare("insert into trips (id, owner_id, title, destination, start_date, end_date, timezone, invite_hash, created_at, updated_at) values ('t', 'u', 'T', 'D', '2026-12-01', '2026-12-01', 'UTC', 'legacyhash', 0, 0)").run();
    db.close();
    db = openDb(dir);
    expect(db.prepare("select invite_hash from trips where id = 't'").get()?.invite_hash).toBeNull();
    db.close();
  });

  it("never lets anyone in by link alone: request, then the owner decides", async () => {
    const owner = await signUp(baseUrl);
    const b = await signUp(baseUrl);
    const c = await signUp(baseUrl);
    const trip = await newTrip(owner);
    await addActivity(owner, trip, { title: "Secret spot", notes: "door code 1234" });
    const { token, link: l } = await link(owner, trip.id);
    expect(l.expiresAt - l.createdAt).toBe(24 * 3600 * 1000);
    expect(JSON.stringify(l)).not.toContain(token);

    // the preview says whose trip, nothing more
    const preview = (await b.get(`/api/invites/${token}`)).data;
    expect(preview).toMatchObject({ state: "can_request", tripId: null, ownerName: expect.any(String) });
    expect(JSON.stringify(preview)).not.toMatch(/Secret spot|door code|startDate|members/);

    // asking grants nothing
    const r = await ask(b, token);
    expect(r.status).toBe(201);
    expect(r.data).toEqual({ requestId: expect.any(String), status: "pending" });
    await trip404(b, trip.id);
    expect((await addActivity(b, trip)).status).toBe(404);
    expect((await b.get(`/api/invites/${token}`)).data.state).toBe("pending");
    // asking again doesn't make a second request
    expect((await ask(b, token)).data.requestId).toBe(r.data.requestId);
    expect((await owner.get(`/api/trips/${trip.id}/requests`)).data.requests.filter((x: any) => x.status === "pending")).toHaveLength(1);

    // only the owner decides; a third person with the same link can't
    expect((await c.send("POST", `/api/trips/${trip.id}/requests/${r.data.requestId}/approve`, {})).status).toBe(404);
    expect((await b.send("POST", `/api/trips/${trip.id}/requests/${r.data.requestId}/approve`, {})).status).toBe(404);

    // a forwarded link: C must ask separately, and B's approval isn't C's
    const rc = await ask(c, token);
    expect(rc.data.requestId).not.toBe(r.data.requestId);
    expect((await owner.send("POST", `/api/trips/${trip.id}/requests/${r.data.requestId}/approve`, {})).status).toBe(200);
    expect((await b.get(`/api/trips/${trip.id}`)).status).toBe(200);
    expect((await b.get(`/api/trips/${trip.id}`)).data.members.find((m: any) => m.id === b.userId).role).toBe("collaborator");
    await trip404(c, trip.id);

    // rejected: no access, and the request can't be decided twice
    expect((await owner.send("POST", `/api/trips/${trip.id}/requests/${rc.data.requestId}/reject`, {})).status).toBe(200);
    expect((await owner.send("POST", `/api/trips/${trip.id}/requests/${rc.data.requestId}/approve`, {})).status).toBe(409);
    await trip404(c, trip.id);
    expect((await c.get(`/api/invites/${token}`)).data.state).toBe("rejected");
    // approved members can't ask again
    expect((await ask(b, token)).status).toBe(409);
    // a rejected person may ask again while the link is valid; it's a new pending request
    const again = await ask(c, token);
    expect(again.status).toBe(201);
    expect(again.data.requestId).not.toBe(rc.data.requestId);

    // collaborators can't see or decide requests, or make links
    expect((await b.get(`/api/trips/${trip.id}/requests`)).status).toBe(403);
    expect((await b.send("POST", `/api/trips/${trip.id}/requests/${again.data.requestId}/approve`, {})).status).toBe(403);
    expect((await b.send("POST", `/api/trips/${trip.id}/invite`, {})).status).toBe(403);
  });

  it("refuses revoked and made-up links, and anyone not signed in", async () => {
    const owner = await signUp(baseUrl);
    const b = await signUp(baseUrl);
    const trip = await newTrip(owner);
    const { token } = await link(owner, trip.id);
    expect((await anon(baseUrl).send("POST", `/api/invites/${token}/request`, {})).status).toBe(401);
    await owner.send("DELETE", `/api/trips/${trip.id}/invite`);
    expect((await ask(b, token)).status).toBe(404);
    expect((await ask(b, "x".repeat(43))).status).toBe(404);
  });
});

describe("owner and collaborator rights", () => {
  async function shared() {
    const owner = await signUp(baseUrl);
    const guest = await signUp(baseUrl);
    const outsider = await signUp(baseUrl);
    const trip = await newTrip(owner);
    await share(owner, guest, trip.id);
    const ownerStop = (await addActivity(owner, trip, { title: "Owner's stop" })).data.activityId;
    return { owner, guest, outsider, trip, ownerStop };
  }

  it("lets collaborators add, and change only what they added", async () => {
    const { owner, guest, trip, ownerStop } = await shared();
    const add = await addActivity(guest, trip, { title: "Guest's stop", startMin: 600 });
    expect(add.status).toBe(201);
    const mine = add.data.activityId;
    expect(add.data.trip.days[0].activities.find((a: any) => a.id === mine).createdBy).toBe(guest.userId);

    // their own stop: edit, move, re-place, remove
    expect((await guest.send("PATCH", `/api/trips/${trip.id}/activities/${mine}`, { baseVersion: 1, notes: "mine" })).status).toBe(200);
    expect((await guest.send("PUT", `/api/trips/${trip.id}/activities/${mine}/place`, { baseVersion: 2, place: { placeId: `custom:${crypto.randomUUID()}`, source: "custom", lat: -33.86, lng: 151.21 } })).status).toBe(200);

    // the owner's stop: refused with a 403 that says why, and nothing changes
    for (const [method, path, body] of [
      ["PATCH", `/activities/${ownerStop}`, { baseVersion: 1, title: "Mine now" }],
      ["DELETE", `/activities/${ownerStop}`, undefined],
      ["POST", `/activities/${ownerStop}/move`, { dayId: trip.days[1].id, index: 0 }],
      ["PUT", `/activities/${ownerStop}/place`, { baseVersion: 1, place: { placeId: `custom:${crypto.randomUUID()}`, source: "custom", lat: 0, lng: 0 } }],
      ["PUT", "/start", { clientId: crypto.randomUUID(), title: "Here", place: { placeId: `custom:${crypto.randomUUID()}`, source: "custom", lat: 0, lng: 0 }, baseVersion: null }],
      ["POST", "/proposals/apply", { dayId: trip.days[0].id, proposalId: "x" }],
    ] as const) {
      const res = await guest.send(method, `/api/trips/${trip.id}${path}`, body);
      expect(res.status, `${method} ${path}`).toBe(403);
      expect(res.data.error).toMatch(/owner/);
    }
    const after = (await owner.get(`/api/trips/${trip.id}`)).data;
    expect(after.days[0].activities.find((a: any) => a.id === ownerStop)).toMatchObject({ title: "Owner's stop", version: 1 });

    // the owner changes anyone's stops
    expect((await owner.send("DELETE", `/api/trips/${trip.id}/activities/${mine}`)).status).toBe(200);
  });

  it("lets only the owner delete the trip, on every route", async () => {
    const { owner, guest, outsider, trip } = await shared();
    expect((await guest.send("DELETE", `/api/trips/${trip.id}`)).status).toBe(403);
    expect((await outsider.send("DELETE", `/api/trips/${trip.id}`)).status).toBe(404);
    expect((await anon(baseUrl).send("DELETE", `/api/trips/${trip.id}`)).status).toBe(401);
    expect((await guest.get(`/api/trips/${trip.id}`)).status).toBe(200);
    expect((await owner.send("DELETE", `/api/trips/${trip.id}`)).status).toBe(200);
    expect((await owner.get(`/api/trips/${trip.id}`)).status).toBe(404);
  });

  it("gives outsiders nothing, streams included", async () => {
    const { outsider, trip, ownerStop } = await shared();
    await trip404(outsider, trip.id);
    expect((await outsider.send("PATCH", `/api/trips/${trip.id}/activities/${ownerStop}`, { baseVersion: 1, title: "x" })).status).toBe(404);
    expect((await addActivity(outsider, trip)).status).toBe(404);
    expect((await outsider.get(`/api/trips/${trip.id}/requests`)).status).toBe(404);
    expect((await outsider.send("PUT", `/api/trips/${trip.id}/publication`, { description: "x" })).status).toBe(404);
    const s = watchEvents(baseUrl, outsider, trip.id);
    await expect(s.ready).rejects.toThrow(/404/);
  });

  it("cuts off a removed collaborator at once, open stream included", async () => {
    const { owner, guest, trip } = await shared();
    const s = watchEvents(baseUrl, guest, trip.id);
    expect(await s.ready).toBe(200);
    await s.next((e) => e.event === "snapshot");
    expect((await owner.send("DELETE", `/api/trips/${trip.id}/members/${guest.userId}`)).status).toBe(200);
    const revoked = await s.next((e) => e.event === "revoked");
    expect(revoked.data.reason).toBe("removed");
    await trip404(guest, trip.id);
    expect((await addActivity(guest, trip)).status).toBe(404);
    s.close();
  });
});

describe("publishing, forking and reviews", () => {
  async function published(desc = "A lovely harbour day") {
    const author = await signUp(baseUrl);
    const trip = await newTrip(author, { title: "Harbour day" });
    await addActivity(author, trip, { title: "Opera House", startMin: 540, notes: "private note" });
    await addActivity(author, trip, { title: "Botanic Garden", startMin: 660 });
    const pub = await author.send("PUT", `/api/trips/${trip.id}/publication`, { description: desc });
    expect(pub.status).toBe(201);
    return { author, trip, pubId: pub.data.publication.id as string };
  }
  const titles = (t: any) => t.days.flatMap((d: any) => d.activities.map((a: any) => a.title));

  it("only owners publish, and never an empty trip", async () => {
    const owner = await signUp(baseUrl);
    const guest = await signUp(baseUrl);
    const trip = await newTrip(owner);
    await share(owner, guest, trip.id);
    expect((await owner.send("PUT", `/api/trips/${trip.id}/publication`, { description: "x" })).data.code).toBe("empty");
    await addActivity(guest, trip, { title: "Guest stop" });
    expect((await guest.send("PUT", `/api/trips/${trip.id}/publication`, { description: "x" })).status).toBe(403);
    expect((await guest.send("DELETE", `/api/trips/${trip.id}/publication`)).status).toBe(403);
    expect((await owner.send("PUT", `/api/trips/${trip.id}/publication`, { description: "" })).status).toBe(400);
    expect((await owner.send("PUT", `/api/trips/${trip.id}/publication`, { description: "Ok" })).status).toBe(201);
  });

  it("is public and read-only, without notes, members or links, and listed in discovery", async () => {
    const { author, trip, pubId } = await published();
    const outsider = await signUp(baseUrl);
    await link(author, trip.id);
    const pub = (await anon(baseUrl).get(`/api/itineraries/${pubId}`)).data;
    expect(pub).toMatchObject({ id: pubId, source: "user", title: "Harbour day", description: "A lovely harbour day", status: "published", rating: { average: null, count: 0 } });
    expect(pub.author.displayName).toEqual(expect.any(String));
    expect(pub.stops.map((s: any) => s.title)).toEqual(["Opera House", "Botanic Garden"]);
    expect(JSON.stringify(pub)).not.toMatch(/private note|members|invite|token/i);
    expect((await anon(baseUrl).get("/api/publications")).data.publications.map((p: any) => p.id)).toContain(pubId);
    // the curated list stays curated
    expect((await anon(baseUrl).get("/api/itineraries")).data.itineraries.every((t: any) => t.source === "curated")).toBe(true);
    // a published trip gives the public no way into the original
    await trip404(outsider, trip.id);
    expect((await outsider.send("DELETE", `/api/trips/${trip.id}`)).status).toBe(404);
    expect((await outsider.send("PUT", `/api/trips/${trip.id}/publication`, { description: "hijack" })).status).toBe(404);
  });

  it("keeps the published snapshot until the owner republishes on purpose", async () => {
    const { author, trip, pubId } = await published();
    await addActivity(author, trip, { title: "Ferry", startMin: 900 });
    expect((await anon(baseUrl).get(`/api/itineraries/${pubId}`)).data.stops.map((s: any) => s.title)).not.toContain("Ferry");
    expect((await author.get(`/api/trips/${trip.id}`)).data.publication).toMatchObject({ id: pubId, outdated: true });
    const again = await author.send("PUT", `/api/trips/${trip.id}/publication`, { description: "Now with a ferry" });
    expect(again.status).toBe(200);
    expect(again.data.publication.id).toBe(pubId); // same identity
    expect((await anon(baseUrl).get(`/api/itineraries/${pubId}`)).data.stops.map((s: any) => s.title)).toContain("Ferry");
  });

  it("forks into an independent private trip owned by the forker", async () => {
    const { author, trip, pubId } = await published();
    const b = await signUp(baseUrl);
    const c = await signUp(baseUrl);
    expect((await anon(baseUrl).send("POST", `/api/itineraries/${pubId}/copy`, { startDate: "2027-01-10" })).status).toBe(401);
    const fb = await b.send("POST", `/api/itineraries/${pubId}/copy`, { startDate: "2027-01-10" });
    const fc = await c.send("POST", `/api/itineraries/${pubId}/copy`, { startDate: "2027-02-01" });
    expect(fb.status).toBe(201);
    const fork = fb.data;
    expect(fork.id).not.toBe(trip.id);
    expect(fc.data.id).not.toBe(fork.id);
    expect(fork.members).toEqual([expect.objectContaining({ id: b.userId, role: "owner" })]);
    expect(fork).toMatchObject({ hasInvite: false, publication: null, pendingRequests: 0, startDate: "2027-01-10" });
    expect(fork.forkedFrom).toMatchObject({ publicationId: pubId, title: "Harbour day" });
    expect(titles(fork)).toEqual(["Opera House", "Botanic Garden"]);
    expect(JSON.stringify(fork)).not.toContain("private note");
    expect((await b.get("/api/trips")).data.owned.find((t: any) => t.id === fork.id).basedOn).toEqual(expect.any(String));
    // the author has no access to the fork
    await trip404(author, fork.id);

    // editing the fork leaves the original and the publication alone, and vice versa
    const stop = fork.days[0].activities[0];
    expect((await b.send("DELETE", `/api/trips/${fork.id}/activities/${stop.id}`)).status).toBe(200);
    expect(titles((await author.get(`/api/trips/${trip.id}`)).data)).toEqual(["Opera House", "Botanic Garden"]);
    expect((await anon(baseUrl).get(`/api/itineraries/${pubId}`)).data.stopCount).toBe(2);
    await addActivity(author, trip, { title: "Author's later stop", startMin: 1000 });
    await author.send("PUT", `/api/trips/${trip.id}/publication`, { description: "updated" });
    expect(titles((await b.get(`/api/trips/${fork.id}`)).data)).toEqual(["Botanic Garden"]);
    expect(titles((await c.get(`/api/trips/${fc.data.id}`)).data)).toEqual(["Opera House", "Botanic Garden"]);

    // a fork can be published with its own identity and no reviews
    await b.send("PUT", `/api/itineraries/${pubId}/reviews`, { rating: 5 });
    const own = await b.send("PUT", `/api/trips/${fork.id}/publication`, { description: "My take" });
    expect(own.status).toBe(201);
    expect(own.data.publication.id).not.toBe(pubId);
    expect(own.data.publication.rating).toEqual({ average: null, count: 0 });
  });

  it("unpublishing stops new views and forks, and existing forks keep working", async () => {
    const { author, trip, pubId } = await published();
    const b = await signUp(baseUrl);
    const fork = (await b.send("POST", `/api/itineraries/${pubId}/copy`, { startDate: "2027-01-10" })).data;
    expect((await author.send("DELETE", `/api/trips/${trip.id}/publication`)).status).toBe(200);
    expect((await anon(baseUrl).get(`/api/itineraries/${pubId}`)).status).toBe(404);
    expect((await b.get(`/api/itineraries/${pubId}`)).status).toBe(404);
    expect((await b.send("POST", `/api/itineraries/${pubId}/copy`, { startDate: "2027-01-10" })).status).toBe(404);
    expect((await anon(baseUrl).get("/api/publications")).data.publications.map((p: any) => p.id)).not.toContain(pubId);
    // the author still sees their own unpublished page
    expect((await author.get(`/api/itineraries/${pubId}`)).data.status).toBe("unpublished");
    const kept = await b.get(`/api/trips/${fork.id}`);
    expect(kept.status).toBe(200);
    expect((await addActivity(b, kept.data, { title: "Still mine" })).status).toBe(201);
  });

  it("takes one review per person, from the session, and averages them on the server", async () => {
    const { author, pubId } = await published();
    const [r1, r2, r3] = await Promise.all([signUp(baseUrl), signUp(baseUrl), signUp(baseUrl)]);
    const url = `/api/itineraries/${pubId}/reviews`;
    expect((await anon(baseUrl).send("PUT", url, { rating: 5 })).status).toBe(401);
    expect((await author.send("PUT", url, { rating: 5 })).status).toBe(403);
    for (const bad of [0, 6, 3.5, "4", null]) expect((await r1.send("PUT", url, { rating: bad })).status, String(bad)).toBe(400);

    // a forged author id is ignored: the review is r1's
    const first = await r1.send("PUT", url, { rating: 4, comment: "Nice", userId: r2.userId });
    expect(first.status).toBe(201);
    expect(first.data.review.author.id).toBe(r1.userId);
    // a second submission edits, never duplicates
    const edit = await r1.send("PUT", url, { rating: 2, comment: "Changed my mind" });
    expect(edit.status).toBe(200);
    expect(edit.data.review.id).toBe(first.data.review.id);
    await r2.send("PUT", url, { rating: 5 });
    await r3.send("PUT", url, { rating: 5 });
    const pub = (await anon(baseUrl).get(`/api/itineraries/${pubId}`)).data;
    expect(pub.rating).toEqual({ average: 4, count: 3 });
    expect(pub.reviews.filter((r: any) => r.author.id === r1.userId)).toHaveLength(1);

    // nobody touches another's review
    expect((await r2.send("DELETE", `${url}/${first.data.review.id}`)).status).toBe(403);
    expect((await r1.send("DELETE", `${url}/${first.data.review.id}`)).status).toBe(200);
    expect((await anon(baseUrl).get(`/api/itineraries/${pubId}`)).data.rating).toEqual({ average: 5, count: 2 });
    // a fork brings no reviews with it
    const fork = (await r1.send("POST", `/api/itineraries/${pubId}/copy`, { startDate: "2027-01-10" })).data;
    // no trip reviews or rating come along (each day's own "review" is the day's quality check, not these)
    expect(fork).not.toHaveProperty("reviews");
    expect(fork).not.toHaveProperty("rating");
    expect(JSON.stringify(fork)).not.toMatch(/"reviews"|"rating"|"myReview"/);
  });
});
