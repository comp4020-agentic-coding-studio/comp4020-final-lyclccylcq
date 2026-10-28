import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { addActivity, anon, newTrip, share, signUp, startApp } from "./helpers.ts";

// How each API request becomes (or doesn't become) a log line
// (docs/logging.md): the business event a route stands for, the overrides a
// handler notes, and what a refusal or a switched-off feature is called.
// logging.test.ts covers the collaborative session; this pins the rest.

type Entry = Record<string, any>;

describe("request log classification", () => {
  let app: Awaited<ReturnType<typeof startApp>>;
  const entries = (): Entry[] =>
    app
      .output()
      .split("\n")
      .filter(Boolean)
      .map((l) => JSON.parse(l));
  const until = async (test: (e: Entry[]) => boolean) => {
    for (let i = 0; i < 50 && !test(entries()); i++) await new Promise((r) => setTimeout(r, 40));
    return entries();
  };

  beforeAll(async () => {
    app = await startApp();
  });
  afterAll(() => app.stop());

  it("names publishing, republishing, forking and reviews by what happened", async () => {
    const author = await signUp(app.url);
    const reader = await signUp(app.url);
    const trip = await newTrip(author, { title: "Published for logs" });
    expect((await addActivity(author, trip, { title: "Stop" })).status).toBe(201);

    expect((await author.send("PUT", `/api/trips/${trip.id}/publication`, { description: "First" })).status).toBe(201);
    expect((await author.send("PUT", `/api/trips/${trip.id}/publication`, { description: "Second" })).status).toBe(200);
    const pub = (await author.get(`/api/trips/${trip.id}/publication`)).data.publication.id as string;

    const fork = await reader.send("POST", `/api/itineraries/${pub}/copy`, { startDate: "2026-12-10" });
    expect(fork.status).toBe(201);
    expect((await reader.send("PUT", `/api/itineraries/${pub}/reviews`, { rating: 4, comment: "" })).status).toBe(201);
    expect((await reader.send("PUT", `/api/itineraries/${pub}/reviews`, { rating: 5, comment: "" })).status).toBe(200);

    const all = await until((e) => e.some((x) => x.event === "REVIEW_UPDATED" && x.userId === reader.userId));
    const mine = all.filter((e) => e.userId === author.userId || e.userId === reader.userId);
    const published = mine.filter((e) => e.tripId === trip.id && (e.event === "TRIP_PUBLISHED" || e.event === "TRIP_REPUBLISHED"));
    expect(published.map((e) => [e.event, e.action, e.httpStatus])).toEqual([
      ["TRIP_PUBLISHED", "publish_trip", 201],
      ["TRIP_REPUBLISHED", "republish_trip", 200],
    ]);
    expect(published[0].publicationId).toBe(pub);
    // a fork names the new trip, not the publication's
    expect(mine.find((e) => e.event === "TRIP_FORKED")).toMatchObject({ userId: reader.userId, action: "use_template", publicationId: pub, tripId: fork.data.id, status: "success" });
    const reviews = mine.filter((e) => e.publicationId === pub && e.event.startsWith("REVIEW_"));
    expect(reviews.map((e) => [e.event, e.action])).toEqual([
      ["REVIEW_CREATED", "review"],
      ["REVIEW_UPDATED", "review"],
    ]);
  });

  it("marks replays and repeats instead of logging them as new actions, and never logs an invite token", async () => {
    const owner = await signUp(app.url);
    const guest = await signUp(app.url);
    const trip = await newTrip(owner);
    const body = { clientId: "replay-client-0001", dayId: trip.days[0].id, title: "Once", kind: "custom", startMin: 600, durationMin: 60 };
    expect((await owner.send("POST", `/api/trips/${trip.id}/activities`, body)).status).toBe(201);
    expect((await owner.send("POST", `/api/trips/${trip.id}/activities`, body)).status).toBe(200);

    const { data } = await owner.send("POST", `/api/trips/${trip.id}/invite`, {});
    expect((await guest.get(`/api/invites/${data.token}`)).status).toBe(200);
    expect((await guest.send("POST", `/api/invites/${data.token}/request`, {})).status).toBe(201);
    expect((await guest.send("POST", `/api/invites/${data.token}/request`, {})).status).toBe(200);

    const all = await until((e) => e.some((x) => x.event === "COLLAB_REQUEST_REPEATED" && x.userId === guest.userId));
    const adds = all.filter((e) => e.tripId === trip.id && e.action === "add_destination");
    expect(adds.map((e) => [e.event, e.httpStatus])).toEqual([
      ["TRIP_DESTINATION_ADDED", 201],
      ["TRIP_DESTINATION_ADD_REPLAYED", 200],
    ]);
    expect(adds[0].activityId).toBe(adds[1].activityId);
    const joins = all.filter((e) => e.userId === guest.userId && e.action === "request_to_join");
    expect(joins.map((e) => e.event)).toEqual(["COLLAB_REQUEST_CREATED", "COLLAB_REQUEST_REPEATED"]);
    expect(joins[0].tripId).toBe(trip.id);
    const opened = all.find((e) => e.userId === guest.userId && e.event === "INVITATION_OPENED");
    expect(opened).toMatchObject({ path: "/api/invites/[token]", action: "open_invite_link" });
    expect(joins[0].path).toBe("/api/invites/[token]/request");
    expect(app.output()).not.toContain(data.token);
  });

  it("calls a switched-off feature unavailable, a stranger's read denied, and stays quiet about routine 401s", async () => {
    const owner = await signUp(app.url);
    const stranger = await signUp(app.url);
    const trip = await newTrip(owner);
    const a = (await addActivity(owner, trip, { title: "A", startMin: 540 })).data.activityId;
    const b = (await addActivity(owner, trip, { title: "B", startMin: 720 })).data.activityId;
    // stops without places: refused as invalid input
    expect((await owner.send("POST", `/api/trips/${trip.id}/routes`, { fromId: a, toId: b })).status).toBe(400);
    // no AI key in this app: planning is a 503, a feature switched off, not a server error
    expect((await owner.send("POST", `/api/trips/${trip.id}/plan`, { dayId: trip.days[0].id, action: "optimize" })).status).toBe(503);
    expect((await stranger.get(`/api/trips/${trip.id}`)).status).toBe(404);
    expect((await anon(app.url).get("/api/auth/me")).status).toBe(401);
    expect((await owner.get("/api/no-such-thing")).status).toBe(404);

    const all = await until((e) => e.some((x) => x.event === "ACCESS_DENIED" && x.userId === stranger.userId));
    expect(all.find((e) => e.tripId === trip.id && e.event === "FEATURE_UNAVAILABLE")).toMatchObject({
      level: "WARN",
      userId: owner.userId,
      status: "failure",
      errorCode: "UNAVAILABLE",
      attemptedEvent: "AI_PLAN_DRAFTED",
      action: "plan_day",
      httpStatus: 503,
    });
    expect(all.find((e) => e.tripId === trip.id && e.action === "calculate_route")).toMatchObject({ event: "INVALID_TRIP_OPERATION", errorCode: "INVALID_INPUT", attemptedEvent: "TRIP_ROUTE_CALCULATED" });
    expect(all.find((e) => e.userId === stranger.userId && e.tripId === trip.id)).toMatchObject({
      event: "ACCESS_DENIED",
      status: "denied",
      errorCode: "NOT_FOUND",
      attemptedEvent: "TRIP_OPENED",
    });
    // a signed-out "who am I?" and an unknown read aren't attempts at anything
    expect(all.some((e) => e.path === "/api/auth/me")).toBe(false);
    expect(all.some((e) => e.path === "/api/no-such-thing")).toBe(false);
  });

  it("logs a denied write by a member as an unauthorised modification, with the right event", async () => {
    const owner = await signUp(app.url);
    const guest = await signUp(app.url);
    const trip = await newTrip(owner);
    await share(owner, guest, trip.id);
    expect((await guest.send("PUT", `/api/trips/${trip.id}/publication`, { description: "Not mine" })).status).toBe(403);
    const all = await until((e) => e.some((x) => x.userId === guest.userId && x.attemptedEvent === "TRIP_PUBLISHED"));
    expect(all.find((e) => e.userId === guest.userId && e.attemptedEvent === "TRIP_PUBLISHED")).toMatchObject({
      event: "UNAUTHORIZED_MODIFICATION_ATTEMPT",
      status: "denied",
      errorCode: "FORBIDDEN",
      action: "publish_trip",
    });
  });
});
