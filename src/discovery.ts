import { log, sanitize } from "./log.ts";
import type { IncomingMessage } from "node:http";
import type { User } from "./auth.ts";
import { bad, HttpError } from "./errors.ts";
import { coarse, type LatLng, parseBounded, parseLatLng } from "./geo.ts";
import {
  autocomplete,
  computeRoute,
  googleConfigured,
  nearbyPlaces,
  photoUri,
  placeBasic,
  placeDetails,
  placeGuide,
  resolvePlace,
  reverseGeocode,
  SEARCH_TYPES,
  searchPlaces,
  type Waypoint,
} from "./google.ts";
import { FOOD_STYLES, type FoodStyle } from "./curated.ts";
import { type ItineraryStore, type MatchInput, parseCategory } from "./itineraries.ts";
import { clientIp, createLimiter } from "./ratelimit.ts";
import { type Mode, MODES } from "./schedule.ts";
import type { Publications } from "./publications.ts";
import type { TripStore } from "./trips.ts";

// The public discovery API behind the homepage: curated itineraries ranked
// by distance, and the Google-backed place, area and route lookups. Anyone
// may browse; the endpoints that spend Google quota are limited per visitor.
// Visitors' coordinates are used for the request and never stored or logged.

type Result = { status: number; data: unknown };

const sessionToken = (v: string | null): string | null => {
  if (v === null || v === "") return null;
  if (!/^[A-Za-z0-9-]{8,64}$/.test(v)) throw bad("Invalid session token.");
  return v;
};

function waypointInput(v: unknown, field: string): Waypoint {
  if (!v || typeof v !== "object") throw bad(`${field} is required.`);
  const w = v as Record<string, unknown>;
  if (typeof w.placeId === "string") {
    if (!/^[A-Za-z0-9_-]{10,300}$/.test(w.placeId)) throw bad(`${field}: that isn't a Google place id.`);
    return { placeId: w.placeId };
  }
  return parseLatLng(w.lat, w.lng);
}

// What the discovery panel sends: a destination (optional), up to eight
// places, food styles, and a length in days (4 stands for "4–5 days").
function matchInput(v: Record<string, unknown>): MatchInput {
  const origin = v.origin === undefined || v.origin === null ? null : waypointLatLng(v.origin, "origin");
  if (v.places !== undefined && !Array.isArray(v.places)) throw bad("places must be a list.");
  const rawPlaces = (v.places ?? []) as unknown[];
  if (rawPlaces.length > 8) throw bad("Choose at most eight places.");
  const places = rawPlaces.map((x, i) => {
    const at = waypointLatLng(x, `places[${i}]`);
    const id = (x as Record<string, unknown>).placeId;
    if (id !== undefined && id !== null && (typeof id !== "string" || !/^[A-Za-z0-9_:-]{3,300}$/.test(id))) throw bad(`places[${i}]: that isn't a place id.`);
    return { ...at, placeId: typeof id === "string" ? id : null };
  });
  if (v.food !== undefined && !Array.isArray(v.food)) throw bad("food must be a list.");
  const food = [...new Set((v.food ?? []) as unknown[])].map((f) => {
    if (!FOOD_STYLES.includes(f as FoodStyle)) throw bad(`food must be some of: ${FOOD_STYLES.join(", ")}.`);
    return f as FoodStyle;
  });
  const days = v.days === undefined || v.days === null ? null : Number(v.days);
  if (days !== null && (!Number.isInteger(days) || days < 1 || days > 4)) throw bad("days must be 1, 2, 3 or 4.");
  if (!origin && !places.length) throw bad("Choose a destination or at least one place.");
  return { origin, places, food, days };
}

function waypointLatLng(v: unknown, field: string) {
  if (!v || typeof v !== "object") throw bad(`${field} is required.`);
  const w = v as Record<string, unknown>;
  return parseLatLng(w.lat, w.lng);
}

export function createDiscovery(deps: { itineraries: ItineraryStore; trips: TripStore; publications: Publications }) {
  const { itineraries, trips, publications } = deps;
  const placesLimit = createLimiter(60, 60_000);
  const routesLimit = createLimiter(30, 60_000);
  const verifying = new Map<string, Promise<void>>();
  // Identical route questions within ten minutes get the same answer
  // without another call; kept in memory only.
  const routeCache = new Map<string, { at: number; data: unknown }>();
  const routeInflight = new Map<string, Promise<unknown>>();

  // Looks up Google place ids for a template's stops that don't have one,
  // once per stop (retried weekly), only when someone opens the template.
  function verifyStops(templateId: string): Promise<void> {
    if (!googleConfigured()) return Promise.resolve();
    const running = verifying.get(templateId);
    if (running) return running;
    const stops = itineraries.unverifiedStops(templateId);
    if (!stops.length) return Promise.resolve();
    const job = Promise.all(
      stops.map(async (s) => {
        try {
          const hit = await resolvePlace(s.placeQuery as string, s);
          itineraries.recordLookup(s.id, hit?.placeId ?? null);
        } catch (err) {
          log.warn("CURATED_PLACE_LOOKUP_FAILED", { action: "verify_stop", status: "failure", errorCode: "UPSTREAM_ERROR", stopId: s.id, message: sanitize(err) });
        }
      }),
    )
      .then(() => undefined)
      .finally(() => verifying.delete(templateId));
    verifying.set(templateId, job);
    return job;
  }

  return async function handle(req: IncomingMessage, url: URL, user: User | null, readBody: () => Promise<Record<string, unknown>>): Promise<Result | null> {
    const method = req.method ?? "GET";
    const path = url.pathname;
    const p = url.searchParams;
    const ip = clientIp(req);
    const ok = (data: unknown, status = 200): Result => ({ status, data });

    // --- itineraries ---
    if (method === "GET" && path === "/api/itineraries") {
      return ok({ itineraries: itineraries.all(parseCategory(p.get("category"))) });
    }
    if (method === "GET" && path === "/api/itineraries/featured") {
      return ok({ itineraries: itineraries.featured({ category: parseCategory(p.get("category")), limit: parseBounded(p.get("limit"), "limit", 1, 20, 6) }) });
    }
    if (method === "GET" && path === "/api/itineraries/destinations") {
      return ok({ destinations: itineraries.destinations(), areas: itineraries.areas() });
    }
    if (method === "GET" && path === "/api/itineraries/nearby") {
      const origin = parseLatLng(p.get("lat"), p.get("lng"));
      const radiusKm = parseBounded(p.get("radiusKm"), "radiusKm", 1, 300, 150);
      const list = itineraries.nearby(origin, {
        radiusKm,
        category: parseCategory(p.get("category")),
        limit: parseBounded(p.get("limit"), "limit", 1, 20, 12),
      });
      return ok({ origin: coarse(origin), radiusKm, itineraries: list });
    }
    // trip discovery: places the curated plans visit around a destination,
    // and the plans ranked by what the visitor asked for. Wayline's own
    // data and arithmetic only; no Google or model call.
    if (method === "GET" && path === "/api/itineraries/highlights") {
      return ok({ places: itineraries.highlights(parseLatLng(p.get("lat"), p.get("lng"))) });
    }
    if (method === "POST" && path === "/api/itineraries/match") {
      return ok(itineraries.match(matchInput(await readBody())));
    }
    // trips travellers published: a separate list, never mixed into the curated ones
    if (method === "GET" && path === "/api/publications") {
      return ok({ publications: publications.list() });
    }
    let m = path.match(/^\/api\/itineraries\/(pub-[0-9a-f-]{36})(\/copy|\/reviews(?:\/[0-9a-f-]{36})?)?$/);
    if (m) {
      const id = m[1];
      if (method === "GET" && !m[2]) return ok(publications.get(id, user?.id ?? null));
      if (method === "POST" && m[2] === "/copy") {
        if (!user) throw new HttpError(401, "Sign in to use this template.");
        return ok(publications.fork(user.id, id, await readBody()), 201);
      }
      if (m[2]?.startsWith("/reviews")) {
        if (!user) throw new HttpError(401, "Sign in to review this trip.");
        const reviewId = m[2].split("/")[2];
        if (method === "PUT" && !reviewId) {
          const r = publications.review(user.id, id, await readBody());
          return ok({ review: r.review, created: r.created, ...publications.get(id, user.id) }, r.created ? 201 : 200);
        }
        if (method === "DELETE" && reviewId) {
          publications.deleteReview(user.id, id, reviewId);
          return ok(publications.get(id, user.id));
        }
      }
    }
    m = path.match(/^\/api\/itineraries\/([a-z0-9-]{3,80})(\/copy)?$/);
    if (m && method === "GET" && !m[2]) {
      itineraries.get(m[1]); // 404 before any Google call
      await verifyStops(m[1]);
      return ok(itineraries.get(m[1]));
    }
    if (m && method === "POST" && m[2]) {
      if (!user) throw new HttpError(401, "Sign in to copy this itinerary into a trip.");
      const tpl = itineraries.get(m[1]);
      return ok(trips.createFromTemplate(user.id, tpl, await readBody()), 201);
    }

    // --- places ---
    if (method === "GET" && path === "/api/places/autocomplete") {
      const q = (p.get("q") ?? "").trim();
      if (q.length < 2 || q.length > 80) throw bad("Type at least two characters.");
      const kind = p.get("kind") === "place" ? "place" : "city";
      const bias = p.get("lat") !== null ? parseLatLng(p.get("lat"), p.get("lng")) : null;
      placesLimit(ip);
      return ok(await autocomplete(q, { kind, session: sessionToken(p.get("session")), bias }));
    }
    if (method === "GET" && path === "/api/places/search") {
      const q = (p.get("q") ?? "").trim();
      if (q.length < 2 || q.length > 120) throw bad("Search for at least two characters.");
      const type = p.get("type");
      if (type && !SEARCH_TYPES.includes(type as (typeof SEARCH_TYPES)[number])) throw bad(`type must be one of: ${SEARCH_TYPES.join(", ")}.`);
      let bias: LatLng | null = null;
      const tripId = p.get("tripId");
      if (tripId) {
        if (!user) throw new HttpError(401, "Sign in to continue.");
        bias = trips.view(user.id, tripId).center;
      } else if (p.get("lat") !== null) {
        bias = parseLatLng(p.get("lat"), p.get("lng"));
      }
      placesLimit(ip);
      return ok(await searchPlaces(q, bias, type));
    }
    if (method === "GET" && path === "/api/places/nearby") {
      const center = parseLatLng(p.get("lat"), p.get("lng"));
      const radius = parseBounded(p.get("radius"), "radius", 500, 50_000, 10_000);
      const type = p.get("type") ?? "tourist_attraction";
      if (!SEARCH_TYPES.includes(type as (typeof SEARCH_TYPES)[number])) throw bad(`type must be one of: ${SEARCH_TYPES.join(", ")}.`);
      placesLimit(ip);
      const rich = p.get("rich") === "1";
      if (rich) placesLimit(ip); // a photo lookup per result: counts double
      return ok(await nearbyPlaces(center, radius, type, { rich }));
    }
    if (method === "GET" && path === "/api/places/photo") {
      if (!googleConfigured()) throw new HttpError(503, "Photos need Google Maps configured on the server.");
      placesLimit(ip);
      const w = parseBounded(p.get("w"), "w", 100, 800, 640); // small photos for the place card
      return ok({ uri: await photoUri(p.get("name") ?? "", w) });
    }
    m = path.match(/^\/api\/places\/([^/]+)$/);
    if (method === "GET" && m) {
      const id = decodeURIComponent(m[1]);
      placesLimit(ip);
      const view = p.get("view");
      return ok(view === "basic" ? await placeBasic(id, sessionToken(p.get("session"))) : view === "guide" ? await placeGuide(id) : await placeDetails(id));
    }

    // --- area & routes ---
    if (method === "GET" && path === "/api/geo/reverse") {
      const at = parseLatLng(p.get("lat"), p.get("lng"));
      placesLimit(ip);
      return ok(await reverseGeocode(at));
    }
    if (method === "POST" && path === "/api/routes") {
      const input = await readBody();
      const origin = waypointInput(input.origin, "origin");
      const destination = waypointInput(input.destination, "destination");
      const mode = (input.mode ?? "WALK") as Mode;
      if (!MODES.includes(mode)) throw bad("mode must be WALK, TRANSIT or DRIVE.");
      let departure: Date | null = null;
      if (input.departureTime !== undefined && input.departureTime !== null) {
        departure = new Date(String(input.departureTime));
        if (Number.isNaN(departure.getTime())) throw bad("departureTime must be an ISO date-time.");
      }
      if (!googleConfigured()) {
        throw new HttpError(503, "Route calculation needs Google Maps configured on the server (GOOGLE_MAPS_SERVER_KEY). No route was estimated.");
      }
      const key = JSON.stringify([origin, destination, mode, departure?.toISOString() ?? null]);
      const hit = routeCache.get(key);
      if (hit && Date.now() - hit.at < 10 * 60_000) return ok(hit.data);
      const running = routeInflight.get(key);
      if (running) return ok(await running);
      routesLimit(ip);
      const job = computeRoute(origin, destination, mode, departure).then((route) => {
        routeCache.set(key, { at: Date.now(), data: route });
        if (routeCache.size > 500) routeCache.delete(routeCache.keys().next().value as string);
        return route;
      }).finally(() => routeInflight.delete(key));
      routeInflight.set(key, job);
      return ok(await job);
    }
    return null;
  };
}
