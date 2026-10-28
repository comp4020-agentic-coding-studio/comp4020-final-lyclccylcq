import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { transaction } from "./db.ts";
import { bad, HttpError, notFound } from "./errors.ts";
import type { LatLng } from "./geo.ts";
import type { TemplateDetail, TemplateStop, TemplateSummary } from "./itineraries.ts";
import { type ForkStop, isFresh, type TripSnapshot, type TripStore } from "./trips.ts";

// Published trips (docs/permissions.md). A publication is a snapshot of an
// owner's trip, taken when they publish or republish; editing the working
// trip never changes it. One publication per trip, with a stable id
// (`pub-…`), so its reviews survive republishing and unpublishing. Anyone can
// read a published one; nobody edits it except by republishing the trip.

const DESCRIPTION_MAX = 600;
const COMMENT_MAX = 1000;

export type Review = { id: string; rating: number; comment: string; createdAt: number; updatedAt: number; author: { id: string; displayName: string }; mine: boolean };
export type PublicationDetail = TemplateDetail & {
  author: { id: string | null; displayName: string };
  publishedAt: number;
  firstPublishedAt: number;
  cover: string | null;
  status: "published" | "unpublished";
  mine: boolean;
  rating: { average: number | null; count: number };
  reviews: Review[];
  myReview: Review | null;
};

const text = (v: unknown, field: string, max: number, min = 0): string => {
  if (v === undefined || v === null) v = "";
  if (typeof v !== "string") throw bad(`${field} must be text.`);
  const s = v.trim();
  if (s.length < min) throw bad(`${field} is required.`);
  if (s.length > max) throw bad(`${field} is too long (max ${max} characters).`);
  return s;
};

export function createPublications(db: DatabaseSync, trips: TripStore, now = () => Date.now()) {
  const q = (sql: string) => db.prepare(sql);
  const isPub = (id: unknown): id is string => typeof id === "string" && /^pub-[0-9a-f-]{36}$/.test(id);

  // Published ones for everyone; an unpublished one only for its author.
  function row(id: unknown, viewerId: string | null): Record<string, unknown> {
    const r = isPub(id) ? q("select p.*, u.display_name as author_name from trip_publications p left join users u on u.id = p.author_id where p.id = ?").get(id) : undefined;
    if (!r || (r.status !== "published" && (viewerId === null || r.author_id !== viewerId))) throw notFound("That itinerary doesn't exist.");
    return r;
  }

  function stopsOf(pubId: string): (TemplateStop & ForkStop)[] {
    return q("select * from publication_stops where publication_id = ? order by day, position").all(pubId).map((r) => {
      const fresh = r.place_source === "custom" || isFresh(r.cached_at, now());
      const lat = fresh && r.lat !== null ? Number(r.lat) : null;
      const lng = fresh && r.lng !== null ? Number(r.lng) : null;
      return {
        id: String(r.id),
        day: Number(r.day),
        position: Number(r.position),
        title: String(r.title),
        kind: String(r.kind),
        startMin: r.start_min === null ? null : Number(r.start_min),
        durationMin: Number(r.duration_min),
        note: "",
        meal: r.meal === null ? null : String(r.meal),
        role: r.role === null ? null : String(r.role),
        // the preview's map needs numbers; a stop whose copy expired has none
        lat: lat as number,
        lng: lng as number,
        placeId: r.place_source === "google" ? String(r.place_id) : null,
        placeQuery: null,
        placeSource: r.place_source === null ? null : String(r.place_source),
        cachedAt: r.cached_at === null ? null : Number(r.cached_at),
      };
    });
  }

  function rating(pubId: string): { average: number | null; count: number } {
    const r = q("select avg(rating) as a, count(*) as n from trip_reviews where publication_id = ?").get(pubId) as Record<string, unknown>;
    const n = Number(r.n);
    return { average: n ? Math.round(Number(r.a) * 10) / 10 : null, count: n };
  }

  function reviewsOf(pubId: string, viewerId: string | null): Review[] {
    return q("select r.*, u.display_name from trip_reviews r join users u on u.id = r.user_id where r.publication_id = ? order by r.updated_at desc limit 100").all(pubId).map((r) => ({
      id: String(r.id),
      rating: Number(r.rating),
      comment: String(r.comment),
      createdAt: Number(r.created_at),
      updatedAt: Number(r.updated_at),
      author: { id: String(r.user_id), displayName: String(r.display_name) },
      mine: viewerId !== null && String(r.user_id) === viewerId,
    }));
  }

  function duration(stops: { day: number; startMin: number | null; durationMin: number }[]): number {
    const byDay = new Map<number, typeof stops>();
    for (const s of stops) byDay.set(s.day, [...(byDay.get(s.day) ?? []), s]);
    let total = 0;
    for (const list of byDay.values()) {
      const timed = list.filter((s) => s.startMin !== null);
      if (!timed.length) total += list.reduce((n, s) => n + s.durationMin, 0);
      else total += Math.max(...timed.map((s) => (s.startMin as number) + s.durationMin)) - Math.min(...timed.map((s) => s.startMin as number));
    }
    return total;
  }

  function refOf(r: Record<string, unknown>, stops: { lat: number | null; lng: number | null }[]): LatLng | null {
    if (r.ref_lat !== null && isFresh(r.ref_cached_at, now())) return { lat: Number(r.ref_lat), lng: Number(r.ref_lng) };
    const s = stops.find((x) => x.lat !== null && x.lng !== null);
    return s ? { lat: s.lat as number, lng: s.lng as number } : null;
  }

  function summary(r: Record<string, unknown>, stops = stopsOf(String(r.id))): TemplateSummary & { author: string; cover: string | null; rating: { average: number | null; count: number }; publishedAt: number } {
    return {
      id: String(r.id),
      title: String(r.title),
      destination: String(r.destination),
      description: String(r.description),
      categories: [],
      days: Number(r.days),
      durationMin: duration(stops),
      stopCount: stops.length,
      ref: refOf(r, stops) ?? { lat: 0, lng: 0 },
      source: "user",
      featured: false,
      // published trips stay out of the curated region browsing
      destinationId: null,
      country: null,
      area: null,
      author: r.author_name === null || r.author_name === undefined ? "a former Wayline user" : String(r.author_name),
      cover: r.cover === null ? null : String(r.cover),
      rating: rating(String(r.id)),
      publishedAt: Number(r.published_at),
    };
  }

  // Writes the trip's current plan into its publication, creating it the
  // first time. The publication id, its first-published time and its reviews
  // are kept; the stops are replaced.
  function snapshotInto(userId: string, tripId: string, description: string): { id: string; republished: boolean } {
    const data = trips.publishable(userId, tripId);
    if (!data.stops.some((s) => s.role !== "start")) throw new HttpError(400, "Add at least one stop besides the starting point before publishing.", { code: "empty" });
    const existing = q("select id from trip_publications where trip_id = ?").get(tripId);
    const id = existing ? String(existing.id) : `pub-${randomUUID()}`;
    const t = now();
    transaction(db, () => {
      if (existing) {
        q(
          "update trip_publications set author_id = ?, title = ?, description = ?, destination = ?, timezone = ?, days = ?, cover = ?, ref_lat = ?, ref_lng = ?, ref_cached_at = ?, status = 'published', published_at = ?, trip_rev = ? where id = ?",
        ).run(userId, data.title, description, data.destination, data.timezone, data.days, data.cover, data.ref?.lat ?? null, data.ref?.lng ?? null, data.ref?.cachedAt ?? null, t, data.rev, id);
        q("delete from publication_stops where publication_id = ?").run(id);
      } else {
        q(
          `insert into trip_publications (id, trip_id, author_id, title, description, destination, timezone, days, cover, ref_lat, ref_lng, ref_cached_at, status, first_published_at, published_at, trip_rev)
           values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'published', ?, ?, ?)`,
        ).run(id, tripId, userId, data.title, description, data.destination, data.timezone, data.days, data.cover, data.ref?.lat ?? null, data.ref?.lng ?? null, data.ref?.cachedAt ?? null, t, t, data.rev);
      }
      const ins = q(
        `insert into publication_stops (id, publication_id, day, position, title, kind, start_min, duration_min, meal, role, place_id, place_source, lat, lng, cached_at)
         values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      );
      for (const s of data.stops) {
        // demo and curated-only places carry no real place to share; keep their coordinates as the author's approximation
        ins.run(randomUUID(), id, s.day, s.position, s.title, s.kind, s.startMin, s.durationMin, s.meal, s.role, s.placeId, s.placeSource, s.lat, s.lng, s.cachedAt);
      }
    });
    return { id, republished: Boolean(existing) };
  }

  return {
    isPub,

    // The owner's view of their trip's publication (for the editor).
    forTrip(userId: string, tripId: string) {
      trips.require(tripId, userId, "publish");
      const r = q("select p.*, u.display_name as author_name from trip_publications p left join users u on u.id = p.author_id where p.trip_id = ?").get(tripId);
      return r ? { ...summary(r), status: String(r.status), tripRev: Number(r.trip_rev) } : null;
    },

    publish(userId: string, tripId: string, input: Record<string, unknown>): { id: string; republished: boolean } {
      trips.require(tripId, userId, "publish");
      const description = text(input.description, "Description", DESCRIPTION_MAX, 1);
      return snapshotInto(userId, tripId, description);
    },

    // Taken out of discovery; reading it and new forks stop. The row, its
    // reviews and every existing fork stay.
    unpublish(userId: string, tripId: string): { id: string } {
      trips.require(tripId, userId, "publish");
      const r = q("update trip_publications set status = 'unpublished' where trip_id = ? and status = 'published' returning id").get(tripId);
      if (!r) throw new HttpError(409, "This trip isn't published.");
      return { id: String(r.id) };
    },

    list(): ReturnType<typeof summary>[] {
      return q("select p.*, u.display_name as author_name from trip_publications p left join users u on u.id = p.author_id where p.status = 'published' order by p.published_at desc limit 60")
        .all()
        .map((r) => summary(r))
        .filter((s) => s.stopCount > 0);
    },

    get(id: unknown, viewerId: string | null): PublicationDetail {
      const r = row(id, viewerId);
      const stops = stopsOf(String(r.id));
      const reviews = reviewsOf(String(r.id), viewerId);
      return {
        ...summary(r, stops),
        timezone: String(r.timezone),
        stops,
        author: { id: r.author_id === null ? null : String(r.author_id), displayName: r.author_name === null || r.author_name === undefined ? "a former Wayline user" : String(r.author_name) },
        firstPublishedAt: Number(r.first_published_at),
        status: r.status as "published" | "unpublished",
        mine: viewerId !== null && r.author_id === viewerId,
        reviews,
        myReview: reviews.find((x) => x.mine) ?? null,
      };
    },

    // "Use This Template": a new private trip from the published snapshot.
    fork(userId: string, id: unknown, input: Record<string, unknown>): TripSnapshot {
      const r = row(id, null); // published only: unpublished can't be forked, even by its author
      const stops = stopsOf(String(r.id));
      const hasRef = r.ref_lat !== null && isFresh(r.ref_cached_at, now());
      return trips.createFork(
        userId,
        {
          id: String(r.id),
          title: String(r.title),
          destination: String(r.destination),
          timezone: String(r.timezone),
          days: Number(r.days),
          author: r.author_name === null || r.author_name === undefined ? null : String(r.author_name),
          cover: r.cover === null ? null : String(r.cover),
          ref: hasRef ? { lat: Number(r.ref_lat), lng: Number(r.ref_lng), cachedAt: Number(r.ref_cached_at) } : null,
          stops,
        },
        input,
      );
    },

    // One review per person per publication, from the session's user only;
    // a second submission edits the first. Authors can't review their own.
    review(userId: string, id: unknown, input: Record<string, unknown>): { review: Review; created: boolean; publicationId: string } {
      const r = row(id, null);
      if (r.author_id === userId) throw new HttpError(403, "You can't review your own trip.", { code: "own" });
      const value = input.rating;
      if (!Number.isInteger(value) || (value as number) < 1 || (value as number) > 5) throw bad("Rating must be a whole number from 1 to 5.");
      const comment = text(input.comment, "Review", COMMENT_MAX);
      const pubId = String(r.id);
      const t = now();
      const existing = q("select id from trip_reviews where publication_id = ? and user_id = ?").get(pubId, userId);
      if (existing) {
        q("update trip_reviews set rating = ?, comment = ?, updated_at = ? where id = ?").run(value as number, comment, t, String(existing.id));
      } else {
        q("insert into trip_reviews (id, publication_id, user_id, rating, comment, created_at, updated_at) values (?, ?, ?, ?, ?, ?, ?) on conflict (publication_id, user_id) do update set rating = excluded.rating, comment = excluded.comment, updated_at = excluded.updated_at").run(
          randomUUID(), pubId, userId, value as number, comment, t, t,
        );
      }
      const review = reviewsOf(pubId, userId).find((x) => x.mine) as Review;
      return { review, created: !existing, publicationId: pubId };
    },

    // Only the review's author may delete it: someone else's review answers
    // 404 (it isn't theirs to see as deletable).
    deleteReview(userId: string, id: unknown, reviewId: string): { publicationId: string } {
      const r = isPub(id) ? q("select id from trip_publications where id = ?").get(id) : undefined;
      if (!r) throw notFound("That itinerary doesn't exist.");
      const rev = q("select user_id from trip_reviews where id = ? and publication_id = ?").get(reviewId, String(r.id));
      if (!rev) throw notFound("That review doesn't exist.");
      if (String(rev.user_id) !== userId) throw new HttpError(403, "You can only delete your own review.");
      q("delete from trip_reviews where id = ?").run(reviewId);
      return { publicationId: String(r.id) };
    },
  };
}

export type Publications = ReturnType<typeof createPublications>;
