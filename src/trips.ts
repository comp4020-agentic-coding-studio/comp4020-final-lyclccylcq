import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { newToken, sha256 } from "./auth.ts";
import { DESTINATIONS } from "./curated.ts";
import { displayNameKey, transaction } from "./db.ts";
import { haversineKm } from "./geo.ts";
import { bad, HttpError, notFound } from "./errors.ts";
import { type Action, authorize, authorizeActivity, type Role } from "./permissions.ts";
import { type DayReview, reviewDay } from "./review.ts";
import type { TemplateDetail } from "./itineraries.ts";
import {
  analyseDay,
  fingerprint,
  type DayActivity,
  type DayAnalysis,
  type DaySegment,
  defaultMode,
  hhmm,
  MAX_DAY_MIN,
  MIN_DURATION,
  type Mode,
  MODES,
  type RouteOption,
} from "./schedule.ts";

export const KINDS = ["attraction", "food", "shopping", "accommodation", "custom"] as const;
export type Kind = (typeof KINDS)[number];
export type { Role };
export const MEALS = ["breakfast", "brunch", "lunch", "afternoon_tea", "dinner"] as const;
export type Meal = (typeof MEALS)[number];
export type MealTimes = Record<Meal, { from: number; to: number; usual: number }>;
// Suggestions only, in minutes after midnight; each trip's owner can change them.
export const DEFAULT_MEAL_TIMES: MealTimes = {
  breakfast: { from: 7 * 60, to: 10 * 60, usual: 8 * 60 },
  brunch: { from: 10 * 60, to: 12 * 60, usual: 10 * 60 + 30 },
  lunch: { from: 11 * 60 + 30, to: 14 * 60, usual: 12 * 60 },
  afternoon_tea: { from: 14 * 60, to: 17 * 60, usual: 15 * 60 },
  dinner: { from: 17 * 60 + 30, to: 21 * 60, usual: 18 * 60 + 30 },
};

const MAX_DAYS = 30;
const CACHE_MS = 30 * 86_400_000; // how long a copy of Google coordinates or route data is kept

export type Activity = {
  id: string;
  dayId: string;
  position: number;
  title: string;
  kind: Kind;
  startMin: number | null;
  durationMin: number;
  notes: string;
  place: { placeId: string; source: string; lat: number | null; lng: number | null } | null;
  role: "start" | null;
  meal: Meal | null;
  version: number;
  createdBy: string | null;
  updatedBy: string | null;
  updatedAt: number;
};

export type Segment = {
  id: string;
  fromId: string;
  toId: string;
  options: RouteOption[];
  selectedMode: Mode | null;
  computedAt: number;
  departKey: string;
  stale: boolean;
};

// fingerprint: what the day's analysis (and a copilot answer about it)
// depends on. Proposals are applied only against the fingerprint they were
// previewed with.
export type Day = { id: string; date: string; activities: Activity[]; segments: Segment[]; analysis: DayAnalysis; review: DayReview; fingerprint: string };

export type TripSnapshot = {
  id: string;
  title: string;
  destination: string;
  startDate: string;
  endDate: string;
  timezone: string;
  center: { lat: number; lng: number } | null;
  rev: number;
  updatedAt: number;
  hasInvite: boolean;
  pendingRequests: number;
  forkedFrom: { publicationId: string; title: string; author: string | null; at: number } | null;
  publication: { id: string; status: "published" | "unpublished"; publishedAt: number; outdated: boolean } | null;
  members: { id: string; displayName: string; role: Role }[];
  mealTimes: MealTimes;
  days: Day[];
};

type Row = Record<string, unknown>;

export const INVITE_TTL_MS = 24 * 60 * 60 * 1000;
export type AppliedChange =
  | { type: "move"; activityId: string; toIndex: number }
  | { type: "mode"; segmentId: string; to: Mode }
  | { type: "add"; clientId: string; title: string; kind: string; startMin: number | null; durationMin: number; meal: string | null; notes: string; place: unknown };
export type ForkStop = {
  day: number;
  position: number;
  title: string;
  kind: string;
  startMin: number | null;
  durationMin: number;
  meal: string | null;
  role: string | null;
  placeId: string | null;
  placeSource: string | null;
  lat: number | null;
  lng: number | null;
  cachedAt: number | null;
};
export type InviteLink = { id: string; createdAt: number; expiresAt: number; expired: boolean };

// --- input validation (the server's checks are the real ones) ----------------

const text = (v: unknown, field: string, max: number, min = 1): string => {
  if (typeof v !== "string") throw bad(`${field} is required.`);
  const s = v.trim();
  if (s.length < min) throw bad(`${field} is required.`);
  if (s.length > max) throw bad(`${field} is too long (max ${max} characters).`);
  return s;
};

const isDate = (s: unknown): s is string =>
  typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(`${s}T00:00:00Z`)) &&
  new Date(`${s}T00:00:00Z`).toISOString().startsWith(s);

function datesBetween(start: string, end: string): string[] {
  const out: string[] = [];
  for (let t = Date.parse(`${start}T00:00:00Z`); t <= Date.parse(`${end}T00:00:00Z`); t += 86_400_000) {
    out.push(new Date(t).toISOString().slice(0, 10));
  }
  return out;
}

function validTimeZone(tz: unknown): string {
  if (typeof tz !== "string" || tz.length > 64) throw bad("Choose a time zone.");
  try {
    new Intl.DateTimeFormat("en", { timeZone: tz });
  } catch {
    throw bad("That time zone isn't recognised.");
  }
  return tz;
}

function dateRange(start: unknown, end: unknown): { startDate: string; endDate: string } {
  if (!isDate(start) || !isDate(end)) throw bad("Dates must be real dates (YYYY-MM-DD).");
  if (end < start) throw bad("The trip can't end before it starts.");
  if (datesBetween(start, end).length > MAX_DAYS) throw bad(`Trips can be up to ${MAX_DAYS} days long.`);
  return { startDate: start, endDate: end };
}

const startMinute = (v: unknown): number | null => {
  if (v === null) return null;
  if (!Number.isInteger(v) || (v as number) < 0 || (v as number) >= MAX_DAY_MIN) throw bad("Start time must be between 00:00 and 23:59.");
  return v as number;
};

const duration = (v: unknown): number => {
  if (!Number.isInteger(v) || (v as number) < MIN_DURATION || (v as number) > MAX_DAY_MIN) {
    throw bad(`Duration must be between ${MIN_DURATION} minutes and 24 hours.`);
  }
  return v as number;
};

const meal = (v: unknown): Meal | null => {
  if (v === null || v === undefined || v === "") return null;
  if (!MEALS.includes(v as Meal)) throw bad(`Meal must be one of: ${MEALS.join(", ")}.`);
  return v as Meal;
};

function mealTimesInput(v: unknown): MealTimes {
  if (!v || typeof v !== "object") throw bad("Meal times must list every meal.");
  const out = {} as MealTimes;
  for (const m of MEALS) {
    const t = (v as Row)[m] as Row | undefined;
    const [from, to, usual] = [t?.from, t?.to, t?.usual];
    const ok = [from, to, usual].every((x) => Number.isInteger(x) && (x as number) >= 0 && (x as number) < MAX_DAY_MIN);
    if (!ok || !((from as number) <= (usual as number) && (usual as number) < (to as number))) {
      throw bad(`${m.replace("_", " ")}: the usual time must sit inside its range.`);
    }
    out[m] = { from: from as number, to: to as number, usual: usual as number };
  }
  return out;
}

const kind = (v: unknown): Kind => {
  if (!KINDS.includes(v as Kind)) throw bad(`Activity type must be one of: ${KINDS.join(", ")}.`);
  return v as Kind;
};

function placeInput(v: unknown): { placeId: string; source: string; lat: number; lng: number } | null {
  if (v === null || v === undefined) return null;
  if (typeof v !== "object") throw bad("Invalid place.");
  const p = v as Row;
  const placeId = text(p.placeId, "Place id", 300);
  // demo: Wayline's fixtures; curated: a template stop with no verified
  // Google id (tpl: prefix); custom: a point someone picked on the map, with
  // no Google id (custom: prefix); google: a real place id. google and
  // custom can be routed.
  const source = p.source === "demo" ? "demo" : p.source === "curated" ? "curated" : p.source === "custom" ? "custom" : "google";
  const PREFIXES = { demo: "demo:", curated: "tpl:", custom: "custom:" } as Record<string, string>;
  const prefix = PREFIXES[source] ?? null;
  if (prefix ? !placeId.startsWith(prefix) : Object.values(PREFIXES).some((x) => placeId.startsWith(x))) throw bad("Invalid place.");
  if (source === "custom" && !/^custom:[A-Za-z0-9_-]{8,64}$/.test(placeId)) throw bad("Invalid place.");
  const lat = Number(p.lat);
  const lng = Number(p.lng);
  if (!(Math.abs(lat) <= 90) || !(Math.abs(lng) <= 180)) throw bad("Invalid place coordinates.");
  return { placeId, source, lat, lng };
}

// --- the store ---------------------------------------------------------------

// onInvitation(userId): that person's pending invitations changed; tell their
// open pages. It carries no trip data, so it grants nothing.
export function createTripStore(db: DatabaseSync, now = () => Date.now(), onChange: (tripId: string) => void = () => {}, onInvitation: (userId: string) => void = () => {}) {
  const q = (sql: string) => db.prepare(sql);
  // Legacy nickname collisions deliberately have no stored key. Compute
  // the same Unicode key for those accounts without changing their data.
  db.function("wayline_nickname_key", { deterministic: true }, (name) => displayNameKey(String(name ?? "")));

  function roleOf(tripId: string, userId: string): Role | null {
    const row = q("select role from trip_members where trip_id = ? and user_id = ?").get(tripId, userId);
    return row ? (row.role as Role) : null;
  }

  // Non-members get the same 404 as a trip that doesn't exist, so an id
  // reveals nothing on its own.
  // every role check goes through permissions.ts
  const require = (tripId: string, userId: string, action: Action): Role => authorize(typeof tripId === "string" ? roleOf(tripId, userId) : null, action);
  const requireMember = (tripId: string, userId: string): Role => require(tripId, userId, "view");
  const requireActivity = (tripId: string, userId: string, a: Activity): void => void authorizeActivity(roleOf(tripId, userId), userId, a.createdBy);

  // The trip's current (unrevoked, unexpired) link, if any.
  const liveLink = (tripId: string) => q("select id from trip_invite_links where trip_id = ? and revoked_at is null and expires_at > ?").get(tripId, now());

  // A link by its token: unknown and revoked links look the same (404).
  // Expired ones are found, so the page can say "expired" rather than "invalid".
  function linkFor(token: unknown): { id: string; tripId: string; expiresAt: number } {
    if (typeof token !== "string" || token.length < 20 || token.length > 100) throw notFound("This invite link isn't valid. Ask the trip's owner for a new one.");
    const r = q("select id, trip_id, expires_at from trip_invite_links where token_hash = ? and revoked_at is null").get(sha256(token));
    if (!r) throw notFound("This invite link isn't valid any more. Ask the trip's owner for a new one.");
    return { id: String(r.id), tripId: String(r.trip_id), expiresAt: Number(r.expires_at) };
  }

  // Whether the trip has a publication, and whether the plan has changed
  // since it was last published (so the owner can republish on purpose).
  function publicationOf(tripId: string, rev: number) {
    const r = q("select id, status, published_at, trip_rev from trip_publications where trip_id = ?").get(tripId);
    if (!r) return null;
    return { id: String(r.id), status: r.status as "published" | "unpublished", publishedAt: Number(r.published_at), outdated: Number(r.trip_rev) !== rev };
  }

  const toActivity = (r: Row): Activity => {
    // a custom point is the travellers' own choice, not Google content, so it never expires
    const fresh = r.place_source === "custom" || (r.place_cached_at !== null && now() - Number(r.place_cached_at) < CACHE_MS);
    return {
      id: String(r.id),
      dayId: String(r.day_id),
      position: Number(r.position),
      title: String(r.title),
      kind: r.kind as Kind,
      startMin: r.start_min === null ? null : Number(r.start_min),
      durationMin: Number(r.duration_min),
      notes: String(r.notes),
      place: r.place_id
        ? {
            placeId: String(r.place_id),
            source: String(r.place_source),
            lat: fresh ? Number(r.lat) : null,
            lng: fresh ? Number(r.lng) : null,
          }
        : null,
      role: r.role === "start" ? "start" : null,
      meal: (r.meal as Meal | null) ?? null,
      version: Number(r.version),
      createdBy: r.created_by === null ? null : String(r.created_by),
      updatedBy: r.updated_by === null ? null : String(r.updated_by),
      updatedAt: Number(r.updated_at),
    };
  };

  // The departure a route between two consecutive activities depends on:
  // the date and the earlier activity's end time. Transit is computed for it,
  // and a changed time marks the stored options stale.
  function departKey(date: string, prev: { startMin: number | null; durationMin: number }, tz: string): string {
    return prev.startMin === null ? `${date}|untimed|${tz}` : `${date}T${hhmm(prev.startMin + prev.durationMin)}|${tz}`;
  }

  function dayActivities(dayId: string): Activity[] {
    return q("select * from activities where day_id = ? order by position, id").all(dayId).map(toActivity);
  }

  const startsDay = (dayId: string): boolean => Boolean(q("select 1 from activities where day_id = ? and role = 'start'").get(dayId));

  function renumber(dayId: string): void {
    const ids = q("select id from activities where day_id = ? order by position, id").all(dayId);
    const set = q("update activities set position = ? where id = ?");
    ids.forEach((r, i) => set.run(i, String(r.id)));
  }

  // A segment only means something between two activities that are next to
  // each other on the same day; anything else is dropped, as is any route
  // copy older than 30 days.
  function pruneSegments(tripId: string): void {
    const keep = new Set<string>();
    for (const day of q("select id from trip_days where trip_id = ?").all(tripId)) {
      const acts = dayActivities(String(day.id));
      for (let i = 0; i + 1 < acts.length; i++) keep.add(`${acts[i].id}>${acts[i + 1].id}`);
    }
    for (const s of q("select id, from_activity_id, to_activity_id, computed_at from transport_segments where trip_id = ?").all(tripId)) {
      const pair = `${s.from_activity_id}>${s.to_activity_id}`;
      if (!keep.has(pair) || now() - Number(s.computed_at) >= CACHE_MS) {
        q("delete from transport_segments where id = ?").run(String(s.id));
      }
    }
  }

  // A day's order follows the plan's times: the starting point first, then
  // every timed stop by its time, then the untimed stops in the order people
  // put them. Equal times keep their existing order (so the one added first
  // stays first), which makes the result deterministic. Only positions move;
  // no stop is replaced or recreated.
  function orderDay(dayId: string): void {
    const rows = q("select id, role, start_min from activities where day_id = ? order by position, id").all(dayId);
    const start = rows.filter((r) => r.role === "start");
    const timed = rows.filter((r) => r.role !== "start" && r.start_min !== null).sort((a, b) => Number(a.start_min) - Number(b.start_min));
    const untimed = rows.filter((r) => r.role !== "start" && r.start_min === null);
    const set = q("update activities set position = ? where id = ?");
    [...start, ...timed, ...untimed].forEach((r, i) => set.run(i, String(r.id)));
  }

  function orderTrip(tripId: string): void {
    for (const d of q("select id from trip_days where trip_id = ?").all(tripId)) orderDay(String(d.id));
  }

  // Every change to a trip goes through here: one transaction, the days put
  // in time order, the trip's revision bumped, segments between stops that are
  // no longer neighbours pruned, then (after commit) the change is announced
  // so live sessions get the new snapshot.
  let mutating: string | null = null; // the trip a change is in progress for
  function mutate<T>(tripId: string, userId: string, fn: () => T): T {
    const out = transaction(db, () => {
      mutating = tripId;
      let result: T;
      try {
        result = fn();
      } finally {
        mutating = null;
      }
      orderTrip(tripId);
      pruneSegments(tripId);
      q("update trips set rev = rev + 1, updated_at = ? where id = ?").run(now(), tripId);
      return result;
    });
    onChange(tripId);
    return out;
  }

  function getActivity(tripId: string, activityId: unknown): Activity {
    const row = typeof activityId === "string" ? q("select * from activities where id = ? and trip_id = ?").get(activityId, tripId) : undefined;
    if (!row) throw notFound("That activity no longer exists. Someone may have removed it.");
    return toActivity(row);
  }

  function getDay(tripId: string, dayId: unknown): { id: string; date: string } {
    const row = typeof dayId === "string" ? q("select id, date from trip_days where id = ? and trip_id = ?").get(dayId, tripId) : undefined;
    if (!row) throw notFound("That day isn't part of this trip.");
    return { id: String(row.id), date: String(row.date) };
  }

  function snapshot(tripId: string): TripSnapshot {
    // built during a change: order the days first, so the answer the person
    // gets already shows where the changed stop now sits
    if (mutating === tripId) {
      orderTrip(tripId);
      pruneSegments(tripId);
    }
    const t = q("select * from trips where id = ?").get(tripId);
    if (!t) throw notFound("Trip not found.");
    const tz = String(t.timezone);
    const members = q(
      "select u.id, u.display_name, m.role from trip_members m join users u on u.id = m.user_id where m.trip_id = ? order by m.role desc, m.joined_at",
    )
      .all(tripId)
      .map((r) => ({ id: String(r.id), displayName: String(r.display_name), role: r.role as Role }));

    const segRows = q("select * from transport_segments where trip_id = ?").all(tripId);
    const mealTimes = t.meal_times ? (JSON.parse(String(t.meal_times)) as MealTimes) : DEFAULT_MEAL_TIMES;
    const days: Day[] = q("select id, date from trip_days where trip_id = ? order by date").all(tripId).map((d) => {
      const date = String(d.date);
      const activities = dayActivities(String(d.id));
      const segments: Segment[] = [];
      for (let i = 0; i + 1 < activities.length; i++) {
        const r = segRows.find((s) => s.from_activity_id === activities[i].id && s.to_activity_id === activities[i + 1].id);
        if (!r || now() - Number(r.computed_at) >= CACHE_MS) continue;
        segments.push({
          id: String(r.id),
          fromId: String(r.from_activity_id),
          toId: String(r.to_activity_id),
          options: JSON.parse(String(r.options)) as RouteOption[],
          selectedMode: (r.selected_mode as Mode | null) ?? null,
          computedAt: Number(r.computed_at),
          departKey: String(r.depart_key),
          stale: String(r.depart_key) !== departKey(date, activities[i], tz),
        });
      }
      const plain: DayActivity[] = activities.map((a) => ({
        id: a.id,
        title: a.title,
        startMin: a.startMin,
        durationMin: a.durationMin,
        placeId: a.place?.placeId ?? null,
      }));
      const segs: DaySegment[] = segments.map((s) => ({ ...s }));
      const fp = fingerprint({
        a: activities.map((a) => [a.id, a.title, a.kind, a.startMin, a.durationMin, a.notes, a.meal, a.role, a.place?.placeId ?? null, a.version]),
        s: segments.map((s) => [s.id, s.fromId, s.toId, s.selectedMode, s.stale, s.departKey, s.computedAt]),
      });
      const review = reviewDay(
        activities.map((a) => ({ id: a.id, title: a.title, kind: a.kind, role: a.role, meal: a.meal, startMin: a.startMin, durationMin: a.durationMin, hasPlace: a.place !== null })),
        segments,
        mealTimes,
      );
      return { id: String(d.id), date, activities, segments, analysis: analyseDay(plain, segs), review, fingerprint: fp };
    });

    const fresh = t.dest_cached_at !== null && now() - Number(t.dest_cached_at) < CACHE_MS;
    return {
      id: String(t.id),
      title: String(t.title),
      destination: String(t.destination),
      startDate: String(t.start_date),
      endDate: String(t.end_date),
      timezone: tz,
      center: fresh && t.dest_lat !== null ? { lat: Number(t.dest_lat), lng: Number(t.dest_lng) } : null,
      rev: Number(t.rev),
      updatedAt: Number(t.updated_at),
      hasInvite: Boolean(liveLink(tripId)),
      pendingRequests: Number((q("select count(*) as n from trip_join_requests where trip_id = ? and status = 'pending'").get(tripId) as Row).n),
      forkedFrom: t.forked_from_publication_id
        ? { publicationId: String(t.forked_from_publication_id), title: String(t.forked_from_title), author: t.forked_from_author === null ? null : String(t.forked_from_author), at: Number(t.forked_at) }
        : null,
      publication: publicationOf(tripId, Number(t.rev)),
      members,
      mealTimes,
      days,
    };
  }

  // Trips saved before stops followed their times are put in time order once,
  // at startup, exactly as the next edit would; routes between stops that
  // stop being neighbours are dropped as usual. Nothing else changes.
  for (const t of q("select id from trips").all()) {
    transaction(db, () => {
      orderTrip(String(t.id));
      pruneSegments(String(t.id));
    });
  }

  // Which photo a trip card shows, as a key into public/photos.js (no Google
  // request): the curated itinerary it was copied from, else the curated city
  // nearest its destination or first stop (within 100 km, using only
  // coordinates still allowed to be kept), else none and the card keeps its
  // colour band.
  function coverFor(t: Row): string | null {
    if (t.cover_key) return String(t.cover_key); // a fork keeps its template's photo
    const placeId = t.dest_place_id === null ? "" : String(t.dest_place_id);
    if (placeId.startsWith("tpl:")) return placeId.slice(4);
    const fresh = t.dest_cached_at !== null && now() - Number(t.dest_cached_at) < CACHE_MS && t.dest_lat !== null;
    let at = fresh ? { lat: Number(t.dest_lat), lng: Number(t.dest_lng) } : null;
    if (!at) {
      const s = q(
        `select a.lat, a.lng from activities a join trip_days d on d.id = a.day_id
          where a.trip_id = ? and a.lat is not null and (a.place_source = 'custom' or a.place_cached_at > ?)
          order by d.date, a.position limit 1`,
      ).get(String(t.id), now() - CACHE_MS);
      if (s) at = { lat: Number(s.lat), lng: Number(s.lng) };
    }
    if (!at) return null;
    const near = DESTINATIONS.map((d) => ({ id: d.id, km: haversineKm(d, at) })).sort((a, b) => a.km - b.km)[0];
    return near && near.km <= 100 ? `dest-${near.id}` : null;
  }

  const store = {
    roleOf,
    requireMember,
    require,
    snapshot,

    view(userId: string, tripId: string): TripSnapshot {
      requireMember(tripId, userId);
      return snapshot(tripId);
    },

    list(userId: string) {
      const rows = q(
        `select t.id, t.title, t.destination, t.start_date, t.end_date, t.updated_at, m.role,
                t.dest_place_id, t.dest_lat, t.dest_lng, t.dest_cached_at, t.cover_key, t.forked_from_author,
                o.display_name as owner_name,
                (select count(*) from trip_members x where x.trip_id = t.id) as people
           from trip_members m join trips t on t.id = m.trip_id join users o on o.id = t.owner_id
          where m.user_id = ? order by t.updated_at desc`,
      ).all(userId);
      const trips = rows.map((r) => ({
        id: String(r.id),
        title: String(r.title),
        destination: String(r.destination),
        startDate: String(r.start_date),
        endDate: String(r.end_date),
        updatedAt: Number(r.updated_at),
        role: r.role as Role,
        ownerName: String(r.owner_name),
        people: Number(r.people),
        cover: coverFor(r),
        basedOn: r.forked_from_author === undefined || r.forked_from_author === null ? null : String(r.forked_from_author),
      }));
      return { owned: trips.filter((t) => t.role === "owner"), shared: trips.filter((t) => t.role !== "owner") };
    },

    create(userId: string, input: Row): TripSnapshot {
      const title = text(input.title, "Trip name", 80);
      const destination = text(input.destination, "Destination", 120);
      const { startDate, endDate } = dateRange(input.startDate, input.endDate);
      const timezone = validTimeZone(input.timezone);
      const id = randomUUID();
      transaction(db, () => {
        const t = now();
        q(
          "insert into trips (id, owner_id, title, destination, start_date, end_date, timezone, created_at, updated_at) values (?, ?, ?, ?, ?, ?, ?, ?, ?)",
        ).run(id, userId, title, destination, startDate, endDate, timezone, t, t);
        q("insert into trip_members (trip_id, user_id, role, joined_at) values (?, ?, 'owner', ?)").run(id, userId, t);
        for (const date of datesBetween(startDate, endDate)) {
          q("insert into trip_days (id, trip_id, date) values (?, ?, ?)").run(randomUUID(), id, date);
        }
      });
      return snapshot(id);
    },

    // A new trip, owned by the user, holding a copy of an itinerary's stops:
    // one trip day per template day, starting on startDate. Stops keep their
    // suggested times; nothing links back, so the copy is the user's to edit.
    createFromTemplate(userId: string, tpl: TemplateDetail, input: Row): TripSnapshot {
      if (!isDate(input.startDate)) throw bad("Choose a start date (YYYY-MM-DD).");
      const startDate = input.startDate;
      const dates = datesBetween(startDate, new Date(Date.parse(`${startDate}T00:00:00Z`) + (tpl.days - 1) * 86_400_000).toISOString().slice(0, 10));
      const id = randomUUID();
      transaction(db, () => {
        const t = now();
        q(
          "insert into trips (id, owner_id, title, destination, start_date, end_date, timezone, dest_place_id, dest_lat, dest_lng, dest_cached_at, created_at, updated_at) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        ).run(id, userId, tpl.title, tpl.destination, startDate, dates[dates.length - 1], tpl.timezone, `tpl:${tpl.id}`, tpl.ref.lat, tpl.ref.lng, t, t, t);
        q("insert into trip_members (trip_id, user_id, role, joined_at) values (?, ?, 'owner', ?)").run(id, userId, t);
        const dayIds = dates.map((date) => {
          const dayId = randomUUID();
          q("insert into trip_days (id, trip_id, date) values (?, ?, ?)").run(dayId, id, date);
          return dayId;
        });
        const ins = q(
          `insert into activities (id, trip_id, day_id, client_id, position, title, kind, start_min, duration_min, notes,
                                   place_id, place_source, lat, lng, place_cached_at, created_by, updated_by, updated_at)
           values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        );
        for (const s of tpl.stops) {
          ins.run(
            randomUUID(), id, dayIds[s.day - 1], `tpl:${s.id}`, s.position, s.title, KINDS.includes(s.kind as Kind) ? s.kind : "custom",
            s.startMin, s.durationMin, s.note,
            s.placeId ?? `tpl:${s.id}`, s.placeId ? "google" : "curated", s.lat, s.lng, t,
            userId, userId, t,
          );
        }
      });
      return snapshot(id);
    },

    setCenter(tripId: string, center: { placeId: string; lat: number; lng: number }): void {
      q("update trips set dest_place_id = ?, dest_lat = ?, dest_lng = ?, dest_cached_at = ? where id = ?").run(
        center.placeId,
        center.lat,
        center.lng,
        now(),
        tripId,
      );
    },

    update(userId: string, tripId: string, input: Row): TripSnapshot {
      require(tripId, userId, "update_trip");
      const cur = q("select * from trips where id = ?").get(tripId) as Row;
      const title = input.title === undefined ? String(cur.title) : text(input.title, "Trip name", 80);
      const destination = input.destination === undefined ? String(cur.destination) : text(input.destination, "Destination", 120);
      const { startDate, endDate } = dateRange(input.startDate ?? cur.start_date, input.endDate ?? cur.end_date);
      const mealTimes = input.mealTimes === undefined ? undefined : input.mealTimes === null ? null : mealTimesInput(input.mealTimes);
      return mutate(tripId, userId, () => {
        if (mealTimes !== undefined) q("update trips set meal_times = ? where id = ?").run(mealTimes === null ? null : JSON.stringify(mealTimes), tripId);
        const wanted = new Set(datesBetween(startDate, endDate));
        for (const d of q("select id, date from trip_days where trip_id = ?").all(tripId)) {
          if (wanted.has(String(d.date))) {
            wanted.delete(String(d.date));
            continue;
          }
          const used = q("select count(*) as n from activities where day_id = ?").get(String(d.id)) as Row;
          if (Number(used.n) > 0) {
            throw new HttpError(409, `${d.date} still has activities. Move or remove them before taking that day out of the trip.`);
          }
          q("delete from trip_days where id = ?").run(String(d.id));
        }
        for (const date of wanted) q("insert into trip_days (id, trip_id, date) values (?, ?, ?)").run(randomUUID(), tripId, date);
        q("update trips set title = ?, destination = ?, start_date = ?, end_date = ? where id = ?").run(title, destination, startDate, endDate, tripId);
        return snapshot(tripId);
      });
    },

    remove(userId: string, tripId: string): void {
      require(tripId, userId, "delete_trip");
      const invited = q("select invitee_id from trip_invitations where trip_id = ? and status = 'pending'").all(tripId).map((r) => String(r.invitee_id));
      q("delete from trips where id = ?").run(tripId);
      onChange(tripId);
      for (const id of invited) onInvitation(id);
    },

    // --- sharing ---

    // Invite links: a fresh random token, stored only as a hash, expiring 24
    // hours after it's made (the server's clock decides). Making a new link
    // revokes the old one; it never extends it. A link lets a signed-in person
    // ask to join; it never adds anyone by itself.
    createInvite(userId: string, tripId: string): { token: string; link: InviteLink } {
      require(tripId, userId, "manage_invites");
      const token = newToken();
      const id = randomUUID();
      const t = now();
      transaction(db, () => {
        q("update trip_invite_links set revoked_at = ? where trip_id = ? and revoked_at is null").run(t, tripId);
        q("insert into trip_invite_links (id, trip_id, token_hash, created_by, created_at, expires_at) values (?, ?, ?, ?, ?, ?)").run(id, tripId, sha256(token), userId, t, t + INVITE_TTL_MS);
      });
      onChange(tripId);
      return { token, link: store.inviteLink(userId, tripId) as InviteLink };
    },

    revokeInvite(userId: string, tripId: string): void {
      require(tripId, userId, "manage_invites");
      q("update trip_invite_links set revoked_at = ? where trip_id = ? and revoked_at is null").run(now(), tripId);
      onChange(tripId);
    },

    // The owner's view of the current link: when it was made and expires. The
    // token itself was shown once and can't be shown again.
    inviteLink(userId: string, tripId: string): InviteLink | null {
      require(tripId, userId, "manage_invites");
      const r = q("select * from trip_invite_links where trip_id = ? and revoked_at is null order by created_at desc limit 1").get(tripId);
      return r ? { id: String(r.id), createdAt: Number(r.created_at), expiresAt: Number(r.expires_at), expired: Number(r.expires_at) <= now() } : null;
    },

    // What someone holding a link may see before they're let in: whose trip,
    // its title and destination, and where they stand. No dates, stops,
    // members or anything else from the trip.
    previewInvite(userId: string, token: unknown) {
      const link = linkFor(token);
      const t = q("select t.id, t.title, t.destination, u.display_name as owner from trips t join users u on u.id = t.owner_id where t.id = ?").get(link.tripId) as Row;
      const role = roleOf(link.tripId, userId);
      const req = q("select status from trip_join_requests where trip_id = ? and user_id = ? order by created_at desc limit 1").get(link.tripId, userId);
      const expired = link.expiresAt <= now();
      const state = role ? "member" : req?.status === "pending" ? "pending" : expired ? "expired" : req?.status === "rejected" ? "rejected" : "can_request";
      return {
        tripId: role ? link.tripId : null,
        title: String(t.title),
        destination: String(t.destination),
        ownerName: String(t.owner),
        expiresAt: link.expiresAt,
        state: state as "member" | "pending" | "expired" | "rejected" | "can_request",
        alreadyMember: role !== null,
      };
    },

    // Asking to join through a link. Only while the link is live; one pending
    // request per person per trip; members can't ask again. Each person asks
    // for themself: a request is tied to the account that sent it.
    requestToJoin(userId: string, token: unknown): { requestId: string; status: "pending"; tripId: string; created: boolean } {
      const link = linkFor(token);
      if (link.expiresAt <= now()) throw new HttpError(410, "This invite link has expired. Ask the trip's owner for a new one.", { code: "expired" });
      if (roleOf(link.tripId, userId)) throw new HttpError(409, "You're already on this trip.", { code: "member" });
      const pending = q("select id from trip_join_requests where trip_id = ? and user_id = ? and status = 'pending'").get(link.tripId, userId);
      if (pending) return { requestId: String(pending.id), status: "pending", tripId: link.tripId, created: false };
      const id = randomUUID();
      try {
        q("insert into trip_join_requests (id, trip_id, user_id, link_id, status, created_at) values (?, ?, ?, ?, 'pending', ?)").run(id, link.tripId, userId, link.id, now());
      } catch (err) {
        if (err instanceof Error && /UNIQUE constraint failed/i.test(err.message)) {
          const again = q("select id from trip_join_requests where trip_id = ? and user_id = ? and status = 'pending'").get(link.tripId, userId) as Row;
          return { requestId: String(again.id), status: "pending", tripId: link.tripId, created: false };
        }
        throw err;
      }
      onChange(link.tripId);
      onInvitation(String((q("select owner_id from trips where id = ?").get(link.tripId) as Row).owner_id));
      return { requestId: id, status: "pending", tripId: link.tripId, created: true };
    },

    // The owner's list: pending first, then recent decisions.
    joinRequests(userId: string, tripId: string) {
      require(tripId, userId, "manage_requests");
      return q(
        `select r.id, r.status, r.created_at, r.resolved_at, u.id as user_id, u.username, u.display_name
           from trip_join_requests r join users u on u.id = r.user_id
          where r.trip_id = ? order by r.status = 'pending' desc, coalesce(r.resolved_at, r.created_at) desc limit 30`,
      ).all(tripId).map((r) => ({
        id: String(r.id),
        status: String(r.status) as "pending" | "approved" | "rejected",
        createdAt: Number(r.created_at),
        resolvedAt: r.resolved_at === null ? null : Number(r.resolved_at),
        user: { id: String(r.user_id), username: String(r.username), displayName: String(r.display_name) },
      }));
    },

    // Approve or reject one pending request. Only the owner; never the
    // requester (who isn't a member, and an owner never has a request). A
    // request stays decidable after its link expires. Approving adds the
    // member and closes the request in one mutate(), so live editors see them.
    decideJoinRequest(userId: string, tripId: string, requestId: string, decision: "approve" | "reject"): { requesterId: string; status: "approved" | "rejected" } {
      require(tripId, userId, "manage_requests");
      const req = q("select * from trip_join_requests where id = ? and trip_id = ?").get(requestId, tripId);
      if (!req) throw notFound("That request doesn't exist.");
      const requesterId = String(req.user_id);
      if (requesterId === userId) throw new HttpError(403, "You can't decide your own request.");
      if (req.status !== "pending") throw new HttpError(409, `That request was already ${req.status}.`, { code: String(req.status) });
      const status = decision === "approve" ? "approved" : "rejected";
      mutate(tripId, userId, () => {
        const r = q("update trip_join_requests set status = ?, resolved_at = ?, resolved_by = ? where id = ? and status = 'pending'").run(status, now(), userId, requestId);
        if (Number(r.changes) !== 1) throw new HttpError(409, "That request was already decided.");
        if (status === "approved") q("insert into trip_members (trip_id, user_id, role, joined_at) values (?, ?, 'collaborator', ?) on conflict do nothing").run(tripId, requesterId, now());
      });
      onInvitation(requesterId);
      onInvitation(userId);
      return { requesterId, status };
    },

    // What the signed-in person has asked to join, and how it went.
    myJoinRequests(userId: string) {
      return q(
        `select r.id, r.status, r.created_at, r.resolved_at, t.id as trip_id, t.title, t.destination, u.display_name as owner
           from trip_join_requests r join trips t on t.id = r.trip_id join users u on u.id = t.owner_id
          where r.user_id = ? and (r.status = 'pending' or r.resolved_at > ?) order by r.created_at desc limit 20`,
      ).all(userId, now() - 7 * 86_400_000).map((r) => ({
        id: String(r.id),
        status: String(r.status),
        createdAt: Number(r.created_at),
        trip: { id: r.status === "approved" ? String(r.trip_id) : null, title: String(r.title), destination: String(r.destination), ownerName: String(r.owner) },
      }));
    },

    // Pending requests across every trip this person owns, for My Trips.
    requestsToMe(userId: string) {
      return q(
        `select r.id, r.created_at, t.id as trip_id, t.title, u.id as user_id, u.username, u.display_name
           from trip_join_requests r join trips t on t.id = r.trip_id join users u on u.id = r.user_id
          where t.owner_id = ? and r.status = 'pending' order by r.created_at`,
      ).all(userId).map((r) => ({
        id: String(r.id),
        createdAt: Number(r.created_at),
        trip: { id: String(r.trip_id), title: String(r.title) },
        user: { id: String(r.user_id), username: String(r.username), displayName: String(r.display_name) },
      }));
    },

    // --- inviting an existing account by nickname ---

    // Owner-only nickname search, using registration's Unicode comparison.
    // A one-character query is exact-only; longer queries can match part
    // of a name. Punctuation is literal. Exact first, at most 8; each says whether it's you,
    // already on the trip, or already invited. Only what choosing needs.
    searchInvitees(userId: string, tripId: string, query: unknown) {
      require(tripId, userId, "manage_invites");
      const raw = typeof query === "string" ? query.trim() : "";
      const length = [...raw].length;
      if (!length || length > 40 || /[\p{Cc}\p{Cf}\u2028\u2029]/u.test(raw)) throw bad("Enter a nickname of 1–40 characters.");
      const key = displayNameKey(raw);
      const nameKey = "coalesce(u.display_name_key, wayline_nickname_key(u.display_name))";
      const rows = q(
        `select u.id, u.username, u.display_name,
                (select role from trip_members m where m.trip_id = ? and m.user_id = u.id) as role,
                (select 1 from trip_invitations i where i.trip_id = ? and i.invitee_id = u.id and i.status = 'pending') as pending
           from users u
          where ${length === 1 ? `${nameKey} = ?` : `instr(${nameKey}, ?) > 0`}
          order by ${nameKey} = ? desc, instr(${nameKey}, ?) = 1 desc, length(${nameKey}), ${nameKey}, lower(u.username), u.id
          limit 8`,
      ).all(tripId, tripId, key, key, key);
      return {
        query: key,
        results: rows.map((r) => ({
          id: String(r.id),
          username: String(r.username),
          displayName: String(r.display_name),
          status: String(r.id) === userId ? "you" : r.role ? "member" : r.pending ? "invited" : "available",
        })),
      };
    },

    // An invitation addressed to one account. It adds nobody: the invitee
    // accepts it from My Trips. One pending per person per trip (the partial
    // unique index decides under concurrent requests).
    inviteUser(userId: string, tripId: string, input: Row) {
      require(tripId, userId, "manage_invites");
      const inviteeId = input.userId;
      if (typeof inviteeId !== "string" || !q("select 1 from users where id = ?").get(inviteeId)) throw notFound("That account doesn't exist.");
      if (inviteeId === userId) throw bad("You're already on this trip.");
      if (roleOf(tripId, inviteeId)) throw new HttpError(409, "They're already on this trip.", { code: "member" });
      const id = randomUUID();
      try {
        q("insert into trip_invitations (id, trip_id, inviter_id, invitee_id, status, created_at) values (?, ?, ?, ?, 'pending', ?)").run(id, tripId, userId, inviteeId, now());
      } catch (err) {
        if (err instanceof Error && /UNIQUE constraint failed/i.test(err.message)) throw new HttpError(409, "They've already been invited.", { code: "invited" });
        throw err;
      }
      onInvitation(inviteeId);
      return { invitation: store.invitationsFor(userId, tripId).find((i) => i.id === id) };
    },

    // The owner's view of named invitations: pending ones, then the latest
    // outcome for anyone else they invited.
    invitationsFor(userId: string, tripId: string) {
      require(tripId, userId, "manage_invites");
      return q(
        `select i.id, i.status, i.created_at, i.resolved_at, u.id as user_id, u.username, u.display_name
           from trip_invitations i join users u on u.id = i.invitee_id
          where i.trip_id = ? order by i.status = 'pending' desc, coalesce(i.resolved_at, i.created_at) desc limit 30`,
      ).all(tripId).map((r) => ({
        id: String(r.id),
        status: String(r.status),
        createdAt: Number(r.created_at),
        resolvedAt: r.resolved_at === null ? null : Number(r.resolved_at),
        user: { id: String(r.user_id), username: String(r.username), displayName: String(r.display_name) },
      }));
    },

    cancelInvitation(userId: string, tripId: string, invitationId: string): void {
      require(tripId, userId, "manage_invites");
      const r = q("update trip_invitations set status = 'cancelled', resolved_at = ? where id = ? and trip_id = ? and status = 'pending' returning invitee_id").get(now(), invitationId, tripId);
      if (!r) throw notFound("That invitation isn't pending any more.");
      onInvitation(String(r.invitee_id));
    },

    // What the signed-in person has been invited to and hasn't answered.
    pendingFor(userId: string) {
      return q(
        `select i.id, i.created_at, t.id as trip_id, t.title, t.destination, t.start_date, t.end_date,
                u.display_name as inviter_name, u.username as inviter_username, u.id as inviter_id,
                (select count(*) from trip_members x where x.trip_id = t.id) as people
           from trip_invitations i join trips t on t.id = i.trip_id join users u on u.id = i.inviter_id
          where i.invitee_id = ? and i.status = 'pending' order by i.created_at desc`,
      ).all(userId).map((r) => ({
        id: String(r.id),
        createdAt: Number(r.created_at),
        inviter: { id: String(r.inviter_id), username: String(r.inviter_username), displayName: String(r.inviter_name) },
        trip: { id: String(r.trip_id), title: String(r.title), destination: String(r.destination), startDate: String(r.start_date), endDate: String(r.end_date), people: Number(r.people) },
      }));
    },

    // Accepting: only the invitee, only while pending and the trip exists;
    // membership and the invitation's end happen in one mutate(), so the
    // trip's live editors get the new member. Accepting twice is harmless.
    acceptInvitation(userId: string, invitationId: string): string {
      const inv = q("select * from trip_invitations where id = ?").get(invitationId);
      if (!inv || String(inv.invitee_id) !== userId) throw notFound("That invitation doesn't exist.");
      const tripId = String(inv.trip_id);
      if (inv.status === "accepted" && roleOf(tripId, userId)) return tripId;
      if (inv.status !== "pending") throw new HttpError(409, inv.status === "cancelled" ? "The owner cancelled this invitation." : "This invitation has already been answered.");
      mutate(tripId, userId, () => {
        // checked again inside the transaction: a concurrent accept or cancel may have won
        const r = q("update trip_invitations set status = 'accepted', resolved_at = ? where id = ? and status = 'pending'").run(now(), invitationId);
        if (Number(r.changes) !== 1) throw new HttpError(409, "This invitation has already been answered.");
        q("insert into trip_members (trip_id, user_id, role, joined_at) values (?, ?, 'collaborator', ?) on conflict do nothing").run(tripId, userId, now());
      });
      onInvitation(userId);
      return tripId;
    },

    declineInvitation(userId: string, invitationId: string): void {
      const r = q("update trip_invitations set status = 'declined', resolved_at = ? where id = ? and invitee_id = ? and status = 'pending'").run(now(), invitationId, userId);
      if (Number(r.changes) !== 1) throw notFound("That invitation isn't pending any more.");
      onInvitation(userId);
    },

    // The owner can remove a collaborator; a collaborator can remove themself.
    removeMember(userId: string, tripId: string, memberId: string): void {
      require(tripId, userId, memberId === userId ? "leave" : "remove_member");
      const target = roleOf(tripId, memberId);
      if (!target) throw notFound("That person isn't on this trip.");
      if (target === "owner") throw bad("The owner can't be removed from their own trip.");
      mutate(tripId, userId, () => q("delete from trip_members where trip_id = ? and user_id = ?").run(tripId, memberId));
    },

    // --- itinerary ---

    // clientId makes adding idempotent: a retried request (a double click, a
    // reconnect replaying a POST) finds the activity it already created.
    addActivity(userId: string, tripId: string, input: Row): { created: boolean; activityId: string; trip: TripSnapshot } {
      require(tripId, userId, "add_activity");
      const clientId = text(input.clientId, "clientId", 64, 8);
      const existing = q("select id from activities where trip_id = ? and client_id = ?").get(tripId, clientId);
      if (existing) return { created: false, activityId: String(existing.id), trip: snapshot(tripId) };

      const day = getDay(tripId, input.dayId);
      const title = text(input.title, "Title", 120);
      const k = kind(input.kind ?? "custom");
      const start = startMinute(input.startMin ?? null);
      const dur = duration(input.durationMin ?? 60);
      const notes = input.notes === undefined ? "" : text(input.notes, "Notes", 2000, 0);
      const place = placeInput(input.place);
      const m = meal(input.meal);
      const id = randomUUID();

      const trip = mutate(tripId, userId, () => {
        const count = Number((q("select count(*) as n from activities where day_id = ?").get(day.id) as Row).n);
        const first = startsDay(day.id) ? 1 : 0; // nothing goes before the starting point
        const at = Number.isInteger(input.index) ? Math.max(first, Math.min(count, input.index as number)) : count;
        q("update activities set position = position + 1 where day_id = ? and position >= ?").run(day.id, at);
        q(
          `insert into activities (id, trip_id, day_id, client_id, position, title, kind, start_min, duration_min, notes,
                                   place_id, place_source, lat, lng, place_cached_at, meal, created_by, updated_by, updated_at)
           values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        ).run(
          id, tripId, day.id, clientId, at, title, k, start, dur, notes,
          place?.placeId ?? null, place?.source ?? null, place?.lat ?? null, place?.lng ?? null, place ? now() : null, m,
          userId, userId, now(),
        );
        renumber(day.id);
        return snapshot(tripId);
      });
      return { created: true, activityId: id, trip };
    },

    // Content edits carry the version the editor started from. If someone
    // else saved in between, the edit is refused with their version, so
    // nobody's change is silently overwritten.
    updateActivity(userId: string, tripId: string, activityId: string, input: Row): TripSnapshot {
      requireMember(tripId, userId);
      const cur = getActivity(tripId, activityId);
      requireActivity(tripId, userId, cur);
      if (input.baseVersion !== cur.version) {
        throw new HttpError(409, "Someone else changed this activity while you were editing.", { current: cur });
      }
      const next = {
        title: input.title === undefined ? cur.title : text(input.title, "Title", 120),
        kind: input.kind === undefined ? cur.kind : kind(input.kind),
        startMin: input.startMin === undefined ? cur.startMin : startMinute(input.startMin),
        durationMin: input.durationMin === undefined ? cur.durationMin : duration(input.durationMin),
        notes: input.notes === undefined ? cur.notes : text(input.notes, "Notes", 2000, 0),
        meal: input.meal === undefined ? cur.meal : meal(input.meal),
      };
      return mutate(tripId, userId, () => {
        q(
          "update activities set title = ?, kind = ?, start_min = ?, duration_min = ?, notes = ?, meal = ?, version = version + 1, updated_by = ?, updated_at = ? where id = ?",
        ).run(next.title, next.kind, next.startMin, next.durationMin, next.notes, next.meal, userId, now(), activityId);
        return snapshot(tripId);
      });
    },

    // Moves don't need a version: the server places the activity at the
    // requested index among whatever the day holds right now.
    moveActivity(userId: string, tripId: string, activityId: string, input: Row): TripSnapshot {
      requireMember(tripId, userId);
      const cur = getActivity(tripId, activityId);
      if (cur.role !== "start") requireActivity(tripId, userId, cur);
      if (cur.role === "start") throw bad("The starting point stays first. Change it instead of moving it.");
      const day = getDay(tripId, input.dayId ?? cur.dayId);
      if (!Number.isInteger(input.index)) throw bad("Say where to move it (index).");
      // a timed stop sits where its time puts it; moving it to another day keeps
      // its time, but within a day the way to move it is to change its time
      if (cur.startMin !== null && day.id === cur.dayId) {
        throw bad("This stop has a time, so its place in the day follows its time. Change its time to move it.");
      }
      return mutate(tripId, userId, () => {
        const ids = q("select id from activities where day_id = ? and id != ? order by position, id")
          .all(day.id, activityId)
          .map((r) => String(r.id));
        const at = Math.max(startsDay(day.id) ? 1 : 0, Math.min(ids.length, input.index as number));
        ids.splice(at, 0, activityId);
        q("update activities set day_id = ?, updated_at = ? where id = ?").run(day.id, now(), activityId);
        const set = q("update activities set position = ? where id = ?");
        ids.forEach((id, i) => set.run(i, id));
        if (day.id !== cur.dayId) renumber(cur.dayId);
        return snapshot(tripId);
      });
    },

    // Points an existing stop at a different place. The stop keeps its id, day,
    // time, length, notes and meal (so its position too); only the routes that
    // touch it are dropped, since they were for the old place. Versioned like
    // any content edit.
    setPlace(userId: string, tripId: string, activityId: string, input: Row): TripSnapshot {
      requireMember(tripId, userId);
      const cur = getActivity(tripId, activityId);
      if (cur.role === "start") throw bad("Use 'Change start' for the starting point.");
      requireActivity(tripId, userId, cur);
      if (input.baseVersion !== cur.version) {
        throw new HttpError(409, "Someone else changed this stop while you were choosing a new place.", { current: cur });
      }
      const place = placeInput(input.place);
      if (!place) throw bad("Choose the new place.");
      const title = input.title === undefined ? cur.title : text(input.title, "Title", 120);
      return mutate(tripId, userId, () => {
        q("delete from transport_segments where from_activity_id = ? or to_activity_id = ?").run(activityId, activityId);
        q(
          "update activities set title = ?, place_id = ?, place_source = ?, lat = ?, lng = ?, place_cached_at = ?, version = version + 1, updated_by = ?, updated_at = ? where id = ?",
        ).run(title, place.placeId, place.source, place.lat, place.lng, now(), userId, now(), activityId);
        return snapshot(tripId);
      });
    },

    // The starting point: the first activity of the first day, marked
    // role = 'start'. Setting it again moves it to the new place and drops
    // only the routes that touch it; the other stops are untouched.
    setStart(userId: string, tripId: string, input: Row): { activityId: string; trip: TripSnapshot } {
      require(tripId, userId, "set_start");
      const title = text(input.title, "Title", 120);
      const place = placeInput(input.place);
      if (!place) throw bad("Choose where the trip starts.");
      const existing = q("select id, version from activities where trip_id = ? and role = 'start'").get(tripId);
      // baseVersion: the start's version the client saw (null: it saw none).
      // It's required: a request without it used to replace the start
      // unchecked (found by the Crit 9 production audit). A mismatch means
      // someone else changed the start meanwhile.
      if (input.baseVersion !== null && !Number.isInteger(input.baseVersion)) {
        throw bad("Say which starting point you're changing: baseVersion is its version, or null if there's none yet.");
      }
      if ((existing ? Number(existing.version) : null) !== input.baseVersion) {
        throw new HttpError(409, "Someone else changed the starting point while you were choosing.", { current: existing ? getActivity(tripId, String(existing.id)) : null });
      }
      if (existing) {
        const id = String(existing.id);
        const trip = mutate(tripId, userId, () => {
          q("delete from transport_segments where from_activity_id = ? or to_activity_id = ?").run(id, id);
          q(
            "update activities set title = ?, place_id = ?, place_source = ?, lat = ?, lng = ?, place_cached_at = ?, version = version + 1, updated_by = ?, updated_at = ? where id = ?",
          ).run(title, place.placeId, place.source, place.lat, place.lng, now(), userId, now(), id);
          return snapshot(tripId);
        });
        return { activityId: id, trip };
      }
      const clientId = text(input.clientId, "clientId", 64, 8);
      const firstDay = q("select id from trip_days where trip_id = ? order by date limit 1").get(tripId);
      if (!firstDay) throw bad("This trip has no days to start on.");
      const id = randomUUID();
      const trip = mutate(tripId, userId, () => {
        q("update activities set position = position + 1 where day_id = ?").run(String(firstDay.id));
        q(
          `insert into activities (id, trip_id, day_id, client_id, position, title, kind, start_min, duration_min, notes,
                                   place_id, place_source, lat, lng, place_cached_at, role, created_by, updated_by, updated_at)
           values (?, ?, ?, ?, 0, ?, 'custom', null, ?, '', ?, ?, ?, ?, ?, 'start', ?, ?, ?)`,
        ).run(id, tripId, String(firstDay.id), clientId, title, MIN_DURATION, place.placeId, place.source, place.lat, place.lng, now(), userId, userId, now());
        renumber(String(firstDay.id));
        return snapshot(tripId);
      });
      return { activityId: id, trip };
    },

    deleteActivity(userId: string, tripId: string, activityId: string): TripSnapshot {
      requireMember(tripId, userId);
      const cur = getActivity(tripId, activityId);
      if (cur.role === "start") require(tripId, userId, "set_start");
      else requireActivity(tripId, userId, cur);
      return mutate(tripId, userId, () => {
        q("delete from activities where id = ?").run(activityId);
        renumber(cur.dayId);
        return snapshot(tripId);
      });
    },

    // --- transport ---

    // What a route lookup needs, checked: the two activities are next to each
    // other on one day and both are places.
    routeRequest(userId: string, tripId: string, fromId: unknown, toId: unknown) {
      require(tripId, userId, "calculate_route");
      const from = getActivity(tripId, fromId);
      const to = getActivity(tripId, toId);
      const day = getDay(tripId, from.dayId);
      if (to.dayId !== from.dayId || to.position !== from.position + 1) {
        throw new HttpError(409, "Those activities aren't next to each other any more. The plan may have changed.");
      }
      if (!from.place || !to.place) throw bad("Both activities need a place to calculate a route.");
      const tz = String((q("select timezone from trips where id = ?").get(tripId) as Row).timezone);
      const existing = q("select * from transport_segments where from_activity_id = ? and to_activity_id = ?").get(from.id, to.id);
      return {
        from,
        to,
        date: day.date,
        timezone: tz,
        departKey: departKey(day.date, from, tz),
        departMin: from.startMin === null ? null : from.startMin + from.durationMin,
        existing: existing && now() - Number(existing.computed_at) < CACHE_MS
          ? { departKey: String(existing.depart_key), selectedMode: (existing.selected_mode as Mode | null) ?? null }
          : null,
      };
    },

    saveRoute(userId: string, tripId: string, fromId: string, toId: string, key: string, options: RouteOption[], keepMode: Mode | null): TripSnapshot {
      require(tripId, userId, "calculate_route");
      const usable = (m: Mode | null) => m !== null && options.some((o) => o.mode === m && o.status === "ok");
      const selected = usable(keepMode) ? keepMode : defaultMode(options);
      return mutate(tripId, userId, () => {
        // the pair is re-checked inside the transaction: the plan may have
        // changed while Google was answering
        const from = getActivity(tripId, fromId);
        const to = getActivity(tripId, toId);
        if (to.dayId !== from.dayId || to.position !== from.position + 1) {
          throw new HttpError(409, "The plan changed while the route was being calculated. Try again.");
        }
        q("delete from transport_segments where from_activity_id = ? and to_activity_id = ?").run(fromId, toId);
        q(
          "insert into transport_segments (id, trip_id, from_activity_id, to_activity_id, depart_key, options, selected_mode, computed_at, computed_by) values (?, ?, ?, ?, ?, ?, ?, ?, ?)",
        ).run(randomUUID(), tripId, fromId, toId, key, JSON.stringify(options), selected, now(), userId);
        return snapshot(tripId);
      });
    },

    selectMode(userId: string, tripId: string, segmentId: string, mode: unknown): TripSnapshot {
      require(tripId, userId, "select_mode");
      if (!MODES.includes(mode as Mode)) throw bad("Mode must be WALK, TRANSIT or DRIVE.");
      const seg = q("select options from transport_segments where id = ? and trip_id = ?").get(segmentId, tripId);
      if (!seg) throw notFound("That route is no longer part of the plan.");
      const options = JSON.parse(String(seg.options)) as RouteOption[];
      if (!options.some((o) => o.mode === mode && o.status === "ok")) throw bad("There's no route for that mode.");
      return mutate(tripId, userId, () => {
        q("update transport_segments set selected_mode = ? where id = ?").run(mode as string, segmentId);
        return snapshot(tripId);
      });
    },

    // Applies one proposal, by id, after the user accepted it. The proposal
    // is re-derived from the current plan, and every value it changes must
    // still be what the preview showed; otherwise the plan moved on and the
    // user is asked to look again.
    // basedOn: the day fingerprint the preview was made from (always sent by
    // the copilot); if the day has changed since, the preview is out of date.
    applyProposal(userId: string, tripId: string, dayId: unknown, proposalId: unknown, basedOn?: unknown): TripSnapshot {
      require(tripId, userId, "apply_proposal");
      const day = snapshot(tripId).days.find((d) => d.id === dayId);
      if (!day) throw notFound("That day isn't part of this trip.");
      if (basedOn !== undefined && basedOn !== null && basedOn !== day.fingerprint) {
        throw new HttpError(409, "The plan changed since this suggestion was shown. Review the updated day before applying anything.", { code: "stale" });
      }
      const proposal = day.analysis.proposals.find((p) => p.id === proposalId);
      if (!proposal) throw new HttpError(409, "That suggestion no longer applies. The plan has changed since it was made.");
      return mutate(tripId, userId, () => {
        for (const c of proposal.changes) {
          if (c.type === "activity") {
            const col = c.field === "startMin" ? "start_min" : "duration_min";
            const r = q(`update activities set ${col} = ?, version = version + 1, updated_by = ?, updated_at = ? where id = ? and ${col} = ?`).run(
              c.to,
              userId,
              now(),
              c.activityId,
              c.from,
            );
            if (Number(r.changes) !== 1) throw new HttpError(409, "The plan changed before the suggestion could be applied.");
          } else {
            q("update transport_segments set selected_mode = ? where id = ?").run(c.to, c.segmentId);
          }
        }
        return snapshot(tripId);
      });
    },

    // Applies a previewed AI plan for one day (src/planner.ts) in one change.
    // Refused if the day changed since the preview (basedOn), and each part
    // is held to the ordinary rules: a collaborator may add stops, but moving
    // others' stops or choosing modes needs the owner, so those parts are
    // refused rather than quietly skipped. Times people set never move: the
    // planner only reorders untimed stops.
    applyPlan(userId: string, tripId: string, plan: { dayId: string; basedOn: string; changes: AppliedChange[] }): TripSnapshot {
      requireMember(tripId, userId);
      const day = snapshot(tripId).days.find((d) => d.id === plan.dayId);
      if (!day) throw notFound("That day isn't part of this trip.");
      if (plan.basedOn !== day.fingerprint) throw new HttpError(409, "The day changed since this plan was made. Make a new plan for the updated day.", { code: "stale" });
      const moves = plan.changes.filter((c) => c.type === "move") as Extract<AppliedChange, { type: "move" }>[];
      const modes = plan.changes.filter((c) => c.type === "mode") as Extract<AppliedChange, { type: "mode" }>[];
      const adds = plan.changes.filter((c) => c.type === "add") as Extract<AppliedChange, { type: "add" }>[];
      for (const m of moves) {
        const a = day.activities.find((x) => x.id === m.activityId);
        if (!a || a.startMin !== null || a.role === "start") throw new HttpError(409, "The plan tried to move a stop with a set time. Make a new plan.");
        requireActivity(tripId, userId, a);
      }
      if (modes.length) require(tripId, userId, "select_mode");
      if (adds.length) require(tripId, userId, "add_activity");
      return mutate(tripId, userId, () => {
        if (moves.length) {
          const fixed = day.activities.filter((a) => a.role === "start" || a.startMin !== null).map((a) => a.id);
          const untimedNow = day.activities.filter((a) => a.role !== "start" && a.startMin === null).map((a) => a.id);
          const wanted = [...moves].sort((a, b) => a.toIndex - b.toIndex).map((m) => m.activityId);
          const rest = untimedNow.filter((id) => !wanted.includes(id));
          const set = q("update activities set position = ?, updated_at = ? where id = ?");
          [...fixed, ...wanted, ...rest].forEach((id, i) => set.run(i, now(), id));
        }
        for (const m of modes) {
          const seg = q("select options from transport_segments where id = ? and trip_id = ?").get(m.segmentId, tripId);
          if (!seg) throw new HttpError(409, "A route in this plan is no longer part of the day. Make a new plan.");
          if (!(JSON.parse(String(seg.options)) as RouteOption[]).some((o) => o.mode === m.to && o.status === "ok")) throw new HttpError(409, "A route in this plan isn't available any more. Make a new plan.");
          q("update transport_segments set selected_mode = ? where id = ?").run(m.to, m.segmentId);
        }
        for (const a of adds) {
          if (q("select 1 from activities where trip_id = ? and client_id = ?").get(tripId, a.clientId)) continue; // applied already
          const place = placeInput(a.place);
          const count = Number((q("select count(*) as n from activities where day_id = ?").get(day.id) as Row).n);
          q(
            `insert into activities (id, trip_id, day_id, client_id, position, title, kind, start_min, duration_min, notes,
                                     place_id, place_source, lat, lng, place_cached_at, meal, created_by, updated_by, updated_at)
             values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          ).run(
            randomUUID(), tripId, day.id, a.clientId, count, text(a.title, "Title", 120), kind(a.kind), startMinute(a.startMin), duration(a.durationMin), text(a.notes, "Notes", 2000, 0),
            place?.placeId ?? null, place?.source ?? null, place?.lat ?? null, place?.lng ?? null, place ? now() : null, meal(a.meal),
            userId, userId, now(),
          );
        }
        renumber(day.id);
        return snapshot(tripId);
      });
    },

    // --- publishing (snapshot data for src/publications.ts) ---

    // What a publication copies from the working trip, read in one go. Notes
    // stay private; only stops, times, kinds, meals and places are published.
    publishable(userId: string, tripId: string) {
      require(tripId, userId, "publish");
      const t = q("select * from trips where id = ?").get(tripId) as Row;
      const days = q("select id, date from trip_days where trip_id = ? order by date").all(tripId);
      const stops = days.flatMap((d, i) =>
        dayActivities(String(d.id)).map((a) => {
          const raw = q("select lat, lng, place_cached_at from activities where id = ?").get(a.id) as Row;
          return {
            day: i + 1,
            position: a.position,
            title: a.title,
            kind: a.kind,
            startMin: a.startMin,
            durationMin: a.durationMin,
            meal: a.meal,
            role: a.role,
            placeId: a.place?.placeId ?? null,
            placeSource: a.place?.source ?? null,
            lat: a.place?.lat ?? null,
            lng: a.place?.lng ?? null,
            cachedAt: raw.place_cached_at === null ? null : Number(raw.place_cached_at),
          };
        }),
      );
      const fresh = t.dest_cached_at !== null && now() - Number(t.dest_cached_at) < CACHE_MS && t.dest_lat !== null;
      return {
        title: String(t.title),
        destination: String(t.destination),
        timezone: String(t.timezone),
        days: days.length,
        rev: Number(t.rev),
        cover: t.cover_key === null ? coverFor(t) : String(t.cover_key),
        ref: fresh ? { lat: Number(t.dest_lat), lng: Number(t.dest_lng), cachedAt: Number(t.dest_cached_at) } : null,
        stops,
      };
    },

    // A new private trip, owned by the user, from a publication's snapshot.
    // Nothing private comes along: no members, links, requests, invitations,
    // reviews or publication. Where it came from is recorded for attribution.
    createFork(
      userId: string,
      pub: { id: string; title: string; destination: string; timezone: string; days: number; author: string | null; cover: string | null; ref: { lat: number; lng: number; cachedAt: number | null } | null; stops: ForkStop[] },
      input: Row,
    ): TripSnapshot {
      if (!isDate(input.startDate)) throw bad("Choose a start date (YYYY-MM-DD).");
      const startDate = input.startDate;
      const dates = datesBetween(startDate, new Date(Date.parse(`${startDate}T00:00:00Z`) + (pub.days - 1) * 86_400_000).toISOString().slice(0, 10));
      const id = randomUUID();
      transaction(db, () => {
        const t = now();
        q(
          `insert into trips (id, owner_id, title, destination, start_date, end_date, timezone, dest_place_id, dest_lat, dest_lng, dest_cached_at,
                              forked_from_publication_id, forked_from_title, forked_from_author, forked_at, cover_key, created_at, updated_at)
           values (?, ?, ?, ?, ?, ?, ?, null, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        ).run(id, userId, pub.title, pub.destination, startDate, dates[dates.length - 1], pub.timezone, pub.ref?.lat ?? null, pub.ref?.lng ?? null, pub.ref?.cachedAt ?? null, pub.id, pub.title, pub.author, t, pub.cover, t, t);
        q("insert into trip_members (trip_id, user_id, role, joined_at) values (?, ?, 'owner', ?)").run(id, userId, t);
        const dayIds = dates.map((date) => {
          const dayId = randomUUID();
          q("insert into trip_days (id, trip_id, date) values (?, ?, ?)").run(dayId, id, date);
          return dayId;
        });
        const ins = q(
          `insert into activities (id, trip_id, day_id, client_id, position, title, kind, start_min, duration_min, notes, meal, role,
                                   place_id, place_source, lat, lng, place_cached_at, created_by, updated_by, updated_at)
           values (?, ?, ?, ?, ?, ?, ?, ?, ?, '', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        );
        for (const s of pub.stops) {
          const dayId = dayIds[s.day - 1];
          if (!dayId) continue;
          ins.run(
            randomUUID(), id, dayId, `fork:${randomUUID()}`, s.position, s.title, KINDS.includes(s.kind as Kind) ? s.kind : "custom", s.startMin, s.durationMin,
            s.meal, s.role === "start" && s.day === 1 ? "start" : null,
            s.placeId, s.placeSource, s.lat, s.lng, s.placeId ? (s.cachedAt ?? t) : null, userId, userId, t,
          );
        }
        orderTrip(id);
      });
      return snapshot(id);
    },

    // Activities whose temporary coordinates have expired, for a refresh.
    stalePlaces(tripId: string): { id: string; placeId: string }[] {
      return q("select id, place_id from activities where trip_id = ? and place_source = 'google' and place_cached_at < ?")
        .all(tripId, now() - CACHE_MS)
        .map((r) => ({ id: String(r.id), placeId: String(r.place_id) }));
    },

    refreshPlace(tripId: string, activityId: string, lat: number, lng: number): void {
      q("update activities set lat = ?, lng = ?, place_cached_at = ? where id = ? and trip_id = ?").run(lat, lng, now(), activityId, tripId);
      q("update trips set rev = rev + 1 where id = ?").run(tripId);
      onChange(tripId);
    },
  };
  return store;
}

export type TripStore = ReturnType<typeof createTripStore>;
