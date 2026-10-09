import type { DatabaseSync } from "node:sqlite";
import { CURATED, CURATED_VERSION, type Category, DESTINATIONS } from "./curated.ts";
import { transaction } from "./db.ts";
import { bad, notFound } from "./errors.ts";
import { haversineKm, type LatLng } from "./geo.ts";

// The recommendation layer. Google Places finds places; it doesn't know
// itineraries. These are Wayline's own templates, ranked by geographic
// distance from whatever point the visitor is exploring from.

export const CATEGORIES: Category[] = ["half-day", "one-day", "weekend", "food-culture", "nature-outdoors", "city-highlights"];
const RETRY_LOOKUP_MS = 7 * 86_400_000;

export type TemplateSummary = {
  id: string;
  title: string;
  destination: string;
  description: string;
  categories: Category[];
  days: number;
  durationMin: number;
  stopCount: number;
  ref: LatLng;
  source: "curated" | "user";
  featured: boolean;
  distanceKm?: number;
};

export type TemplateStop = {
  id: string;
  day: number;
  position: number;
  title: string;
  kind: string;
  startMin: number | null;
  durationMin: number;
  note: string;
  lat: number;
  lng: number;
  placeId: string | null;
  placeQuery: string | null;
};

export type TemplateDetail = TemplateSummary & { timezone: string; stops: TemplateStop[] };

const toMin = (hhmm: string): number => {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
};

export function parseCategory(v: unknown): Category | null {
  if (v === undefined || v === null || v === "" || v === "all") return null;
  if (!CATEGORIES.includes(v as Category)) throw bad(`Category must be one of: ${CATEGORIES.join(", ")}.`);
  return v as Category;
}

export function createItineraryStore(db: DatabaseSync, now = () => Date.now()) {
  const q = (sql: string) => db.prepare(sql);

  // Loads curated content into the database: new templates are inserted,
  // changed ones (a higher CURATED_VERSION) are rewritten, keeping any place
  // id already verified for a stop whose query hasn't changed.
  function seed(): void {
    transaction(db, () => {
      for (const c of CURATED) {
        const id = `tpl-${c.slug}`;
        const row = q("select content_version from itinerary_templates where id = ?").get(id);
        if (row && Number(row.content_version) >= CURATED_VERSION) continue;
        const kept = new Map<string, string>();
        for (const s of q("select place_query, place_id from itinerary_template_stops where template_id = ? and place_id is not null").all(id)) {
          kept.set(String(s.place_query), String(s.place_id));
        }
        q("delete from itinerary_templates where id = ?").run(id);
        q(
          `insert into itinerary_templates (id, title, destination, description, timezone, ref_lat, ref_lng, days, categories, source, visibility, featured, content_version, created_at, updated_at)
           values (?, ?, ?, ?, ?, ?, ?, ?, ?, 'curated', 'public', ?, ?, ?, ?)`,
        ).run(id, c.title, c.destination, c.description, c.timezone, c.ref[0], c.ref[1], c.days, JSON.stringify(c.categories), c.featured ? 1 : 0, CURATED_VERSION, now(), now());
        const perDay = new Map<number, number>();
        c.stops.forEach((s, i) => {
          const day = s.day ?? 1;
          const position = perDay.get(day) ?? 0;
          perDay.set(day, position + 1);
          q(
            `insert into itinerary_template_stops (id, template_id, day, position, title, kind, start_min, duration_min, note, lat, lng, place_query, place_id)
             values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          ).run(`${id}-s${i + 1}`, id, day, position, s.title, s.kind, toMin(s.start), s.minutes, s.note ?? "", s.lat, s.lng, s.query, kept.get(s.query) ?? null);
        });
      }
    });
  }

  function stopsOf(templateId: string): TemplateStop[] {
    return q("select * from itinerary_template_stops where template_id = ? order by day, position").all(templateId).map((r) => ({
      id: String(r.id),
      day: Number(r.day),
      position: Number(r.position),
      title: String(r.title),
      kind: String(r.kind),
      startMin: r.start_min === null ? null : Number(r.start_min),
      durationMin: Number(r.duration_min),
      note: String(r.note),
      lat: Number(r.lat),
      lng: Number(r.lng),
      placeId: r.place_id === null ? null : String(r.place_id),
      placeQuery: r.place_query === null ? null : String(r.place_query),
    }));
  }

  // Estimated time: for each day, first start to last end.
  function duration(stops: TemplateStop[]): number {
    const byDay = new Map<number, TemplateStop[]>();
    for (const s of stops) byDay.set(s.day, [...(byDay.get(s.day) ?? []), s]);
    let total = 0;
    for (const list of byDay.values()) {
      const timed = list.filter((s) => s.startMin !== null);
      if (!timed.length) total += list.reduce((n, s) => n + s.durationMin, 0);
      else total += Math.max(...timed.map((s) => (s.startMin as number) + s.durationMin)) - Math.min(...timed.map((s) => s.startMin as number));
    }
    return total;
  }

  function summary(r: Record<string, unknown>, stops = stopsOf(String(r.id))): TemplateSummary {
    return {
      id: String(r.id),
      title: String(r.title),
      destination: String(r.destination),
      description: String(r.description),
      categories: JSON.parse(String(r.categories)) as Category[],
      days: Number(r.days),
      durationMin: duration(stops),
      stopCount: stops.length,
      ref: { lat: Number(r.ref_lat), lng: Number(r.ref_lng) },
      source: r.source as "curated" | "user",
      featured: Number(r.featured) === 1,
    };
  }

  const publicRows = () => q("select * from itinerary_templates where visibility = 'public' order by featured desc, title").all();

  return {
    seed,

    // Within radiusKm of the origin, measured to the template's reference
    // point or any of its stops, whichever is nearer, so an itinerary that
    // starts just across a boundary still counts as close.
    nearby(origin: LatLng, opts: { radiusKm: number; category: Category | null; limit: number }): TemplateSummary[] {
      const out: TemplateSummary[] = [];
      for (const r of publicRows()) {
        const stops = stopsOf(String(r.id));
        const s = summary(r, stops);
        if (opts.category && !s.categories.includes(opts.category)) continue;
        const d = Math.min(haversineKm(origin, s.ref), ...stops.map((x) => haversineKm(origin, x)));
        if (d <= opts.radiusKm) out.push({ ...s, distanceKm: Math.round(d * 10) / 10 });
      }
      return out
        .sort((a, b) => (a.distanceKm as number) - (b.distanceKm as number) || Number(b.featured) - Number(a.featured))
        .slice(0, opts.limit);
    },

    featured(opts: { category: Category | null; limit: number }): TemplateSummary[] {
      return publicRows()
        .map((r) => summary(r))
        .filter((s) => (opts.category ? s.categories.includes(opts.category) : s.featured))
        .slice(0, opts.limit);
    },

    all(category: Category | null): TemplateSummary[] {
      return publicRows()
        .map((r) => summary(r))
        .filter((s) => !category || s.categories.includes(category));
    },

    destinations() {
      const all = publicRows().map((r) => summary(r));
      return DESTINATIONS.map((d) => ({
        ...d,
        itineraries: all.filter((s) => haversineKm(d, s.ref) <= 150).length,
      }));
    },

    get(id: unknown): TemplateDetail {
      const r = typeof id === "string" ? q("select * from itinerary_templates where id = ? and visibility in ('public', 'unlisted')").get(id) : undefined;
      if (!r) throw notFound("That itinerary doesn't exist.");
      const stops = stopsOf(String(r.id));
      return { ...summary(r, stops), timezone: String(r.timezone), stops };
    },

    // Stops still without a Google place id that are due a lookup: never
    // tried, or tried more than a week ago without a match.
    unverifiedStops(id: string): TemplateStop[] {
      return q("select id from itinerary_template_stops where template_id = ? and place_id is null and place_query is not null and (place_checked_at is null or place_checked_at < ?)")
        .all(id, now() - RETRY_LOOKUP_MS)
        .map((r) => String(r.id))
        .map((sid) => stopsOf(id).find((s) => s.id === sid) as TemplateStop);
    },

    recordLookup(stopId: string, placeId: string | null): void {
      q("update itinerary_template_stops set place_id = coalesce(?, place_id), place_checked_at = ? where id = ?").run(placeId, now(), stopId);
    },
  };
}

export type ItineraryStore = ReturnType<typeof createItineraryStore>;
