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

    -- where each person is on the floor right now: one row per user, rewritten
    -- on every change, so it's also the shape a live broadcast will send
    create table if not exists presence (
      user_id     text primary key references users(id),
      state       text not null check (state in ('idle', 'training', 'resting', 'away')),
      exercise    text,
      since       integer not null,
      last_set_id integer references sets(id)
    );
  `);
  return db;
}
