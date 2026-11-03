import type { DatabaseSync } from "node:sqlite";
import { AREAS, CURATED, CURATED_VERSION, type Category, DESTINATIONS, FOOD_STYLE_OF, type FoodStyle } from "./curated.ts";
import { DESTINATIONS_ZH, ITINERARIES_ZH, type ItineraryZh } from "./curated-zh.ts";
import { transaction } from "./db.ts";
import { bad, notFound } from "./errors.ts";
import { haversineKm, type LatLng } from "./geo.ts";
import { requestLang } from "./lang.ts";

// Curated content in the request's language (November 2026): the database
// keeps the English; the Chinese from curated-zh.ts is laid over what's read,
// at read time only. Matching keeps using the English keys (ids, queries,
// areas, countries); only the text shown changes. A copy into a trip goes
// through get(), so it takes the language served at copy time.
function zhOf(templateId: string): ItineraryZh | null {
  if (requestLang() !== "zh" || !templateId.startsWith("tpl-")) return null;
  return ITINERARIES_ZH[templateId.slice(4)] ?? null;
}

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
  // the curated city it belongs to (nearest within 150 km), for browsing by region
  destinationId: string | null;
  country: string | null;
  area: string | null;
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

// --- trip discovery ---

// how far from the chosen destination an itinerary may be (as for "near you")
const MATCH_RADIUS_KM = 150;
// a wished-for place counts as in a plan only when one of its stops is this
// close (or is the same Google place); the answer names that stop and the
// distance, so a neighbouring sight is never passed off as the one asked for
const SAME_PLACE_KM = 0.25;

export type WantedPlace = LatLng & { placeId: string | null };
export type MatchInput = { origin: LatLng | null; places: WantedPlace[]; food: FoodStyle[]; days: number | null };
export type Match = {
  // per wished-for place, by its index in the request: the stop that is it
  places: { want: number; stop: string; day: number; km: number }[];
  // the rest: how far the plan's nearest stop is
  missing: { want: number; nearestKm: number }[];
  // each asked-for food style the plan has, with the stops that have it
  food: { style: FoodStyle; stops: string[] }[];
  duration: { want: number; days: number; fit: "exact" | "shorter" | "longer" } | null;
  // how many of the stated wishes it meets at all, and whether it meets all of them
  met: number;
  complete: boolean;
  score: number;
};

function matchOne(stops: TemplateStop[], days: number, want: MatchInput): Match {
  const places: Match["places"] = [];
  const missing: Match["missing"] = [];
  want.places.forEach((w, i) => {
    let best: { s: TemplateStop; km: number } | null = null;
    for (const s of stops) {
      const km = w.placeId && s.placeId === w.placeId ? 0 : haversineKm(w, s);
      if (!best || km < best.km) best = { s, km };
    }
    if (best && best.km <= SAME_PLACE_KM) places.push({ want: i, stop: best.s.title, day: best.s.day, km: Math.round(best.km * 1000) / 1000 });
    else missing.push({ want: i, nearestKm: best ? Math.round(best.km * 10) / 10 : Infinity });
  });
  const food = want.food
    .map((style) => ({ style, stops: [...new Set(stops.filter((s) => s.kind === "food" && s.placeQuery && FOOD_STYLE_OF[s.placeQuery]?.includes(style)).map((s) => s.title))] }))
    .filter((f) => f.stops.length > 0);
  // 4 stands for "4–5 days": anything shorter is a start, not the whole trip
  const duration = want.days === null ? null : { want: want.days, days, fit: days === want.days ? ("exact" as const) : days < want.days ? ("shorter" as const) : ("longer" as const) };
  const met = (places.length > 0 ? 1 : 0) + (food.length > 0 ? 1 : 0) + (duration?.fit === "exact" ? 1 : 0);
  const complete = places.length === want.places.length && (want.food.length === 0 || food.length > 0) && (duration === null || duration.fit === "exact");
  // places weigh most, then length, then food; a wished-for place that's
  // missing still counts a little when the plan passes close to it
  const coherence = missing.reduce((n, m) => n + Math.max(0, 1 - m.nearestKm / 5) * 0.5, 0);
  const lengthScore = !duration ? 0 : duration.fit === "exact" ? 2 : Math.abs(days - duration.want) === 1 ? 1 : 0;
  const score = places.length * 3 + lengthScore + food.length + coherence;
  return { places, missing, food, duration, met, complete, score: Math.round(score * 100) / 100 };
}

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
    const zh = zhOf(templateId);
    return q("select * from itinerary_template_stops where template_id = ? order by day, position").all(templateId).map((r) => ({
      id: String(r.id),
      day: Number(r.day),
      position: Number(r.position),
      title: zh?.stops[String(r.title)] ?? String(r.title),
      kind: String(r.kind),
      startMin: r.start_min === null ? null : Number(r.start_min),
      durationMin: Number(r.duration_min),
      note: (r.note ? zh?.notes?.[String(r.note)] : undefined) ?? String(r.note),
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

  // the curated city an itinerary belongs to: the nearest within 150 km
  function cityOf(ref: LatLng) {
    const near = DESTINATIONS.map((d) => ({ d, km: haversineKm(d, ref) })).sort((a, b) => a.km - b.km)[0];
    return near && near.km <= 150 ? near.d : null;
  }

  function summary(r: Record<string, unknown>, stops = stopsOf(String(r.id))): TemplateSummary {
    const city = cityOf({ lat: Number(r.ref_lat), lng: Number(r.ref_lng) });
    const zh = r.source === "curated" ? zhOf(String(r.id)) : null;
    return {
      id: String(r.id),
      title: zh?.title ?? String(r.title),
      destination: zh?.destination ?? String(r.destination),
      description: zh?.description ?? String(r.description),
      categories: JSON.parse(String(r.categories)) as Category[],
      days: Number(r.days),
      durationMin: duration(stops),
      stopCount: stops.length,
      ref: { lat: Number(r.ref_lat), lng: Number(r.ref_lng) },
      source: r.source as "curated" | "user",
      featured: Number(r.featured) === 1,
      destinationId: city?.id ?? null,
      country: city?.country ?? null,
      area: city?.area ?? null,
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
      return DESTINATIONS.map((d) => {
        const mine = all.filter((s) => s.destinationId === d.id);
        const zh = requestLang() === "zh" ? DESTINATIONS_ZH[d.id] : undefined;
        return { ...d, ...(zh ?? {}), itineraries: mine.length, days: mine.length ? Math.max(...mine.map((s) => s.days)) : 0 };
      });
    },

    // The places curated itineraries visit around a destination (not their
    // meals), one per search query, for the discovery panel to offer.
    highlights(origin: LatLng): { title: string; lat: number; lng: number; plans: number }[] {
      const seen = new Map<string, { title: string; lat: number; lng: number; plans: number }>();
      for (const r of publicRows()) {
        if (r.source !== "curated") continue;
        const stops = stopsOf(String(r.id));
        if (Math.min(haversineKm(origin, { lat: Number(r.ref_lat), lng: Number(r.ref_lng) }), ...stops.map((s) => haversineKm(origin, s))) > MATCH_RADIUS_KM) continue;
        for (const s of stops) {
          if (s.kind === "food" || !s.placeQuery) continue;
          const had = seen.get(s.placeQuery);
          if (had) had.plans += 1;
          else seen.set(s.placeQuery, { title: s.title, lat: s.lat, lng: s.lng, plans: 1 });
        }
      }
      return [...seen.values()].sort((a, b) => b.plans - a.plans || a.title.localeCompare(b.title)).slice(0, 24);
    },

    // Trip discovery: retrieves the curated itineraries for a destination
    // (a hard limit, by distance), then ranks them by the places, food and
    // length the visitor asked for (soft). Everything reported is read from
    // the itinerary's own stops; nothing is generated, and a plan that meets
    // none of the stated wishes is left out rather than padded in.
    match(want: MatchInput): { inArea: number; results: (TemplateSummary & { match: Match })[] } {
      const inArea: { s: TemplateSummary; stops: TemplateStop[] }[] = [];
      for (const r of publicRows()) {
        if (r.source !== "curated") continue;
        const stops = stopsOf(String(r.id));
        const s = summary(r, stops);
        if (want.origin && Math.min(haversineKm(want.origin, s.ref), ...stops.map((x) => haversineKm(want.origin as LatLng, x))) > MATCH_RADIUS_KM) continue;
        inArea.push({ s, stops });
      }
      const asked = want.places.length > 0 || want.food.length > 0 || want.days !== null;
      const results = inArea
        .map(({ s, stops }) => ({ ...s, match: matchOne(stops, s.days, want) }))
        .filter((t) => !asked || t.match.met > 0)
        .sort((a, b) => b.match.score - a.match.score || Number(b.featured) - Number(a.featured) || a.title.localeCompare(b.title));
      return { inArea: inArea.length, results };
    },

    // regions in display order, each with its countries, for the homepage filter
    areas() {
      return AREAS.map((area) => ({ area, countries: [...new Set(DESTINATIONS.filter((d) => d.area === area).map((d) => d.country))] }));
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
