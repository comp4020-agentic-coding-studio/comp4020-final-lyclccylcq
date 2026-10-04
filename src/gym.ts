import { randomBytes, randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { type Exercise, KINDS, MACHINES, kindById, machineById } from "./equipment.ts";
import { createLockers } from "./lockers.ts";

// idle: in the gym, not on a machine (or back at one after cancelling a set)
// training: a set is under way on a machine
// resting: a set is finished; still at the machine, between sets
export type State = "idle" | "training" | "resting" | "away";

export const COLOURS = ["#ff6b4a", "#ffb703", "#2ec4b6", "#4d7cfe", "#b15cff", "#ff5fa2"];

// Someone standing about with nothing happening for this long has gone home
// without pressing Leave (closed the tab, put the phone away): their visit is
// closed at their last activity and they're no longer in the gym. Training
// and resting have their own, shorter expiry below.
const IDLE_MS = 45 * 60 * 1000;
// A started set that's never finished (the tab closed, the phone died) is
// dropped, not recorded, and frees the machine. Timed work gets its planned
// minutes on top.
const SET_MS = 10 * 60 * 1000;
// Resting this long means you've wandered off: the machine is free again.
const REST_MS = 15 * 60 * 1000;

export class InputError extends Error {
  readonly status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
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
  machine: string | null;
  since: number;
  plan_weight: number | null;
  plan_amount: number | null;
  expires_at: number | null;
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

// The set someone is about to do, checked against what the exercise measures.
function cleanPlan(ex: Exercise, input: { weightKg?: unknown; amount?: unknown }) {
  let weight = 0;
  if (ex.weighted) {
    weight = Number(input.weightKg);
    if (input.weightKg === null || input.weightKg === "" || !Number.isFinite(weight) || weight < 0 || weight > 500) {
      throw new InputError("Weight should be between 0 and 500 kg.");
    }
    weight = Math.round(weight * 100) / 100;
  }
  const amount = Number(input.amount);
  const max = ex.measure === "reps" ? 100 : 180;
  if (!Number.isInteger(amount) || amount < 1 || amount > max) {
    throw new InputError(ex.measure === "reps" ? `Reps should be a whole number from 1 to ${max}.` : `Minutes should be a whole number from 1 to ${max}.`);
  }
  return { weight, amount };
}

export function createGym(db: DatabaseSync, clock: () => number = Date.now, opts: { lockers?: number } = {}) {
  const lockers = createLockers(db, clock, opts.lockers);
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
    presence: db.prepare("select state, exercise, machine, since, plan_weight, plan_amount, expires_at from presence where user_id = ?"),
    putPresence: db.prepare(`
      insert into presence (user_id, state, exercise, machine, plan_weight, plan_amount, since, expires_at)
      values (?, ?, ?, ?, ?, ?, ?, ?)
      on conflict (user_id) do update set
        state = excluded.state, exercise = excluded.exercise, machine = excluded.machine,
        plan_weight = excluded.plan_weight, plan_amount = excluded.plan_amount,
        since = excluded.since, expires_at = excluded.expires_at`),
    // unfinished sets and long rests let go of their machine
    expire: db.prepare(`
      update presence set state = 'idle', exercise = null, machine = null,
        plan_weight = null, plan_amount = null, since = expires_at, expires_at = null
      where state in ('training', 'resting') and expires_at <= ?`),
    holder: db.prepare("select user_id from presence where machine = ? and state in ('training', 'resting') and user_id != ?"),
    floor: db.prepare(`
      select u.id, u.name, u.colour, p.state, p.exercise, p.machine, p.since
      from presence p join users u on u.id = p.user_id
      where p.state in ('training', 'resting') or (p.state = 'idle' and p.since > ?)
      order by p.since`),
  };

  const presenceOf = (userId: string) => q.presence.get(userId) as PresenceRow | undefined;
  const put = (userId: string, state: State, at: number, o: Partial<Omit<PresenceRow, "state" | "since">> = {}) =>
    q.putPresence.run(userId, state, o.exercise ?? null, o.machine ?? null, o.plan_weight ?? null, o.plan_amount ?? null, at, o.expires_at ?? null);

  function sessionFor(userId: string, now: number): number {
    const open = q.openSession.get(userId) as { id: number } | undefined;
    return open ? open.id : Number(q.insertSession.run(userId, now).lastInsertRowid);
  }

  function leaveAt(userId: string, at: number): void {
    q.closeSessions.run(at, userId);
    put(userId, "away", at);
  }

  // Bring live state up to now: expired sets and rests first, then someone
  // idle for too long has gone home, their visit closed at their last activity.
  function settle(userId: string, now: number): void {
    q.expire.run(now);
    const p = presenceOf(userId);
    if (p && p.state === "idle" && now - p.since > IDLE_MS) leaveAt(userId, p.since);
  }

  function inGym(userId: string): PresenceRow {
    const p = presenceOf(userId);
    if (!p || p.state === "away") throw new InputError("Walk into the gym first.", 409);
    return p;
  }

  // Each mutation below is one of the events a live gym will broadcast at
  // crit 9 (enter, start, finish, cancel, step off, leave); they all end by
  // returning the caller's fresh view, which is the seam a broadcast hooks onto.
  return {
    createIdentity(name: unknown, colour: unknown) {
      const clean = cleanName(name);
      if (typeof colour !== "string" || !COLOURS.includes(colour)) throw new InputError("Pick one of the colours.");
      const id = randomUUID();
      const pass = newPass();
      q.insertUser.run(id, pass, clean, colour, clock());
      lockers.ensure(id);
      return { pass, user: this.userByPass(pass)! };
    },

    userByPass(raw: string | undefined): UserRow | undefined {
      const pass = raw ? normalisePass(raw) : "";
      return pass ? (q.userByPass.get(pass) as UserRow | undefined) : undefined;
    },

    me(userId: string) {
      const now = clock();
      settle(userId, now);
      const user = q.userById.get(userId) as unknown as UserRow & { pass: string };
      const p = presenceOf(userId);
      const open = q.openSession.get(userId) as { id: number; started_at: number } | undefined;
      return {
        now,
        user: { id: user.id, name: user.name, colour: user.colour, since: user.created_at },
        pass: user.pass,
        locker: lockers.ensure(userId),
        presence: {
          state: p?.state ?? ("away" as State),
          exercise: p?.exercise ?? null,
          machine: p?.machine ?? null,
          since: p?.since ?? user.created_at,
          expiresAt: p?.expires_at ?? null,
          plan: p?.plan_amount != null ? { weightKg: p.plan_weight ?? 0, amount: p.plan_amount } : null,
        },
        session: open
          ? { startedAt: open.started_at, sets: (q.setsIn.all(open.id) as unknown as SetRow[]).map(setOut) }
          : null,
        lastByExercise: Object.fromEntries(
          (q.lastPerExercise.all(userId) as unknown as SetRow[]).map((s) => [s.exercise, setOut(s)]),
        ),
      };
    },

    enter(userId: string) {
      const now = clock();
      settle(userId, now);
      sessionFor(userId, now);
      const p = presenceOf(userId);
      if (!p || p.state === "away") put(userId, "idle", now);
      return this.me(userId);
    },

    // Start a set on a machine. Nothing is recorded yet: the set exists only
    // once it's finished.
    start(userId: string, input: { machine?: unknown; exercise?: unknown; weightKg?: unknown; amount?: unknown }) {
      const machine = typeof input.machine === "string" ? machineById.get(input.machine) : undefined;
      if (!machine) throw new InputError("That isn't a machine in this gym.");
      const ex = kindById.get(machine.kind)!.exercises.find((e) => e.name === input.exercise);
      if (!ex) throw new InputError(`That isn't something you do on the ${machine.name}.`);
      const { weight, amount } = cleanPlan(ex, input);
      const now = clock();
      settle(userId, now);
      const p = inGym(userId);
      if (p.state === "training" && p.machine !== machine.id) throw new InputError("Finish or cancel the set you're on first.", 409);
      if (q.holder.get(machine.id, userId)) throw new InputError("Someone's on that machine.", 409);
      sessionFor(userId, now);
      const limit = SET_MS + (ex.measure === "min" ? amount * 60_000 : 0);
      put(userId, "training", now, { exercise: ex.name, machine: machine.id, plan_weight: weight, plan_amount: amount, expires_at: now + limit });
      return this.me(userId);
    },

    // Finish the set under way: this is when it's recorded.
    finish(userId: string) {
      const now = clock();
      settle(userId, now);
      const p = inGym(userId);
      if (p.state !== "training") throw new InputError("There's no set under way to finish.", 409);
      const session = sessionFor(userId, now);
      q.insertSet.run(session, userId, p.exercise!, p.plan_weight ?? 0, p.plan_amount!, now);
      put(userId, "resting", now, {
        exercise: p.exercise,
        machine: p.machine,
        plan_weight: p.plan_weight,
        plan_amount: p.plan_amount,
        expires_at: now + REST_MS,
      });
      return this.me(userId);
    },

    // Stop a set without recording it; you stay by the machine.
    cancel(userId: string) {
      const now = clock();
      settle(userId, now);
      const p = inGym(userId);
      if (p.state !== "training") throw new InputError("There's no set under way to cancel.", 409);
      put(userId, "idle", now, { machine: p.machine });
      return this.me(userId);
    },

    // Step away from a machine, to the water and the benches.
    stepOff(userId: string) {
      const now = clock();
      settle(userId, now);
      const p = inGym(userId);
      if (p.state === "training") throw new InputError("Finish or cancel the set you're on first.", 409);
      put(userId, "idle", now);
      return this.me(userId);
    },

    // Your own locker and what's in it. Only ever the caller's: there is no
    // way to ask for someone else's.
    locker(userId: string) {
      settle(userId, clock());
      return lockers.contents(userId);
    },

    leave(userId: string) {
      leaveAt(userId, clock());
      return this.me(userId);
    },

    // Everyone in the gym right now. Public, so it carries only what you'd
    // see looking across a real gym: who, which machine, what they're doing,
    // and whether they're mid-set or between sets. No passes, and no weights
    // or reps: nobody's numbers are set beside anyone else's.
    floor() {
      const now = clock();
      q.expire.run(now);
      const rows = q.floor.all(now - IDLE_MS) as unknown as (PresenceRow & { id: string; name: string; colour: string })[];
      return {
        now,
        kinds: KINDS,
        machines: MACHINES,
        colours: COLOURS,
        lockers: lockers.room(),
        people: rows.map((r) => ({
          id: r.id,
          name: r.name,
          colour: r.colour,
          state: r.state,
          exercise: r.exercise,
          machine: r.machine && machineById.has(r.machine) ? r.machine : null,
          since: r.since,
        })),
      };
    },
  };
}

export type Gym = ReturnType<typeof createGym>;
