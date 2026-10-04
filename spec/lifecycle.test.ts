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

function gymAt(start = Date.UTC(2026, 9, 5, 9), lockers?: number) {
  const dir = mkdtempSync(join(tmpdir(), "gym-spec-"));
  let t = start;
  const gym = createGym(openDb(dir), () => t, { lockers });
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

describe("someone who goes home without pressing Leave", () => {
  it("is out of the gym after 45 idle minutes, their visit closed at their last set", () => {
    const { gym, wait } = gymAt();
    const id = person(gym);
    gym.start(id, { machine: "rack-a", exercise: "Squat", weightKg: 80, amount: 5 });
    wait(2 * MIN);
    gym.finish(id);
    wait(15 * MIN + 46 * MIN);
    expect(gym.floor().people.some((p) => p.id === id)).toBe(false);
    expect(gym.me(id).presence.state).toBe("away");
    const visit = gym.locker(id).visits[0];
    expect(visit.endedAt).not.toBeNull();
    expect(visit.sets).toBe(1);
  });
});

describe("the locker", () => {
  const set = (gym: ReturnType<typeof createGym>, id: string, machine: string, exercise: string, weightKg: number, amount: number) => {
    gym.start(id, { machine, exercise, weightKg, amount });
    gym.finish(id);
  };

  it("keeps visits apart, newest first, and counts the past week", () => {
    const { gym, wait } = gymAt();
    const id = person(gym);
    set(gym, id, "bench-a", "Bench Press", 60, 8);
    set(gym, id, "bench-a", "Bench Press", 60, 8);
    gym.leave(id);
    wait(26 * 60 * MIN);
    gym.enter(id);
    set(gym, id, "pulldown-a", "Lat Pulldown", 28.5, 12);

    const locker = gym.locker(id);
    expect(locker.visits.map((v) => v.exercises.map((e) => `${e.exercise} ×${e.sets.length}`))).toEqual([["Lat Pulldown ×1"], ["Bench Press ×2"]]);
    expect(locker.visits[0].endedAt).toBeNull();
    expect(locker.visitsThisWeek).toBe(2);

    gym.leave(id);
    wait(6 * 24 * 60 * MIN);
    expect(gym.locker(id).visitsThisWeek, "the bench visit is over a week old").toBe(1);
  });

  it("names the heaviest set of each weighted exercise, and nothing for cardio or bodyweight", () => {
    const { gym } = gymAt();
    const id = person(gym);
    set(gym, id, "bench-a", "Bench Press", 60, 8);
    set(gym, id, "bench-a", "Bench Press", 70, 3);
    set(gym, id, "bench-a", "Bench Press", 70, 5);
    set(gym, id, "bench-a", "Bench Press", 65, 10);
    set(gym, id, "treadmill-a", "Treadmill", 0, 20);
    set(gym, id, "pullup-a", "Assisted Pull-up", 0, 8);
    expect(gym.locker(id).bests).toEqual([expect.objectContaining({ exercise: "Bench Press", weightKg: 70, amount: 5, fromLatestVisit: true })]);
  });

  it("stays with its owner, and only when the room is full goes to a newcomer from whoever has been gone longest", () => {
    const { gym, wait } = gymAt(undefined, 2);
    const a = person(gym, "A");
    const b = person(gym, "B");
    expect([gym.me(a).locker, gym.me(b).locker]).toEqual([1, 2]);
    set(gym, a, "bench-a", "Bench Press", 60, 8);
    gym.leave(a);
    wait(60 * MIN);
    gym.leave(b);
    wait(24 * 60 * MIN);
    expect(gym.me(a).locker, "a locker isn't taken back while there's room").toBe(1);

    const c = person(gym, "C");
    expect(gym.me(c).locker, "A has been gone longest").toBe(1);
    expect(gym.me(b).locker).toBe(2);
    expect(gym.locker(a).visits[0].exercises[0].exercise, "A's history stays theirs without a locker number").toBe("Bench Press");
    // A comes back to a full room: B, out for a day, has been gone longest now
    expect(gym.enter(a).locker).toBe(2);
    gym.enter(c);
    expect(gym.enter(b).locker, "everyone with a locker is in the gym").toBeNull();
  });
});
