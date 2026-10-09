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

    -- Itineraries people can discover and copy into a trip. V1 holds only
    -- Wayline's curated samples (source 'curated', no author). The columns
    -- for authorship and visibility are there so user-published itineraries
    -- can live in the same table later.
    create table if not exists itinerary_templates (
      id              text primary key,
      title           text not null,
      destination     text not null,
      description     text not null,
      timezone        text not null,
      ref_lat         real not null,
      ref_lng         real not null,
      days            integer not null default 1,
      categories      text not null,
      source          text not null check (source in ('curated', 'user')),
      author_id       text references users(id) on delete set null,
      visibility      text not null default 'public' check (visibility in ('public', 'unlisted', 'private', 'draft')),
      featured        integer not null default 0,
      content_version integer not null default 1,
      created_at      integer not null,
      updated_at      integer not null
    );
    create index if not exists itinerary_templates_public on itinerary_templates(visibility, featured);

    -- An ordered stop. lat/lng are the template author's own approximate
    -- location, not Google content. place_id is filled in only when Google
    -- returns a match for place_query near those coordinates.
    create table if not exists itinerary_template_stops (
      id               text primary key,
      template_id      text not null references itinerary_templates(id) on delete cascade,
      day              integer not null default 1,
      position         integer not null,
      title            text not null,
      kind             text not null,
      start_min        integer,
      duration_min     integer not null,
      note             text not null default '',
      lat              real not null,
      lng              real not null,
      place_query      text,
      place_id         text,
      place_checked_at integer,
      unique (template_id, day, position)
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
