import { randomBytes, randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { type Exercise, KINDS, MACHINES, kindById, machineById } from "./equipment.ts";
import { createLockers } from "./lockers.ts";

// idle: in the gym, not mid-set: at the entrance, by the water, or standing
//   at a machine you've walked over to (or cancelled a set on)
// training: a set is under way on a machine
// resting: a set is finished; still at the machine, between sets
// All of it is live state: where you stand is never history.
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
  plan_setting: number | null;
  expires_at: number | null;
  spot: string | null; // where an idle person not at a machine stands: entrance or lounge
}

interface SetRow {
  id: number;
  exercise: string;
  weight_kg: number;
  amount: number;
  setting: number | null;
  done_at: number;
}

const setOut = (s: SetRow) => ({
  id: s.id,
  exercise: s.exercise,
  weightKg: s.weight_kg,
  amount: s.amount,
  setting: s.setting,
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

// A set, checked against how its exercise is measured (equipment.ts). Load
// goes in weight; assistance or a cardio setting goes in setting.
function cleanPlan(ex: Exercise, input: { weightKg?: unknown; assistKg?: unknown; amount?: unknown; setting?: unknown }) {
  const kg = (raw: unknown, max: number, what: string) => {
    const n = Number(raw);
    if (raw === null || raw === undefined || raw === "" || !Number.isFinite(n) || n < 0 || n > max) {
      throw new InputError(`${what} should be between 0 and ${max} kg.`);
    }
    return Math.round(n * 100) / 100;
  };
  let weight = 0;
  let setting: number | null = null;
  if (ex.metric === "load") weight = kg(input.weightKg, 500, "Weight");
  if (ex.metric === "assist") setting = kg(input.assistKg, 200, "Assistance");
  if (ex.metric === "time" && ex.setting && input.setting !== undefined && input.setting !== null && input.setting !== "") {
    const { label, min, max } = ex.setting;
    const n = Number(input.setting);
    if (!Number.isFinite(n) || n < min || n > max) throw new InputError(`${label} should be between ${min} and ${max}.`);
    setting = Math.round(n * 10) / 10;
  }
  const amount = Number(input.amount);
  const max = ex.metric === "time" ? 180 : 100;
  if (!Number.isInteger(amount) || amount < 1 || amount > max) {
    throw new InputError(ex.metric === "time" ? `Minutes should be a whole number from 1 to ${max}.` : `Reps should be a whole number from 1 to ${max}.`);
  }
  return { weight, amount, setting };
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
    insertSet: db.prepare("insert into sets (session_id, user_id, exercise, weight_kg, amount, setting, done_at) values (?, ?, ?, ?, ?, ?, ?)"),
    setsIn: db.prepare("select id, exercise, weight_kg, amount, setting, done_at from sets where session_id = ? order by id"),
    lastPerExercise: db.prepare(`
      select id, exercise, weight_kg, amount, setting, done_at from sets
      where id in (select max(id) from sets where user_id = ? group by exercise)`),
    presence: db.prepare("select state, exercise, machine, since, plan_weight, plan_amount, plan_setting, expires_at, spot from presence where user_id = ?"),
    putPresence: db.prepare(`
      insert into presence (user_id, state, exercise, machine, plan_weight, plan_amount, plan_setting, since, expires_at, spot)
      values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      on conflict (user_id) do update set
        state = excluded.state, exercise = excluded.exercise, machine = excluded.machine,
        plan_weight = excluded.plan_weight, plan_amount = excluded.plan_amount, plan_setting = excluded.plan_setting,
        since = excluded.since, expires_at = excluded.expires_at, spot = excluded.spot`),
    // unfinished sets and long rests let go of their machine: the person has
    // wandered off to the water
    expire: db.prepare(`
      update presence set state = 'idle', exercise = null, machine = null, spot = 'lounge',
        plan_weight = null, plan_amount = null, plan_setting = null, since = expires_at, expires_at = null
      where state in ('training', 'resting') and expires_at <= ?`),
    holder: db.prepare("select user_id from presence where machine = ? and state in ('training', 'resting') and user_id != ?"),
    floor: db.prepare(`
      select u.id, u.name, u.colour, p.state, p.exercise, p.machine, p.spot, p.since
      from presence p join users u on u.id = p.user_id
      where p.state in ('training', 'resting') or (p.state = 'idle' and p.since > ?)
      order by p.since`),
  };

  const presenceOf = (userId: string) => q.presence.get(userId) as PresenceRow | undefined;
  const put = (userId: string, state: State, at: number, o: Partial<Omit<PresenceRow, "state" | "since">> = {}) =>
    q.putPresence.run(
      userId, state, o.exercise ?? null, o.machine ?? null,
      o.plan_weight ?? null, o.plan_amount ?? null, o.plan_setting ?? null,
      at, o.expires_at ?? null, o.spot ?? null,
    );

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
          spot: p?.spot ?? null,
          since: p?.since ?? user.created_at,
          expiresAt: p?.expires_at ?? null,
          plan: p?.plan_amount != null ? { weightKg: p.plan_weight ?? 0, amount: p.plan_amount, setting: p.plan_setting } : null,
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
      if (!p || p.state === "away") put(userId, "idle", now, { spot: "entrance" });
      return this.me(userId);
    },

    // Opening the gym again (a new tab, another device, tomorrow) starts you
    // at the entrance. Where you stood last time was live state, not history;
    // a set you'd started and never finished is dropped, not recorded.
    arrive(userId: string) {
      const now = clock();
      settle(userId, now);
      const p = presenceOf(userId);
      if (p && p.state !== "away") put(userId, "idle", now, { spot: "entrance" });
      return this.me(userId);
    },

    // Walk over to a machine to set it up. You're standing there, not using
    // it: nothing is held and nothing recorded until Start set.
    approach(userId: string, input: { machine?: unknown }) {
      const machine = typeof input.machine === "string" ? machineById.get(input.machine) : undefined;
      if (!machine) throw new InputError("That isn't a machine in this gym.");
      const now = clock();
      settle(userId, now);
      const p = inGym(userId);
      if (p.state === "training") throw new InputError("Finish or cancel the set you're on first.", 409);
      if (q.holder.get(machine.id, userId)) throw new InputError("Someone's on that machine.", 409);
      put(userId, "idle", now, { machine: machine.id });
      return this.me(userId);
    },

    // Start a set on a machine. Nothing is recorded yet: the set exists only
    // once it's finished.
    start(userId: string, input: { machine?: unknown; exercise?: unknown; weightKg?: unknown; amount?: unknown }) {
      const machine = typeof input.machine === "string" ? machineById.get(input.machine) : undefined;
      if (!machine) throw new InputError("That isn't a machine in this gym.");
      const ex = kindById.get(machine.kind)!.exercises.find((e) => e.name === input.exercise);
      if (!ex) throw new InputError(`That isn't something you do on the ${machine.name}.`);
      const { weight, amount, setting } = cleanPlan(ex, input);
      const now = clock();
      settle(userId, now);
      const p = inGym(userId);
      if (p.state === "training" && p.machine !== machine.id) throw new InputError("Finish or cancel the set you're on first.", 409);
      if (q.holder.get(machine.id, userId)) throw new InputError("Someone's on that machine.", 409);
      sessionFor(userId, now);
      const limit = SET_MS + (ex.metric === "time" ? amount * 60_000 : 0);
      put(userId, "training", now, {
        exercise: ex.name,
        machine: machine.id,
        plan_weight: weight,
        plan_amount: amount,
        plan_setting: setting,
        expires_at: now + limit,
      });
      return this.me(userId);
    },

    // Finish the set under way: this is when it's recorded, with what you
    // actually did if it differed from what you set out to do.
    finish(userId: string, input: { weightKg?: unknown; assistKg?: unknown; amount?: unknown; setting?: unknown } = {}) {
      const now = clock();
      settle(userId, now);
      const p = inGym(userId);
      if (p.state !== "training") {
        throw new InputError(
          "That set had already stopped, so it wasn't recorded. A set is dropped after 10 minutes without Finish, or when the gym is opened in another tab.",
          409,
        );
      }
      const ex = KINDS.flatMap((k) => k.exercises).find((e) => e.name === p.exercise)!;
      const planned = { weightKg: p.plan_weight, assistKg: p.plan_setting, amount: p.plan_amount, setting: p.plan_setting };
      const has = (k: keyof typeof input) => input[k] !== undefined;
      const done = cleanPlan(ex, {
        weightKg: has("weightKg") ? input.weightKg : planned.weightKg,
        assistKg: has("assistKg") ? input.assistKg : planned.assistKg,
        amount: has("amount") ? input.amount : planned.amount,
        setting: has("setting") ? input.setting : planned.setting,
      });
      const session = sessionFor(userId, now);
      q.insertSet.run(session, userId, ex.name, done.weight, done.amount, done.setting, now);
      put(userId, "resting", now, {
        exercise: ex.name,
        machine: p.machine,
        plan_weight: done.weight,
        plan_amount: done.amount,
        plan_setting: done.setting,
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
      put(userId, "idle", now, { spot: "lounge" });
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
          spot: r.spot,
          since: r.since,
        })),
      };
    },
  };
}

export type Gym = ReturnType<typeof createGym>;
