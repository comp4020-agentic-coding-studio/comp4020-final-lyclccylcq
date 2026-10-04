import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

// Everything the gym remembers lives in one SQLite file. In production that's
// on the Fly volume at /data, the only storage that survives a restart or a
// redeploy; locally it's ./data (gitignored).
export function openDb(dir = process.env.DATA_DIR ?? "data"): DatabaseSync {
  mkdirSync(dir, { recursive: true });
  const db = new DatabaseSync(join(dir, "gym.db"));
  db.exec(`
    pragma journal_mode = wal;
    pragma foreign_keys = on;

    -- a lightweight identity: the display name is just a label, the opaque id
    -- is who you are, and the pass is the secret that lets a browser be you
    create table if not exists users (
      id         text primary key,
      pass       text not null unique,
      name       text not null,
      colour     text not null,
      created_at integer not null
    );

    -- one visit to the gym, from walking in to leaving
    create table if not exists sessions (
      id         integer primary key,
      user_id    text not null references users(id),
      started_at integer not null,
      ended_at   integer
    );

    create table if not exists sets (
      id         integer primary key,
      session_id integer not null references sessions(id),
      user_id    text not null references users(id),
      exercise   text not null,
      weight_kg  real not null,
      amount     integer not null, -- reps, or minutes for timed work
      done_at    integer not null
    );
    create index if not exists sets_by_user on sets(user_id, id);

    -- each person's locker: kept, like visits and sets
    create table if not exists lockers (
      number      integer primary key,
      user_id     text not null unique references users(id),
      assigned_at integer not null
    );

    -- The only live table. Where each person is and what they're doing right
    -- now: one row per user, rewritten on every change and expired when it
    -- goes stale, so it's also the shape a live broadcast will send. Nothing
    -- in it is history; history is sessions and sets.
    create table if not exists presence (
      user_id  text primary key references users(id),
      state    text not null check (state in ('idle', 'training', 'resting', 'away')),
      exercise text,
      since    integer not null
    );
  `);

  // Added when sets gained a start and a finish: which machine someone is on,
  // the set they've started (weight, reps or minutes), and when an unfinished
  // set or a rest stops holding the machine.
  const have = new Set((db.prepare("pragma table_info(presence)").all() as { name: string }[]).map((c) => c.name));
  for (const [name, type] of [["machine", "text"], ["plan_weight", "real"], ["plan_amount", "integer"], ["expires_at", "integer"]]) {
    if (!have.has(name)) db.exec(`alter table presence add column ${name} ${type}`);
  }
  // rows from before machines existed say what someone did, not where: they
  // become someone standing about, which is the honest reading
  db.exec(`update presence set state = 'idle', exercise = null where state in ('training', 'resting') and machine is null`);
  return db;
}
