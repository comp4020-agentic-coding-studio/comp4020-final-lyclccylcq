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

// Start a set on a machine, as the panel does after you tap it.
const start = (pass: string, machine: string, exercise: string, weightKg: unknown, amount: unknown) =>
  call("/api/start", { pass, body: { machine, exercise, weightKg, amount } });

describe("sets", () => {
  it("starting a set records nothing; finishing records it and leaves you resting at the machine", async () => {
    const { pass, user } = await newPerson("Bob");
    const started = await start(pass, "pulldown-b", "Lat Pulldown", 28.5, 12);
    expect(started.status).toBe(200);
    expect(started.data.presence).toMatchObject({ state: "training", machine: "pulldown-b", plan: { weightKg: 28.5, amount: 12 } });
    expect(started.data.session.sets).toEqual([]);

    expect((await call("/api/finish", { pass, body: {} })).status).toBe(201);
    // a fresh request, as a refresh or another device would make
    const { data: me } = await call("/api/me", { pass });
    expect(me.session.sets.at(-1)).toMatchObject({ exercise: "Lat Pulldown", weightKg: 28.5, amount: 12 });
    expect(me.presence).toMatchObject({ state: "resting", machine: "pulldown-b", exercise: "Lat Pulldown" });

    const { data: floor } = await call("/api/floor");
    expect(floor.people.find((p: { id: string }) => p.id === user.id)).toMatchObject({ machine: "pulldown-b", state: "resting" });
  });

  it("cancelling a set records nothing and keeps you by the machine", async () => {
    const { pass } = await newPerson();
    await start(pass, "treadmill-d", "Treadmill", null, 20);
    const { status, data } = await call("/api/cancel", { pass, body: {} });
    expect(status).toBe(200);
    expect(data.presence).toMatchObject({ state: "idle", machine: "treadmill-d" });
    expect(data.session.sets).toEqual([]);
  });

  it("finishing or cancelling needs a set under way", async () => {
    const { pass } = await newPerson();
    expect((await call("/api/finish", { pass, body: {} })).status).toBe(409);
    expect((await call("/api/cancel", { pass, body: {} })).status).toBe(409);
  });

  it("one machine holds one person", async () => {
    const a = await newPerson("Alice");
    const b = await newPerson("Bob");
    expect((await start(a.pass, "legext-a", "Leg Extension", 30, 10)).status).toBe(200);
    const taken = await start(b.pass, "legext-a", "Leg Extension", 30, 10);
    expect(taken.status).toBe(409);
    expect(taken.data.error).toMatch(/someone/i);
  });

  it("you can't start a second set while one is under way", async () => {
    const { pass } = await newPerson();
    await start(pass, "bench-c", "Bench Press", 40, 8);
    expect((await start(pass, "rack-b", "Squat", 60, 5)).status).toBe(409);
    expect((await call("/api/step-off", { pass, body: {} })).status).toBe(409);
  });

  it("leaving a machine sends you off it; leaving the gym keeps your sets", async () => {
    const { pass, user } = await newPerson();
    await start(pass, "rack-b", "Squat", 60, 5);
    await call("/api/finish", { pass, body: {} });
    const off = await call("/api/step-off", { pass, body: {} });
    expect(off.data.presence).toMatchObject({ state: "idle", machine: null });
    await call("/api/leave", { pass, body: {} });

    const { data: floor } = await call("/api/floor");
    expect(floor.people.some((p: { id: string }) => p.id === user.id)).toBe(false);
    const { data: me } = await call("/api/me", { pass });
    expect(me.presence.state).toBe("away");
    expect(me.lastVisit.sets).toBe(1);
    expect(me.lastByExercise.Squat).toMatchObject({ weightKg: 60, amount: 5 });
  });

  it.each([
    ["a machine that doesn't exist", { machine: "smith-a", exercise: "Squat", weightKg: 10, amount: 10 }],
    ["an exercise that isn't done on that machine", { machine: "cable-b", exercise: "Squat", weightKg: 10, amount: 10 }],
    ["a negative weight", { machine: "bench-c", exercise: "Bench Press", weightKg: -5, amount: 10 }],
    ["a missing weight", { machine: "bench-c", exercise: "Bench Press", amount: 10 }],
    ["a weight that isn't a number", { machine: "bench-c", exercise: "Bench Press", weightKg: "heavy", amount: 10 }],
    ["zero reps", { machine: "bench-c", exercise: "Bench Press", weightKg: 40, amount: 0 }],
    ["fractional reps", { machine: "bench-c", exercise: "Bench Press", weightKg: 40, amount: 2.5 }],
    ["an absurd number of reps", { machine: "bench-c", exercise: "Bench Press", weightKg: 40, amount: 5000 }],
  ])("rejects %s, and changes nothing", async (_, body) => {
    const { pass } = await newPerson();
    const { status } = await call("/api/start", { pass, body });
    expect(status).toBe(400);
    const { data: me } = await call("/api/me", { pass });
    expect(me.presence).toMatchObject({ state: "idle", machine: null });
    expect(me.session?.sets ?? []).toEqual([]);
  });
});

describe("privacy on the floor", () => {
  it("the public floor never shows anyone's pass", async () => {
    const { pass } = await newPerson();
    const res = await fetch(new URL("/api/floor", baseUrl));
    expect(await res.text()).not.toContain(pass);
  });

  // nobody is ranked: others see what you're doing, never how much
  it("the public floor carries no one's weights or reps, mid-set or after it", async () => {
    const { pass, user } = await newPerson();
    await start(pass, "incline-b", "Incline Bench Press", 82.5, 7);
    const mid = (await call("/api/floor")).data.people.find((p: { id: string }) => p.id === user.id);
    expect(mid).toMatchObject({ exercise: "Incline Bench Press", state: "training" });
    await call("/api/finish", { pass, body: {} });
    const after = (await call("/api/floor")).data.people.find((p: { id: string }) => p.id === user.id);
    for (const p of [mid, after]) expect(JSON.stringify(p)).not.toMatch(/82\.5|weight|amount|plan|"reps"/i);
  });
});

describe("the gym", () => {
  it("someone who has walked in but chosen nothing is on no machine", async () => {
    const { user } = await newPerson();
    const { data: floor } = await call("/api/floor");
    expect(floor.people.find((p: { id: string }) => p.id === user.id)).toMatchObject({ state: "idle", machine: null });
  });

  it("every machine is of a kind with its own exercises, and each exercise belongs to one kind", async () => {
    const { data: floor } = await call("/api/floor");
    const kinds = new Map((floor.kinds as { id: string; exercises: { name: string; pose: string }[] }[]).map((k) => [k.id, k]));
    for (const m of floor.machines as { id: string; kind: string }[]) {
      expect(kinds.get(m.kind)?.exercises.length, `${m.id} has no exercises`).toBeGreaterThan(0);
    }
    const all = [...kinds.values()].flatMap((k) => k.exercises.map((e) => e.name));
    expect(new Set(all).size).toBe(all.length);
    for (const k of kinds.values()) for (const e of k.exercises) expect(e.pose, `${e.name} has no animation`).toBeTruthy();
  });

  it("the page has somewhere to draw the gym", async () => {
    const res = await fetch(new URL("/", baseUrl));
    const doc = new JSDOM(await res.text()).window.document;
    expect(doc.querySelector('meta[name="viewport"]')).not.toBeNull();
    expect(doc.querySelector("canvas#world-canvas")).not.toBeNull();
  });
});
