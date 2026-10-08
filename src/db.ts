import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

// Everything Wayline keeps lives in one SQLite file. In production that's on
// the Fly volume at /data, the only storage that survives a restart or a
// redeploy; locally it's ./data (gitignored).
//
// Wayline uses its own file, wayline.db. The Virtual Gym's gym.db is left
// exactly as it was in the same directory: nothing is migrated out of it or
// deleted, so it doubles as the backup of the old product's data.
export function openDb(dir = process.env.DATA_DIR ?? "data"): DatabaseSync {
  mkdirSync(dir, { recursive: true });
  const db = new DatabaseSync(join(dir, "wayline.db"));
  db.exec(`
    pragma journal_mode = wal;
    pragma foreign_keys = on;
    pragma busy_timeout = 3000;

    create table if not exists users (
      id            text primary key,
      username      text not null unique collate nocase,
      display_name  text not null,
      password_hash text not null,
      created_at    integer not null
    );

    -- only a hash of the cookie token is stored, so a copied database can't
    -- be used to sign in as anyone
    create table if not exists auth_sessions (
      token_hash text primary key,
      user_id    text not null references users(id) on delete cascade,
      created_at integer not null,
      expires_at integer not null
    );
    create index if not exists auth_sessions_by_user on auth_sessions(user_id);

    create table if not exists trips (
      id             text primary key,
      owner_id       text not null references users(id),
      title          text not null,
      destination    text not null,
      start_date     text not null,
      end_date       text not null,
      timezone       text not null,
      dest_place_id  text,
      dest_lat       real,
      dest_lng       real,
      dest_cached_at integer,
      invite_hash    text unique,
      rev            integer not null default 1,
      created_at     integer not null,
      updated_at     integer not null
    );

    create table if not exists trip_members (
      trip_id   text not null references trips(id) on delete cascade,
      user_id   text not null references users(id) on delete cascade,
      role      text not null check (role in ('owner', 'collaborator')),
      joined_at integer not null,
      primary key (trip_id, user_id)
    );
    create index if not exists trip_members_by_user on trip_members(user_id);

    create table if not exists trip_days (
      id      text primary key,
      trip_id text not null references trips(id) on delete cascade,
      date    text not null,
      unique (trip_id, date)
    );

    -- What the user chose to do. place_id is a stable Google place id (kept
    -- indefinitely, as Google allows); lat/lng are a temporary copy with the
    -- time they were fetched, refreshed after 30 days. Address, hours and
    -- the rest of a place's details are never stored: they're fetched live.
    create table if not exists activities (
      id              text primary key,
      trip_id         text not null references trips(id) on delete cascade,
      day_id          text not null references trip_days(id) on delete cascade,
      client_id       text not null,
      position        integer not null,
      title           text not null,
      kind            text not null check (kind in ('attraction', 'food', 'shopping', 'accommodation', 'custom')),
      start_min       integer,
      duration_min    integer not null,
      notes           text not null default '',
      place_id        text,
      place_source    text,
      lat             real,
      lng             real,
      place_cached_at integer,
      version         integer not null default 1,
      created_by      text references users(id) on delete set null,
      updated_by      text references users(id) on delete set null,
      updated_at      integer not null,
      unique (trip_id, client_id)
    );
    create index if not exists activities_by_day on activities(day_id, position);

    -- The connection between two consecutive activities. options is the
    -- route data Google returned for each mode (a temporary copy, dropped
    -- after 30 days or when the pair stops being consecutive); selected_mode
    -- is the user's choice. depart_key records the departure the options
    -- were computed for, so a changed time marks them stale.
    create table if not exists transport_segments (
      id               text primary key,
      trip_id          text not null references trips(id) on delete cascade,
      from_activity_id text not null references activities(id) on delete cascade,
      to_activity_id   text not null references activities(id) on delete cascade,
      depart_key       text not null,
      options          text not null,
      selected_mode    text,
      computed_at      integer not null,
      computed_by      text references users(id) on delete set null,
      unique (from_activity_id, to_activity_id)
    );
  `);
  return db;
}

// Runs fn inside one write transaction: either every statement lands or none do.
export function transaction<T>(db: DatabaseSync, fn: () => T): T {
  db.exec("begin immediate");
  try {
    const out = fn();
    db.exec("commit");
    return out;
  } catch (err) {
    db.exec("rollback");
    throw err;
  }
}
