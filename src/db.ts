import { log } from "./log.ts";
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
  // Additive columns for databases created before them. role = 'start' marks
  // the trip's starting point: always the first activity of the first day.
  const activityCols = db.prepare("pragma table_info(activities)").all().map((c) => String(c.name));
  if (!activityCols.includes("role")) db.exec("alter table activities add column role text check (role in ('start'))");
  // which meal a food stop is for; null for everything else
  if (!activityCols.includes("meal")) db.exec("alter table activities add column meal text check (meal in ('breakfast', 'brunch', 'lunch', 'afternoon_tea', 'dinner'))");
  // the trip's usual meal times as JSON; null means the defaults in trips.ts
  const tripCols = db.prepare("pragma table_info(trips)").all().map((c) => String(c.name));
  if (!tripCols.includes("meal_times")) db.exec("alter table trips add column meal_times text");
  migrateDisplayNames(db);

  // An invitation from a trip's owner to one existing account, by user id.
  // It grants nothing until the invitee accepts. Only one can be pending per
  // person per trip; accepted, declined and cancelled ones are kept as a
  // record but never let anyone in again.
  db.exec(`
    create table if not exists trip_invitations (
      id          text primary key,
      trip_id     text not null references trips(id) on delete cascade,
      inviter_id  text not null references users(id) on delete cascade,
      invitee_id  text not null references users(id) on delete cascade,
      status      text not null check (status in ('pending', 'accepted', 'declined', 'cancelled')),
      created_at  integer not null,
      resolved_at integer
    );
    create unique index if not exists trip_invitations_one_pending on trip_invitations(trip_id, invitee_id) where status = 'pending';
    create index if not exists trip_invitations_by_invitee on trip_invitations(invitee_id, status);
  `);

  // Invite links (November 2026): only a hash of the token, a creation and an
  // expiry time (24 hours later, set by the server), and when it was revoked.
  // A link lets a signed-in person *ask* to join; the owner decides.
  db.exec(`
    create table if not exists trip_invite_links (
      id         text primary key,
      trip_id    text not null references trips(id) on delete cascade,
      token_hash text not null unique,
      created_by text not null references users(id) on delete cascade,
      created_at integer not null,
      expires_at integer not null,
      revoked_at integer
    );
    create index if not exists trip_invite_links_by_trip on trip_invite_links(trip_id);

    create table if not exists trip_join_requests (
      id          text primary key,
      trip_id     text not null references trips(id) on delete cascade,
      user_id     text not null references users(id) on delete cascade,
      link_id     text references trip_invite_links(id) on delete set null,
      status      text not null check (status in ('pending', 'approved', 'rejected')),
      created_at  integer not null,
      resolved_at integer,
      resolved_by text references users(id) on delete set null
    );
    create unique index if not exists trip_join_requests_one_pending on trip_join_requests(trip_id, user_id) where status = 'pending';
    create index if not exists trip_join_requests_by_user on trip_join_requests(user_id, status);

    -- A published trip: a snapshot taken when the owner publishes or
    -- republishes, never the live working trip. One per trip, so its id (and
    -- its reviews) stay stable across republishing and unpublishing.
    create table if not exists trip_publications (
      id                 text primary key,
      trip_id            text not null unique references trips(id) on delete cascade,
      author_id          text references users(id) on delete set null,
      title              text not null,
      description        text not null,
      destination        text not null,
      timezone           text not null,
      days               integer not null,
      cover              text,
      ref_lat            real,
      ref_lng            real,
      ref_cached_at      integer,
      status             text not null check (status in ('published', 'unpublished')),
      first_published_at integer not null,
      published_at       integer not null,
      trip_rev           integer not null
    );
    create index if not exists trip_publications_public on trip_publications(status, published_at);

    -- lat/lng follow the same rule as activities: Google coordinates are a
    -- temporary copy (cached_at), a custom point is the traveller's own.
    -- Notes are never published.
    create table if not exists publication_stops (
      id             text primary key,
      publication_id text not null references trip_publications(id) on delete cascade,
      day            integer not null,
      position       integer not null,
      title          text not null,
      kind           text not null,
      start_min      integer,
      duration_min   integer not null,
      meal           text,
      role           text,
      place_id       text,
      place_source   text,
      lat            real,
      lng            real,
      cached_at      integer
    );
    create index if not exists publication_stops_by_pub on publication_stops(publication_id, day, position);

    create table if not exists trip_reviews (
      id             text primary key,
      publication_id text not null references trip_publications(id) on delete cascade,
      user_id        text not null references users(id) on delete cascade,
      rating         integer not null check (rating between 1 and 5),
      comment        text not null default '',
      created_at     integer not null,
      updated_at     integer not null,
      unique (publication_id, user_id)
    );
  `);
  // where a trip was forked from: kept as text, so a fork outlives the
  // publication being unpublished or deleted
  const tripCols2 = db.prepare("pragma table_info(trips)").all().map((c) => String(c.name));
  for (const [col, type] of [["forked_from_publication_id", "text"], ["forked_from_title", "text"], ["forked_from_author", "text"], ["forked_at", "integer"], ["cover_key", "text"]]) {
    if (!tripCols2.includes(col)) db.exec(`alter table trips add column ${col} ${type}`);
  }
  // Legacy invite links (trips.invite_hash) never expired and joined people
  // without the owner's approval. They're switched off rather than carried
  // over: an owner who wants a link makes a new, expiring one.
  db.exec("update trips set invite_hash = null where invite_hash is not null");
  return db;
}

// The comparison key for a display name: Unicode-normalised (NFKC, so
// full-width and compatibility forms match their plain ones), trimmed, inner
// whitespace collapsed, and lower-cased by Unicode rules. Computed here, not
// by SQLite, whose NOCASE folds only ASCII. Chinese and other scripts without
// case keep their characters as typed.
export const displayNameKey = (s: string): string => s.normalize("NFKC").trim().replace(/\s+/gu, " ").toLocaleLowerCase("und");

// Display names became unique in October 2026. Existing accounts get their
// comparison key filled in; the unique index is created only if no two keys
// already collide. Nobody is renamed, merged or deleted here: on a collision
// the index waits, the colliding accounts keep a null key, and the server
// still refuses new duplicates in code (auth.ts) until someone resolves them.
export function migrateDisplayNames(db: DatabaseSync): { collisions: number } {
  const cols = db.prepare("pragma table_info(users)").all().map((c) => String(c.name));
  if (!cols.includes("display_name_key")) db.exec("alter table users add column display_name_key text");
  const hasIndex = db.prepare("select 1 from sqlite_master where type = 'index' and name = 'users_display_name_key'").get();
  if (hasIndex) return { collisions: 0 };
  const rows = db.prepare("select id, display_name from users").all();
  const byKey = new Map<string, string[]>();
  for (const r of rows) {
    const k = displayNameKey(String(r.display_name));
    byKey.set(k, [...(byKey.get(k) ?? []), String(r.id)]);
  }
  const colliding = [...byKey.values()].filter((ids) => ids.length > 1);
  const blocked = new Set(colliding.flat());
  transaction(db, () => {
    const set = db.prepare("update users set display_name_key = ? where id = ?");
    for (const [k, ids] of byKey) for (const id of ids) set.run(blocked.has(id) ? null : k, id);
  });
  if (colliding.length === 0) {
    db.exec("create unique index users_display_name_key on users(display_name_key)");
  } else {
    // counts only: names are personal data and stay out of the log
    log.warn("DB_DISPLAY_NAME_COLLISIONS", { action: "migrate", status: "failure", errorCode: "DATA_COLLISION", groups: colliding.length, accounts: blocked.size, message: "Some accounts already share a display name; the unique index is waiting until they're resolved (see docs/unique-names.md)" });
  }
  return { collisions: colliding.length };
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
