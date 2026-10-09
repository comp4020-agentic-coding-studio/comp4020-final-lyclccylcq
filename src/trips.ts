import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { newToken, sha256 } from "./auth.ts";
import { transaction } from "./db.ts";
import { bad, HttpError, notFound } from "./errors.ts";
import type { TemplateDetail } from "./itineraries.ts";
import {
  analyseDay,
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
export type Role = "owner" | "collaborator";

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
  version: number;
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

export type Day = { id: string; date: string; activities: Activity[]; segments: Segment[]; analysis: DayAnalysis };

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
  members: { id: string; displayName: string; role: Role }[];
  days: Day[];
};

type Row = Record<string, unknown>;

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
  // Google id (tpl: prefix); google: a real place id. Only google routes.
  const source = p.source === "demo" ? "demo" : p.source === "curated" ? "curated" : "google";
  const prefix = source === "demo" ? "demo:" : source === "curated" ? "tpl:" : null;
  if (prefix ? !placeId.startsWith(prefix) : placeId.startsWith("demo:") || placeId.startsWith("tpl:")) throw bad("Invalid place.");
  const lat = Number(p.lat);
  const lng = Number(p.lng);
  if (!(Math.abs(lat) <= 90) || !(Math.abs(lng) <= 180)) throw bad("Invalid place coordinates.");
  return { placeId, source, lat, lng };
}

// --- the store ---------------------------------------------------------------

export function createTripStore(db: DatabaseSync, now = () => Date.now(), onChange: (tripId: string) => void = () => {}) {
  const q = (sql: string) => db.prepare(sql);

  function roleOf(tripId: string, userId: string): Role | null {
    const row = q("select role from trip_members where trip_id = ? and user_id = ?").get(tripId, userId);
    return row ? (row.role as Role) : null;
  }

  // Non-members get the same 404 as a trip that doesn't exist, so an id
  // reveals nothing on its own.
  function requireMember(tripId: string, userId: string): Role {
    const role = typeof tripId === "string" ? roleOf(tripId, userId) : null;
    if (!role) throw notFound("Trip not found.");
    return role;
  }

  function requireOwner(tripId: string, userId: string): void {
    if (requireMember(tripId, userId) !== "owner") throw new HttpError(403, "Only the trip's owner can do that.");
  }

  const toActivity = (r: Row): Activity => {
    const fresh = r.place_cached_at !== null && now() - Number(r.place_cached_at) < CACHE_MS;
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
      version: Number(r.version),
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

  // Every change to a trip goes through here: one transaction, the trip's
  // revision bumped, stale segments pruned, then (after commit) the change
  // is announced so live sessions get the new snapshot.
  function mutate<T>(tripId: string, userId: string, fn: () => T): T {
    const out = transaction(db, () => {
      const result = fn();
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
    const t = q("select * from trips where id = ?").get(tripId);
    if (!t) throw notFound("Trip not found.");
    const tz = String(t.timezone);
    const members = q(
      "select u.id, u.display_name, m.role from trip_members m join users u on u.id = m.user_id where m.trip_id = ? order by m.role desc, m.joined_at",
    )
      .all(tripId)
      .map((r) => ({ id: String(r.id), displayName: String(r.display_name), role: r.role as Role }));

    const segRows = q("select * from transport_segments where trip_id = ?").all(tripId);
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
      return { id: String(d.id), date, activities, segments, analysis: analyseDay(plain, segs) };
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
      hasInvite: t.invite_hash !== null,
      members,
      days,
    };
  }

  const store = {
    roleOf,
    requireMember,
    snapshot,

    view(userId: string, tripId: string): TripSnapshot {
      requireMember(tripId, userId);
      return snapshot(tripId);
    },

    list(userId: string) {
      const rows = q(
        `select t.id, t.title, t.destination, t.start_date, t.end_date, t.updated_at, m.role,
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
      requireOwner(tripId, userId);
      const cur = q("select * from trips where id = ?").get(tripId) as Row;
      const title = input.title === undefined ? String(cur.title) : text(input.title, "Trip name", 80);
      const destination = input.destination === undefined ? String(cur.destination) : text(input.destination, "Destination", 120);
      const { startDate, endDate } = dateRange(input.startDate ?? cur.start_date, input.endDate ?? cur.end_date);
      return mutate(tripId, userId, () => {
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
      requireOwner(tripId, userId);
      q("delete from trips where id = ?").run(tripId);
      onChange(tripId);
    },

    // --- sharing ---

    // A fresh random link replaces any earlier one, which stops working.
    // Only its hash is stored, so the link is shown once, to the owner.
    createInvite(userId: string, tripId: string): string {
      requireOwner(tripId, userId);
      const token = newToken();
      mutate(tripId, userId, () => q("update trips set invite_hash = ? where id = ?").run(sha256(token), tripId));
      return token;
    },

    revokeInvite(userId: string, tripId: string): void {
      requireOwner(tripId, userId);
      mutate(tripId, userId, () => q("update trips set invite_hash = null where id = ?").run(tripId));
    },

    previewInvite(userId: string, token: unknown) {
      if (typeof token !== "string" || token.length < 20) throw notFound("This invite link isn't valid any more.");
      const t = q(
        "select t.id, t.title, t.destination, t.start_date, t.end_date, u.display_name as owner from trips t join users u on u.id = t.owner_id where t.invite_hash = ?",
      ).get(sha256(token));
      if (!t) throw notFound("This invite link isn't valid any more. Ask the trip's owner for a new one.");
      return {
        tripId: String(t.id),
        title: String(t.title),
        destination: String(t.destination),
        startDate: String(t.start_date),
        endDate: String(t.end_date),
        ownerName: String(t.owner),
        alreadyMember: roleOf(String(t.id), userId) !== null,
      };
    },

    acceptInvite(userId: string, token: unknown): string {
      const preview = store.previewInvite(userId, token);
      if (!preview.alreadyMember) {
        mutate(preview.tripId, userId, () =>
          q("insert into trip_members (trip_id, user_id, role, joined_at) values (?, ?, 'collaborator', ?)").run(preview.tripId, userId, now()),
        );
      }
      return preview.tripId;
    },

    // The owner can remove a collaborator; a collaborator can remove themself.
    removeMember(userId: string, tripId: string, memberId: string): void {
      const role = requireMember(tripId, userId);
      if (memberId !== userId && role !== "owner") throw new HttpError(403, "Only the trip's owner can remove people.");
      const target = roleOf(tripId, memberId);
      if (!target) throw notFound("That person isn't on this trip.");
      if (target === "owner") throw bad("The owner can't be removed from their own trip.");
      mutate(tripId, userId, () => q("delete from trip_members where trip_id = ? and user_id = ?").run(tripId, memberId));
    },

    // --- itinerary ---

    // clientId makes adding idempotent: a retried request (a double click, a
    // reconnect replaying a POST) finds the activity it already created.
    addActivity(userId: string, tripId: string, input: Row): { created: boolean; activityId: string; trip: TripSnapshot } {
      requireMember(tripId, userId);
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
      const id = randomUUID();

      const trip = mutate(tripId, userId, () => {
        const count = Number((q("select count(*) as n from activities where day_id = ?").get(day.id) as Row).n);
        const at = Number.isInteger(input.index) ? Math.max(0, Math.min(count, input.index as number)) : count;
        q("update activities set position = position + 1 where day_id = ? and position >= ?").run(day.id, at);
        q(
          `insert into activities (id, trip_id, day_id, client_id, position, title, kind, start_min, duration_min, notes,
                                   place_id, place_source, lat, lng, place_cached_at, created_by, updated_by, updated_at)
           values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        ).run(
          id, tripId, day.id, clientId, at, title, k, start, dur, notes,
          place?.placeId ?? null, place?.source ?? null, place?.lat ?? null, place?.lng ?? null, place ? now() : null,
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
      if (input.baseVersion !== cur.version) {
        throw new HttpError(409, "Someone else changed this activity while you were editing.", { current: cur });
      }
      const next = {
        title: input.title === undefined ? cur.title : text(input.title, "Title", 120),
        kind: input.kind === undefined ? cur.kind : kind(input.kind),
        startMin: input.startMin === undefined ? cur.startMin : startMinute(input.startMin),
        durationMin: input.durationMin === undefined ? cur.durationMin : duration(input.durationMin),
        notes: input.notes === undefined ? cur.notes : text(input.notes, "Notes", 2000, 0),
      };
      return mutate(tripId, userId, () => {
        q(
          "update activities set title = ?, kind = ?, start_min = ?, duration_min = ?, notes = ?, version = version + 1, updated_by = ?, updated_at = ? where id = ?",
        ).run(next.title, next.kind, next.startMin, next.durationMin, next.notes, userId, now(), activityId);
        return snapshot(tripId);
      });
    },

    // Moves don't need a version: the server places the activity at the
    // requested index among whatever the day holds right now.
    moveActivity(userId: string, tripId: string, activityId: string, input: Row): TripSnapshot {
      requireMember(tripId, userId);
      const cur = getActivity(tripId, activityId);
      const day = getDay(tripId, input.dayId ?? cur.dayId);
      if (!Number.isInteger(input.index)) throw bad("Say where to move it (index).");
      return mutate(tripId, userId, () => {
        const ids = q("select id from activities where day_id = ? and id != ? order by position, id")
          .all(day.id, activityId)
          .map((r) => String(r.id));
        const at = Math.max(0, Math.min(ids.length, input.index as number));
        ids.splice(at, 0, activityId);
        q("update activities set day_id = ?, updated_at = ? where id = ?").run(day.id, now(), activityId);
        const set = q("update activities set position = ? where id = ?");
        ids.forEach((id, i) => set.run(i, id));
        if (day.id !== cur.dayId) renumber(cur.dayId);
        return snapshot(tripId);
      });
    },

    deleteActivity(userId: string, tripId: string, activityId: string): TripSnapshot {
      requireMember(tripId, userId);
      const cur = getActivity(tripId, activityId);
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
      requireMember(tripId, userId);
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
      requireMember(tripId, userId);
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
      requireMember(tripId, userId);
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
    applyProposal(userId: string, tripId: string, dayId: unknown, proposalId: unknown): TripSnapshot {
      requireMember(tripId, userId);
      const day = snapshot(tripId).days.find((d) => d.id === dayId);
      if (!day) throw notFound("That day isn't part of this trip.");
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
