import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { openDb } from "../src/db.ts";
import { createGym } from "../src/gym.ts";

// What the running app can't show without waiting for real minutes: a set
// left unfinished when the tab closed, a rest that never ended, and a database
// from before machines existed. These drive the gym directly on a throwaway
// database with a clock the test moves.
const MIN = 60_000;

function gymAt(start = Date.UTC(2026, 9, 5, 9)) {
  const dir = mkdtempSync(join(tmpdir(), "gym-spec-"));
  let t = start;
  const gym = createGym(openDb(dir), () => t);
  return { gym, dir, wait: (ms: number) => (t += ms) };
}

function person(gym: ReturnType<typeof createGym>, name = "Spec") {
  const { user } = gym.createIdentity(name, "#2ec4b6");
  gym.enter(user.id);
  return user.id;
}

describe("a set nobody finishes", () => {
  it("survives a reload, so you can finish it", () => {
    const { gym, wait } = gymAt();
    const id = person(gym);
    gym.start(id, { machine: "bench-a", exercise: "Bench Press", weightKg: 60, amount: 8 });
    wait(3 * MIN);
    expect(gym.me(id).presence).toMatchObject({ state: "training", machine: "bench-a" });
  });

  it("is dropped after ten minutes: nothing recorded, the machine free again", () => {
    const { gym, wait } = gymAt();
    const id = person(gym, "Gone");
    const other = person(gym, "Next");
    gym.start(id, { machine: "bench-a", exercise: "Bench Press", weightKg: 60, amount: 8 });
    wait(11 * MIN);
    const me = gym.me(id);
    expect(me.presence).toMatchObject({ state: "idle", machine: null, plan: null });
    expect(me.session?.sets).toEqual([]);
    expect(() => gym.start(other, { machine: "bench-a", exercise: "Bench Press", weightKg: 40, amount: 8 })).not.toThrow();
  });

  it("gets its planned minutes on top when it's timed", () => {
    const { gym, wait } = gymAt();
    const id = person(gym);
    gym.start(id, { machine: "treadmill-a", exercise: "Treadmill", amount: 30 });
    wait(35 * MIN);
    expect(gym.me(id).presence.state).toBe("training");
    wait(10 * MIN);
    expect(gym.me(id).presence.state).toBe("idle");
  });
});

describe("a rest that never ends", () => {
  it("lets go of the machine after fifteen minutes but keeps the set", () => {
    const { gym, wait } = gymAt();
    const id = person(gym);
    gym.start(id, { machine: "rack-a", exercise: "Squat", weightKg: 80, amount: 5 });
    gym.finish(id);
    wait(16 * MIN);
    const me = gym.me(id);
    expect(me.presence).toMatchObject({ state: "idle", machine: null });
    expect(me.session?.sets).toHaveLength(1);
    expect(gym.floor().people.find((p) => p.id === id)).toMatchObject({ machine: null, state: "idle" });
  });
});

describe("a database from before machines", () => {
  it("reads someone mid-exercise with no machine as standing about, and keeps their sets", () => {
    const { dir } = gymAt();
    const old = new DatabaseSync(join(dir, "gym.db"));
    old.exec(`
      insert into users (id, pass, name, colour, created_at) values ('u1', 'AAAA-BBBB-CCCC', 'Old', '#2ec4b6', 1);
      insert into sessions (id, user_id, started_at) values (1, 'u1', ${Date.now()});
      insert into sets (session_id, user_id, exercise, weight_kg, amount, done_at) values (1, 'u1', 'Bench Press', 50, 5, 2);
      insert into presence (user_id, state, exercise, since) values ('u1', 'resting', 'Bench Press', ${Date.now()});
    `);
    old.close();
    const gym = createGym(openDb(dir));
    const me = gym.me("u1");
    expect(me.presence).toMatchObject({ state: "idle", machine: null, exercise: null });
    expect(me.lastByExercise["Bench Press"]).toMatchObject({ weightKg: 50, amount: 5 });
  });
});
