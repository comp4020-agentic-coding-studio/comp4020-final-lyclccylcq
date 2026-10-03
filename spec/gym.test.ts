import { JSDOM } from "jsdom";
import { afterAll, describe, expect, inject, it } from "vitest";

// The promises README.md makes about identity, persistence and privacy,
// checked against the running app. Every person made here leaves the floor at
// the end so a local gym isn't left full of test people.
const baseUrl = inject("baseUrl");
const made: string[] = [];

async function call(path: string, opts: { pass?: string; body?: unknown } = {}) {
  const res = await fetch(new URL(path, baseUrl), {
    method: opts.body === undefined ? "GET" : "POST",
    headers: {
      "content-type": "application/json",
      ...(opts.pass ? { authorization: `Bearer ${opts.pass}` } : {}),
    },
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
  });
  return { status: res.status, data: await res.json() };
}

async function newPerson(name = "Spec Lifter") {
  const { status, data } = await call("/api/identity", { body: { name, colour: "#2ec4b6" } });
  expect(status).toBe(201);
  made.push(data.pass);
  return data as { pass: string; user: { id: string; name: string } };
}

afterAll(async () => {
  for (const pass of made) await call("/api/leave", { pass, body: {} });
});

describe("identity", () => {
  it("a new identity persists, and its pass brings back the same person", async () => {
    const { pass, user } = await newPerson("Yufei");
    const { status, data } = await call("/api/me", { pass });
    expect(status).toBe(200);
    expect(data.user).toMatchObject({ id: user.id, name: "Yufei" });
  });

  it("a pass typed on another device, in any case and spacing, recovers the same person", async () => {
    const { pass, user } = await newPerson();
    const typed = pass.toLowerCase().replace(/-/g, " ");
    const { data } = await call("/api/me", { pass: typed });
    expect(data.user.id).toBe(user.id);
  });

  it("a display name is a label, not an identity", async () => {
    const a = await newPerson("Alice");
    const b = await newPerson("Alice");
    expect(a.user.id).not.toBe(b.user.id);
  });

  it("acting without a valid pass is refused", async () => {
    expect((await call("/api/me")).status).toBe(401);
    expect((await call("/api/me", { pass: "0000-0000-0000" })).status).toBe(401);
  });

  it("rejects an empty name", async () => {
    const { status } = await call("/api/identity", { body: { name: "   ", colour: "#2ec4b6" } });
    expect(status).toBe(400);
  });
});

describe("sets", () => {
  it("a finished set persists, and puts you at its station, resting", async () => {
    const { pass, user } = await newPerson("Bob");
    await call("/api/activity", { pass, body: { exercise: "Lat Pulldown" } });
    const logged = await call("/api/sets", { pass, body: { exercise: "Lat Pulldown", weightKg: 28.5, amount: 12 } });
    expect(logged.status).toBe(201);

    // a fresh request, as a refresh or another device would make
    const { data: me } = await call("/api/me", { pass });
    expect(me.session.sets.at(-1)).toMatchObject({ exercise: "Lat Pulldown", weightKg: 28.5, amount: 12 });
    expect(me.presence).toMatchObject({ state: "resting", exercise: "Lat Pulldown" });

    const { data: floor } = await call("/api/floor");
    expect(floor.people.find((p: { id: string }) => p.id === user.id)).toMatchObject({
      station: "pull",
      state: "resting",
      lastSet: { exercise: "Lat Pulldown", weightKg: 28.5, amount: 12 },
    });
  });

  it("leaving takes you off the floor but keeps your sets", async () => {
    const { pass, user } = await newPerson();
    await call("/api/sets", { pass, body: { exercise: "Squat", weightKg: 60, amount: 5 } });
    await call("/api/leave", { pass, body: {} });

    const { data: floor } = await call("/api/floor");
    expect(floor.people.some((p: { id: string }) => p.id === user.id)).toBe(false);
    const { data: me } = await call("/api/me", { pass });
    expect(me.presence.state).toBe("away");
    expect(me.lastVisit.sets).toBe(1);
    expect(me.lastByExercise.Squat).toMatchObject({ weightKg: 60, amount: 5 });
  });

  it.each([
    ["an unknown exercise", { exercise: "Bicep Curl Machine", weightKg: 10, amount: 10 }],
    ["a negative weight", { exercise: "Bench Press", weightKg: -5, amount: 10 }],
    ["a missing weight", { exercise: "Bench Press", amount: 10 }],
    ["a weight that isn't a number", { exercise: "Bench Press", weightKg: "heavy", amount: 10 }],
    ["zero reps", { exercise: "Bench Press", weightKg: 40, amount: 0 }],
    ["fractional reps", { exercise: "Bench Press", weightKg: 40, amount: 2.5 }],
    ["an absurd number of reps", { exercise: "Bench Press", weightKg: 40, amount: 5000 }],
  ])("rejects %s, and saves nothing", async (_, body) => {
    const { pass } = await newPerson();
    const { status } = await call("/api/sets", { pass, body });
    expect(status).toBe(400);
    const { data: me } = await call("/api/me", { pass });
    expect(me.session?.sets ?? []).toEqual([]);
  });
});

describe("privacy on the floor", () => {
  it("the public floor never shows anyone's pass", async () => {
    const { pass } = await newPerson();
    const res = await fetch(new URL("/api/floor", baseUrl));
    expect(await res.text()).not.toContain(pass);
  });
});

describe("the page", () => {
  it("carries every station of the floor before any script runs", async () => {
    const { data: floor } = await call("/api/floor");
    const res = await fetch(new URL("/", baseUrl));
    const doc = new JSDOM(await res.text()).window.document;
    expect(doc.querySelector('meta[name="viewport"]')).not.toBeNull();
    for (const station of floor.stations as { id: string; name: string }[]) {
      const zone = doc.querySelector(`[data-station="${station.id}"]`);
      expect(zone, `no zone for ${station.name} on the floor`).not.toBeNull();
      expect(zone!.textContent).toContain(station.name);
    }
  });
});
