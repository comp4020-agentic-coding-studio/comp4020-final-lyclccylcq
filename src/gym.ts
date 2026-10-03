import { randomBytes, randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";

export type State = "idle" | "training" | "resting" | "away";

interface Station {
  id: string;
  name: string;
  // timed work (cardio, stretching) logs minutes and no weight
  measure: "reps" | "min";
  weighted: boolean;
  exercises: string[];
}

// The floor. Every exercise belongs to one station, and that's where its
// lifter stands; anyone between exercises stands in the rest area.
export const STATIONS: Station[] = [
  { id: "pull", name: "Cable Stack", measure: "reps", weighted: true, exercises: ["Lat Pulldown", "Seated Cable Row", "Face Pull"] },
  { id: "chest", name: "Bench", measure: "reps", weighted: true, exercises: ["Bench Press", "Incline Dumbbell Press", "Push-up"] },
  { id: "legs", name: "Squat Rack", measure: "reps", weighted: true, exercises: ["Squat", "Romanian Deadlift", "Split Squat"] },
  { id: "cardio", name: "Cardio", measure: "min", weighted: false, exercises: ["Rower", "Bike", "Treadmill"] },
  { id: "rest", name: "Stretch & Rest", measure: "min", weighted: false, exercises: ["Stretching", "Foam Rolling"] },
];

const stationOf = new Map(STATIONS.flatMap((s) => s.exercises.map((e) => [e, s] as const)));

export const COLOURS = ["#ff6b4a", "#ffb703", "#2ec4b6", "#4d7cfe", "#b15cff", "#ff5fa2"];

// Someone who walked off without pressing Leave isn't still on the floor three
// hours later: past this, their visit is closed at their last activity.
const STALE_MS = 3 * 60 * 60 * 1000;

export class InputError extends Error {
  readonly status = 400;
}

interface UserRow {
  id: string;
  name: string;
  colour: string;
  created_at: number;
}

interface PresenceRow {
  state: State;
  exercise: string | null;
  since: number;
}

interface SetRow {
  id: number;
  exercise: string;
  weight_kg: number;
  amount: number;
  done_at: number;
}

const setOut = (s: SetRow) => ({
  id: s.id,
  exercise: s.exercise,
  weightKg: s.weight_kg,
  amount: s.amount,
  doneAt: s.done_at,
});

// Crockford base32: 32 symbols, so a random byte masked to 5 bits is unbiased,
// and no I/L/O/U to misread when typing a pass on another device.
const PASS_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

function newPass(): string {
  const chars = [...randomBytes(12)].map((b) => PASS_ALPHABET[b & 31]).join("");
  return chars.match(/.{4}/g)!.join("-");
}

export function normalisePass(raw: string): string {
  const chars = raw
    .toUpperCase()
    .replace(/O/g, "0")
    .replace(/[IL]/g, "1")
    .replace(/[^0-9A-Z]/g, "");
  return chars.length === 12 ? chars.match(/.{4}/g)!.join("-") : "";
}

function cleanName(raw: unknown): string {
  const name = typeof raw === "string" ? raw.replace(/\s+/g, " ").trim() : "";
  if (name.length < 1 || name.length > 24 || /\p{Cc}/u.test(name)) {
    throw new InputError("Pick a name of 1 to 24 characters.");
  }
  return name;
}

function exerciseStation(raw: unknown): Station {
  const station = typeof raw === "string" ? stationOf.get(raw) : undefined;
  if (!station) throw new InputError("That isn't an exercise on this floor.");
  return station;
}

export function createGym(db: DatabaseSync) {
  const q = {
    insertUser: db.prepare("insert into users (id, pass, name, colour, created_at) values (?, ?, ?, ?, ?)"),
    userByPass: db.prepare("select id, name, colour, created_at from users where pass = ?"),
    userById: db.prepare("select id, name, colour, created_at, pass from users where id = ?"),
    openSession: db.prepare("select id, started_at from sessions where user_id = ? and ended_at is null order by id desc limit 1"),
    insertSession: db.prepare("insert into sessions (user_id, started_at) values (?, ?)"),
    closeSessions: db.prepare("update sessions set ended_at = ? where user_id = ? and ended_at is null"),
    insertSet: db.prepare("insert into sets (session_id, user_id, exercise, weight_kg, amount, done_at) values (?, ?, ?, ?, ?, ?)"),
    setsIn: db.prepare("select id, exercise, weight_kg, amount, done_at from sets where session_id = ? order by id"),
    lastPerExercise: db.prepare(`
      select id, exercise, weight_kg, amount, done_at from sets
      where id in (select max(id) from sets where user_id = ? group by exercise)`),
    lastVisit: db.prepare(`
      select s.started_at, s.ended_at, count(t.id) as sets
      from sessions s left join sets t on t.session_id = s.id
      where s.user_id = ? and s.ended_at is not null
      group by s.id order by s.id desc limit 1`),
    totals: db.prepare(`
      select (select count(*) from sessions where user_id = ?1) as visits,
             (select count(*) from sets where user_id = ?1) as sets`),
    presence: db.prepare("select state, exercise, since from presence where user_id = ?"),
    putPresence: db.prepare(`
      insert into presence (user_id, state, exercise, since, last_set_id) values (?, ?, ?, ?, ?)
      on conflict (user_id) do update set
        state = excluded.state, exercise = excluded.exercise, since = excluded.since,
        last_set_id = coalesce(excluded.last_set_id, presence.last_set_id)`),
    floor: db.prepare(`
      select u.id, u.name, u.colour, p.state, p.exercise, p.since,
             t.exercise as set_exercise, t.weight_kg, t.amount
      from presence p join users u on u.id = p.user_id
      left join sets t on t.id = p.last_set_id
      where p.state != 'away' and p.since > ?
      order by p.since`),
  };

  const presenceOf = (userId: string) => q.presence.get(userId) as PresenceRow | undefined;

  function sessionFor(userId: string, now: number): number {
    const open = q.openSession.get(userId) as { id: number } | undefined;
    return open ? open.id : Number(q.insertSession.run(userId, now).lastInsertRowid);
  }

  function leaveAt(userId: string, at: number): void {
    q.closeSessions.run(at, userId);
    q.putPresence.run(userId, "away", null, at, null);
  }

  // A visit left open for too long is closed at its last activity, so the
  // person reads as away instead of resting for days.
  function settle(userId: string, now: number): void {
    const p = presenceOf(userId);
    if (p && p.state !== "away" && now - p.since > STALE_MS) leaveAt(userId, p.since);
  }

  // Each mutation below is one of the events a live floor will broadcast in
  // crit 9 (enter, choose, set, leave); they all end by returning the caller's
  // fresh view, which is the seam a broadcast hooks onto.
  return {
    createIdentity(name: unknown, colour: unknown) {
      const clean = cleanName(name);
      if (typeof colour !== "string" || !COLOURS.includes(colour)) throw new InputError("Pick one of the colours.");
      const id = randomUUID();
      const pass = newPass();
      q.insertUser.run(id, pass, clean, colour, Date.now());
      return { pass, user: this.userByPass(pass)! };
    },

    userByPass(raw: string | undefined): UserRow | undefined {
      const pass = raw ? normalisePass(raw) : "";
      return pass ? (q.userByPass.get(pass) as UserRow | undefined) : undefined;
    },

    me(userId: string) {
      const now = Date.now();
      settle(userId, now);
      const user = q.userById.get(userId) as unknown as UserRow & { pass: string };
      const presence = presenceOf(userId) ?? { state: "away" as State, exercise: null, since: user.created_at };
      const open = q.openSession.get(userId) as { id: number; started_at: number } | undefined;
      const visit = q.lastVisit.get(userId) as { started_at: number; ended_at: number; sets: number } | undefined;
      return {
        now,
        user: { id: user.id, name: user.name, colour: user.colour, since: user.created_at },
        pass: user.pass,
        presence,
        session: open
          ? { startedAt: open.started_at, sets: (q.setsIn.all(open.id) as unknown as SetRow[]).map(setOut) }
          : null,
        lastVisit: visit ? { startedAt: visit.started_at, endedAt: visit.ended_at, sets: visit.sets } : null,
        lastByExercise: Object.fromEntries(
          (q.lastPerExercise.all(userId) as unknown as SetRow[]).map((s) => [s.exercise, setOut(s)]),
        ),
        totals: q.totals.get(userId) as { visits: number; sets: number },
      };
    },

    enter(userId: string) {
      const now = Date.now();
      settle(userId, now);
      sessionFor(userId, now);
      const p = presenceOf(userId);
      if (!p || p.state === "away") q.putPresence.run(userId, "idle", null, now, null);
      return this.me(userId);
    },

    choose(userId: string, exercise: unknown) {
      exerciseStation(exercise);
      const now = Date.now();
      settle(userId, now);
      sessionFor(userId, now);
      q.putPresence.run(userId, "training", exercise as string, now, null);
      return this.me(userId);
    },

    logSet(userId: string, input: { exercise?: unknown; weightKg?: unknown; amount?: unknown }) {
      const station = exerciseStation(input.exercise);
      let weight = 0;
      if (station.weighted) {
        weight = Number(input.weightKg);
        if (input.weightKg === null || input.weightKg === "" || !Number.isFinite(weight) || weight < 0 || weight > 500) {
          throw new InputError("Weight should be between 0 and 500 kg.");
        }
        weight = Math.round(weight * 100) / 100;
      }
      const amount = Number(input.amount);
      const max = station.measure === "reps" ? 100 : 180;
      if (!Number.isInteger(amount) || amount < 1 || amount > max) {
        throw new InputError(station.measure === "reps" ? `Reps should be a whole number from 1 to ${max}.` : `Minutes should be a whole number from 1 to ${max}.`);
      }
      const now = Date.now();
      settle(userId, now);
      const session = sessionFor(userId, now);
      const setId = Number(q.insertSet.run(session, userId, input.exercise as string, weight, amount, now).lastInsertRowid);
      q.putPresence.run(userId, "resting", input.exercise as string, now, setId);
      return this.me(userId);
    },

    leave(userId: string) {
      leaveAt(userId, Date.now());
      return this.me(userId);
    },

    // Everyone currently on the floor. Public: no passes, only what you'd see
    // looking across a real gym.
    floor() {
      const now = Date.now();
      const rows = q.floor.all(now - STALE_MS) as unknown as (PresenceRow & {
        id: string;
        name: string;
        colour: string;
        set_exercise: string | null;
        weight_kg: number | null;
        amount: number | null;
      })[];
      return {
        now,
        stations: STATIONS,
        colours: COLOURS,
        people: rows.map((r) => ({
          id: r.id,
          name: r.name,
          colour: r.colour,
          state: r.state,
          exercise: r.exercise,
          station: (r.exercise && stationOf.get(r.exercise)?.id) || "rest",
          since: r.since,
          lastSet:
            r.set_exercise === null ? null : { exercise: r.set_exercise, weightKg: r.weight_kg, amount: r.amount },
        })),
      };
    },
  };
}

export type Gym = ReturnType<typeof createGym>;
