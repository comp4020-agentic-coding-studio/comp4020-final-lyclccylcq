import { log, sanitize } from "./log.ts";
import { DESTINATIONS } from "./curated.ts";
import { HttpError } from "./errors.ts";
import { haversineKm, type LatLng } from "./geo.ts";
import type { Mode, RouteOption, RouteStep, TransitStep } from "./schedule.ts";

// The server-side Google Maps Platform service layer: Places API (New),
// Routes API and Geocoding API. The key (GOOGLE_MAPS_SERVER_KEY) never leaves
// this process. Every request names the fields it needs (a field mask) and
// nothing more. Results are passed to the browser, not stored, apart from
// what Google allows: place ids indefinitely.
//
// The base URLs can be pointed elsewhere (GOOGLE_*_BASE_URL) so the spec can
// run against a local stand-in; in production they're Google's.

const serverKey = (): string | undefined => process.env.GOOGLE_MAPS_SERVER_KEY || undefined;
export const googleConfigured = (): boolean => Boolean(serverKey());

// Startup warnings about the two Maps keys. Never includes a key value.
export function mapsKeyWarnings(env: NodeJS.ProcessEnv = process.env): string[] {
  const browser = env.GOOGLE_MAPS_BROWSER_KEY || "";
  const server = env.GOOGLE_MAPS_SERVER_KEY || "";
  const out: string[] = [];
  if (browser && server && browser === server) {
    out.push("GOOGLE_MAPS_BROWSER_KEY and GOOGLE_MAPS_SERVER_KEY are the same key. The browser key is public via /api/config, so the server key is exposed too. Use two separate keys (docs/google-maps-keys.md).");
  }
  if (browser && !server) out.push("GOOGLE_MAPS_SERVER_KEY is missing: places fall back to demo data and routes are unavailable.");
  if (server && !browser) out.push("GOOGLE_MAPS_BROWSER_KEY is missing: the map falls back to the schematic view.");
  return out;
}
const PLACES = () => process.env.GOOGLE_PLACES_BASE_URL || "https://places.googleapis.com";
const ROUTES = () => process.env.GOOGLE_ROUTES_BASE_URL || "https://routes.googleapis.com";
const GEOCODE = () => process.env.GOOGLE_GEOCODE_BASE_URL || "https://maps.googleapis.com";

export type PlaceSummary = {
  placeId: string;
  name: string;
  address: string | null;
  lat: number;
  lng: number;
  category: string | null;
  types: string[];
  source: "google" | "demo";
};

export type PlaceDetails = PlaceSummary & {
  rating: number | null;
  ratingCount: number | null;
  openingHours: string[] | null;
  openNow: boolean | null;
  googleMapsUri: string | null;
  photo: { name: string; attributions: { displayName: string; uri: string | null }[] } | null;
};

// Real Sydney landmarks with approximate coordinates, for trying Wayline
// without a Google key. Labelled "demo" everywhere, no opening hours, can't
// be routed.
export const DEMO_PLACES: PlaceSummary[] = [
  ["taronga-zoo", "Taronga Zoo Sydney", "Mosman NSW", -33.8436, 151.2411, "Zoo", ["zoo", "tourist_attraction"]],
  ["opera-house", "Sydney Opera House", "Bennelong Point, Sydney NSW", -33.8568, 151.2153, "Performing arts theatre", ["performing_arts_theater", "tourist_attraction"]],
  ["botanic-garden", "Royal Botanic Garden Sydney", "Sydney NSW", -33.8642, 151.2166, "Botanical garden", ["botanical_garden", "park"]],
  ["the-rocks", "The Rocks", "Sydney NSW", -33.8599, 151.209, "Historic district", ["tourist_attraction"]],
  ["qvb", "Queen Victoria Building", "George St, Sydney NSW", -33.8718, 151.2067, "Shopping centre", ["shopping_mall"]],
  ["bondi-beach", "Bondi Beach", "Bondi Beach NSW", -33.8915, 151.2767, "Beach", ["beach", "tourist_attraction"]],
  ["darling-harbour", "Darling Harbour", "Sydney NSW", -33.8749, 151.2009, "Harbour precinct", ["tourist_attraction"]],
  ["circular-quay", "Circular Quay", "Sydney NSW", -33.8613, 151.2108, "Ferry terminal", ["ferry_terminal", "transit_station"]],
  ["harbour-bridge", "Sydney Harbour Bridge", "Sydney NSW", -33.8523, 151.2108, "Bridge", ["tourist_attraction"]],
  ["barangaroo", "Barangaroo Reserve", "Barangaroo NSW", -33.8569, 151.2025, "Park", ["park"]],
].map(([slug, name, address, lat, lng, category, types]) => ({
  placeId: `demo:${slug}`,
  name: name as string,
  address: address as string,
  lat: lat as number,
  lng: lng as number,
  category: category as string,
  types: types as string[],
  source: "demo" as const,
}));

// Place types the search endpoints accept, so a caller can't send anything.
export const SEARCH_TYPES = ["tourist_attraction", "restaurant", "cafe", "museum", "park", "zoo", "shopping_mall", "lodging", "store"] as const;

// Google's error shape ({ error: { code, status, message, details[].reason } })
// turned into a message a person can act on. The raw error goes to the
// server log only, and never includes the key.
export function describeGoogleError(httpStatus: number, data: any, api: string): { status: number; message: string; reason: string } {
  const err = data?.error ?? {};
  const reasons: string[] = (Array.isArray(err.details) ? err.details : []).map((d: any) => String(d?.reason ?? "")).filter(Boolean);
  const reason = reasons[0] ?? String(err.status ?? httpStatus);
  const text = String(err.message ?? "");
  if (reasons.includes("API_KEY_INVALID") || /api key not valid/i.test(text)) {
    return { status: 503, reason, message: "Google rejected the server's Maps key. Check GOOGLE_MAPS_SERVER_KEY." };
  }
  if (reasons.includes("SERVICE_DISABLED") || reasons.includes("ACCESS_NOT_CONFIGURED") || /has not been used|is disabled/i.test(text)) {
    return { status: 503, reason, message: `The ${api} isn't enabled for this Google Cloud project yet.` };
  }
  if (reasons.includes("BILLING_DISABLED") || /billing/i.test(text)) {
    return { status: 503, reason, message: "Google Maps billing isn't enabled for this Google Cloud project." };
  }
  if (reasons.includes("API_KEY_HTTP_REFERRER_BLOCKED") || /referer/i.test(text)) {
    return { status: 503, reason, message: "The server's Maps key has a website restriction, which blocks server requests. Give GOOGLE_MAPS_SERVER_KEY no application restriction, and keep website restrictions on the browser key." };
  }
  if (reasons.some((r) => r.startsWith("API_KEY_") && r.includes("BLOCKED")) || /blocked/i.test(text)) {
    return { status: 503, reason, message: `The server key's restrictions don't allow the ${api}. Check its API restrictions.` };
  }
  if (httpStatus === 429 || err.status === "RESOURCE_EXHAUSTED") {
    return { status: 503, reason, message: "Google Maps usage limits have been reached. Try again later." };
  }
  if (httpStatus === 400 || err.status === "INVALID_ARGUMENT") {
    return { status: 400, reason, message: "Google Maps couldn't understand that request." };
  }
  return { status: 502, reason, message: "Google Maps couldn't complete this request. Try again in a moment." };
}

const apiName = (url: string) => (url.includes("routes") || url.includes("computeRoutes") ? "Routes API" : url.includes("geocode") ? "Geocoding API" : "Places API (New)");

async function google(url: string, init: { method: string; fieldMask?: string; body?: unknown }): Promise<any> {
  const key = serverKey();
  if (!key) throw new HttpError(503, "Google Maps isn't configured on this server (GOOGLE_MAPS_SERVER_KEY is missing).");
  const api = apiName(url);
  let res: Response;
  try {
    res = await fetch(url, {
      method: init.method,
      headers: {
        "content-type": "application/json",
        "x-goog-api-key": key,
        ...(init.fieldMask ? { "x-goog-fieldmask": init.fieldMask } : {}),
      },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
      signal: AbortSignal.timeout(10_000),
    });
  } catch (err) {
    const timeout = err instanceof Error && err.name === "TimeoutError";
    log.warn("GOOGLE_API_FAILED", { action: api, status: "failure", errorCode: timeout ? "UPSTREAM_TIMEOUT" : "UPSTREAM_UNREACHABLE", message: `google ${api}: ${timeout ? "timed out" : "network error"}` });
    throw new HttpError(502, timeout ? "Google Maps took too long to answer. Try again." : "Couldn't reach Google Maps. Check the connection and try again.");
  }
  const data = (await res.json().catch(() => ({}))) as any;
  if (!res.ok) {
    const e = describeGoogleError(res.status, data, api);
    log.warn("GOOGLE_API_FAILED", { action: api, status: "failure", errorCode: "UPSTREAM_ERROR", httpStatus: res.status, reason: e.reason, message: sanitize(`google ${api}: HTTP ${res.status} ${e.reason}: ${String(data?.error?.message ?? "")}`) });
    throw new HttpError(e.status, e.message, { reason: e.reason });
  }
  return data;
}

const toSummary = (p: any): PlaceSummary => ({
  placeId: String(p.id),
  name: p.displayName?.text ?? "Unnamed place",
  address: p.formattedAddress ?? p.shortFormattedAddress ?? null,
  lat: Number(p.location?.latitude),
  lng: Number(p.location?.longitude),
  category: p.primaryTypeDisplayName?.text ?? null,
  types: Array.isArray(p.types) ? p.types : [],
  source: "google",
});

const LIST_MASK = "places.id,places.displayName,places.formattedAddress,places.location,places.primaryTypeDisplayName,places.types";
const circle = (c: LatLng, radius: number) => ({ circle: { center: { latitude: c.lat, longitude: c.lng }, radius } });
const validPlaceId = (id: string) => /^[A-Za-z0-9_-]{10,300}$/.test(id);

// --- Places API (New) ----------------------------------------------------------

// Destination or place suggestions while typing. The browser debounces; a
// session token groups the keystrokes and the final details lookup into one
// billed session, as Google recommends.
export async function autocomplete(
  input: string,
  opts: { kind: "city" | "place"; session: string | null; bias: LatLng | null },
): Promise<{ source: "google" | "demo"; suggestions: { placeId: string; main: string; secondary: string | null }[] }> {
  if (!googleConfigured()) {
    const needle = input.toLowerCase();
    return {
      source: "demo",
      suggestions: DESTINATIONS.filter((d) => `${d.name} ${d.region}`.toLowerCase().includes(needle)).map((d) => ({
        placeId: `demo-city:${d.id}`,
        main: d.name,
        secondary: d.region,
      })),
    };
  }
  const data = await google(`${PLACES()}/v1/places:autocomplete`, {
    method: "POST",
    body: {
      input,
      ...(opts.session ? { sessionToken: opts.session } : {}),
      ...(opts.kind === "city" ? { includedPrimaryTypes: ["(cities)"] } : {}),
      ...(opts.bias ? { locationBias: circle(opts.bias, 50_000) } : {}),
    },
  });
  const suggestions = (Array.isArray(data.suggestions) ? data.suggestions : [])
    .map((s: any) => s.placePrediction)
    .filter((p: any) => p?.placeId)
    .slice(0, 6)
    .map((p: any) => ({
      placeId: String(p.placeId),
      main: p.structuredFormat?.mainText?.text ?? p.text?.text ?? "",
      secondary: p.structuredFormat?.secondaryText?.text ?? null,
    }));
  return { source: "google", suggestions };
}

export async function searchPlaces(
  query: string,
  bias: LatLng | null,
  type: string | null = null,
): Promise<{ source: "google" | "demo"; places: PlaceSummary[] }> {
  if (!googleConfigured()) {
    const words = query.toLowerCase().split(/\s+/).filter(Boolean);
    const places = DEMO_PLACES.filter((p) => words.some((w) => `${p.name} ${p.category} ${p.types.join(" ")}`.toLowerCase().includes(w)));
    return { source: "demo", places: places.length ? places : DEMO_PLACES.slice(0, 6) };
  }
  const data = await google(`${PLACES()}/v1/places:searchText`, {
    method: "POST",
    fieldMask: LIST_MASK,
    body: {
      textQuery: query,
      pageSize: 8,
      ...(type ? { includedType: type } : {}),
      ...(bias ? { locationBias: circle(bias, 30_000) } : {}),
    },
  });
  const places = (Array.isArray(data.places) ? data.places : []).map(toSummary).filter((p: PlaceSummary) => Number.isFinite(p.lat));
  return { source: "google", places };
}

const FOOD_TYPES = new Set(["restaurant", "cafe"]);

// Notable places around a point, for when Wayline has no itinerary nearby.
export type NearbyPlace = PlaceSummary & {
  distanceKm: number;
  rating?: number | null;
  ratingCount?: number | null;
  thumb?: { uri: string; credit: string[] } | null;
  priceLevel?: string | null;
};

// rich: the editor's map-click list, which also shows rating and a small
// photo per place (Google's photo credit comes with it and must be shown).
// withPrice: also Google's price level, rating and review count (the AI
// planner's candidates); never estimated
export async function nearbyPlaces(center: LatLng, radiusM: number, type: string, { rich = false, withPrice = false } = {}): Promise<{ source: "google" | "demo"; places: NearbyPlace[] }> {
  const withDistance = (list: PlaceSummary[]) =>
    list.map((p) => ({ ...p, distanceKm: Math.round(haversineKm(center, p) * 10) / 10 })).sort((a, b) => a.distanceKm - b.distanceKm);
  if (!googleConfigured()) {
    return { source: "demo", places: withDistance(DEMO_PLACES.filter((p) => haversineKm(center, p) * 1000 <= radiusM)) };
  }
  // Food by primary type, or hotels with a restaurant inside come first;
  // attractions by any type, since a museum's primary type is "museum".
  const types = FOOD_TYPES.has(type) ? { includedPrimaryTypes: [type] } : { includedTypes: [type] };
  const data = await google(`${PLACES()}/v1/places:searchNearby`, {
    method: "POST",
    fieldMask: (rich ? `${LIST_MASK},places.rating,places.userRatingCount,places.photos` : LIST_MASK) + (withPrice ? `,places.priceLevel${rich ? "" : ",places.rating,places.userRatingCount"}` : ""),
    body: { ...types, maxResultCount: rich ? 10 : 12, rankPreference: "POPULARITY", locationRestriction: circle(center, radiusM) },
  });
  // Google's popularity order is kept; distance is shown, not used to re-sort.
  const raw = (Array.isArray(data.places) ? data.places : []).filter((p: any) => Number.isFinite(Number(p.location?.latitude)));
  const places: NearbyPlace[] = raw.map((p: any) => {
    const s = toSummary(p);
    return {
      ...s,
      distanceKm: Math.round(haversineKm(center, s) * 10) / 10,
      ...(withPrice
        ? { priceLevel: PRICE[p.priceLevel] ?? null, rating: typeof p.rating === "number" ? p.rating : null, ratingCount: typeof p.userRatingCount === "number" ? p.userRatingCount : null }
        : {}),
    };
  });
  if (!rich) return { source: "google", places };
  await Promise.all(
    raw.map(async (p: any, i: number) => {
      places[i].rating = typeof p.rating === "number" ? p.rating : null;
      places[i].ratingCount = typeof p.userRatingCount === "number" ? p.userRatingCount : null;
      const photo = Array.isArray(p.photos) ? p.photos[0] : undefined;
      places[i].thumb = photo?.name
        ? await photoUri(photo.name, 160).then(
            (uri) => ({ uri, credit: (photo.authorAttributions ?? []).map((a: any) => String(a.displayName ?? "")).filter(Boolean) }),
            () => null,
          )
        : null;
    }),
  );
  return { source: "google", places };
}

// Just enough to place something on the map (choosing a destination).
export async function placeBasic(placeId: string, session: string | null): Promise<PlaceSummary> {
  const city = DESTINATIONS.find((d) => `demo-city:${d.id}` === placeId);
  if (city) return { placeId, name: city.name, address: city.region, lat: city.lat, lng: city.lng, category: "City", types: ["locality"], source: "demo" };
  const demo = DEMO_PLACES.find((p) => p.placeId === placeId);
  if (demo) return demo;
  if (!validPlaceId(placeId)) throw new HttpError(400, "That isn't a place id.");
  const qs = session ? `?sessionToken=${encodeURIComponent(session)}` : "";
  const data = await google(`${PLACES()}/v1/places/${encodeURIComponent(placeId)}${qs}`, {
    method: "GET",
    fieldMask: "id,displayName,formattedAddress,location,types",
  });
  return toSummary(data);
}

// Everything the place panel shows, fetched when someone opens it.
export async function placeDetails(placeId: string): Promise<PlaceDetails> {
  const demo = DEMO_PLACES.find((p) => p.placeId === placeId);
  if (demo) return { ...demo, rating: null, ratingCount: null, openingHours: null, openNow: null, googleMapsUri: null, photo: null };
  if (!validPlaceId(placeId)) throw new HttpError(400, "That isn't a place id.");
  const data = await google(`${PLACES()}/v1/places/${encodeURIComponent(placeId)}`, {
    method: "GET",
    fieldMask:
      "id,displayName,formattedAddress,location,primaryTypeDisplayName,types,rating,userRatingCount,regularOpeningHours.weekdayDescriptions,currentOpeningHours.openNow,googleMapsUri,photos",
  });
  const p0 = Array.isArray(data.photos) ? data.photos[0] : undefined;
  return {
    ...toSummary(data),
    rating: typeof data.rating === "number" ? data.rating : null,
    ratingCount: typeof data.userRatingCount === "number" ? data.userRatingCount : null,
    openingHours: data.regularOpeningHours?.weekdayDescriptions ?? null,
    openNow: typeof data.currentOpeningHours?.openNow === "boolean" ? data.currentOpeningHours.openNow : null,
    googleMapsUri: data.googleMapsUri ?? null,
    photo: p0?.name
      ? {
          name: String(p0.name),
          attributions: (p0.authorAttributions ?? []).map((a: any) => ({ displayName: String(a.displayName ?? "Unknown"), uri: a.uri ?? null })),
        }
      : null,
  };
}

export type PlaceReview = {
  author: string;
  authorUri: string | null;
  rating: number | null;
  when: string | null;
  text: string;
  uri: string | null;
};

export type PlaceGuide = PlaceDetails & {
  summary: string | null; // Google's editorial summary, when it has one
  website: string | null;
  price: string | null;
  features: string[]; // only attributes Google reports as true
  photos: { name: string; attributions: { displayName: string; uri: string | null }[] }[];
  reviews: PlaceReview[];
};

const FEATURES: [string, string][] = [
  ["servesBreakfast", "Breakfast"],
  ["servesLunch", "Lunch"],
  ["servesDinner", "Dinner"],
  ["servesVegetarianFood", "Vegetarian options"],
  ["servesCoffee", "Coffee"],
  ["dineIn", "Dine-in"],
  ["takeout", "Takeaway"],
  ["reservable", "Takes reservations"],
  ["outdoorSeating", "Outdoor seating"],
  ["goodForChildren", "Good for children"],
  ["goodForGroups", "Good for groups"],
];
const PRICE: Record<string, string> = {
  PRICE_LEVEL_FREE: "Free",
  PRICE_LEVEL_INEXPENSIVE: "$",
  PRICE_LEVEL_MODERATE: "$$",
  PRICE_LEVEL_EXPENSIVE: "$$$",
  PRICE_LEVEL_VERY_EXPENSIVE: "$$$$",
};
const photoRef = (p: any) => ({
  name: String(p.name),
  attributions: (p.authorAttributions ?? []).map((a: any) => ({ displayName: String(a.displayName ?? "Unknown"), uri: a.uri ?? null })),
});

// The editor's place card: details plus what helps decide whether to go.
// These fields bill at Google's Enterprise + Atmosphere rate, so only this
// view asks for them, once per opened place. Reviews are Google's own (it
// returns at most five, in its "most relevant" order); the card shows up to
// three, preferring ones with more to say, never edited.
export async function placeGuide(placeId: string): Promise<PlaceGuide> {
  const demo = DEMO_PLACES.find((p) => p.placeId === placeId);
  if (demo) {
    return { ...demo, rating: null, ratingCount: null, openingHours: null, openNow: null, googleMapsUri: null, photo: null, summary: null, website: null, price: null, features: [], photos: [], reviews: [] };
  }
  if (!validPlaceId(placeId)) throw new HttpError(400, "That isn't a place id.");
  const data = await google(`${PLACES()}/v1/places/${encodeURIComponent(placeId)}`, {
    method: "GET",
    fieldMask: [
      "id,displayName,formattedAddress,location,primaryTypeDisplayName,types,rating,userRatingCount",
      "regularOpeningHours.weekdayDescriptions,currentOpeningHours.openNow,googleMapsUri,photos",
      "editorialSummary,websiteUri,priceLevel,reviews",
      FEATURES.map(([f]) => f).join(","),
    ].join(","),
  });
  const photos = (Array.isArray(data.photos) ? data.photos : []).filter((p: any) => p?.name).slice(0, 3).map(photoRef);
  const all: PlaceReview[] = (Array.isArray(data.reviews) ? data.reviews : [])
    .map((r: any) => ({
      author: String(r.authorAttribution?.displayName ?? "A Google user"),
      authorUri: r.authorAttribution?.uri ?? null,
      rating: typeof r.rating === "number" ? r.rating : null,
      when: r.relativePublishTimeDescription ?? null,
      text: String(r.text?.text ?? r.originalText?.text ?? "").trim(),
      uri: r.googleMapsUri ?? null,
    }))
    .filter((r: PlaceReview) => r.text);
  // the three with the most to say, shown in Google's order
  const keep = new Set([...all].sort((a, b) => b.text.length - a.text.length).slice(0, 3));
  return {
    ...toSummary(data),
    rating: typeof data.rating === "number" ? data.rating : null,
    ratingCount: typeof data.userRatingCount === "number" ? data.userRatingCount : null,
    openingHours: data.regularOpeningHours?.weekdayDescriptions ?? null,
    openNow: typeof data.currentOpeningHours?.openNow === "boolean" ? data.currentOpeningHours.openNow : null,
    googleMapsUri: data.googleMapsUri ?? null,
    photo: photos[0] ?? null,
    summary: typeof data.editorialSummary?.text === "string" && data.editorialSummary.text.trim() ? data.editorialSummary.text.trim() : null,
    website: typeof data.websiteUri === "string" && /^https?:\/\//.test(data.websiteUri) ? data.websiteUri : null,
    price: PRICE[data.priceLevel] ?? null,
    features: FEATURES.filter(([f]) => data[f] === true).map(([, label]) => label),
    photos,
    reviews: all.filter((r) => keep.has(r)),
  };
}

// A short-lived image URL for one photo. Google returns a URL without the
// key, so the browser can load it directly.
export async function photoUri(photoName: string, maxWidthPx = 640): Promise<string> {
  if (!/^places\/[A-Za-z0-9_-]+\/photos\/[A-Za-z0-9_-]+$/.test(photoName)) throw new HttpError(400, "That isn't a photo reference.");
  const data = await google(`${PLACES()}/v1/${photoName}/media?maxWidthPx=${maxWidthPx}&skipHttpRedirect=true`, { method: "GET" });
  if (typeof data.photoUri !== "string") throw new HttpError(502, "Google returned no photo.");
  return data.photoUri;
}

// Finds the Google place for a curated stop: the first text-search result
// for its query, accepted only if it lies near where the stop should be.
export async function resolvePlace(query: string, near: LatLng, maxKm = 1.5): Promise<{ placeId: string; distanceKm: number } | null> {
  const data = await google(`${PLACES()}/v1/places:searchText`, {
    method: "POST",
    fieldMask: "places.id,places.location",
    body: { textQuery: query, pageSize: 1, locationBias: circle(near, 2_000) },
  });
  const p = Array.isArray(data.places) ? data.places[0] : undefined;
  if (!p?.id || !p.location) return null;
  const d = haversineKm(near, { lat: Number(p.location.latitude), lng: Number(p.location.longitude) });
  return d <= maxKm ? { placeId: String(p.id), distanceKm: d } : null;
}

// --- Geocoding API -------------------------------------------------------------

// The approximate area around a point ("Canberra, Australia"). Without a key,
// the nearest destination Wayline knows, if one is close.
export async function reverseGeocode(p: LatLng): Promise<{ label: string; source: "google" | "approximate" }> {
  const nearestKnown = () => {
    const d = DESTINATIONS.map((x) => ({ x, km: haversineKm(p, x) })).sort((a, b) => a.km - b.km)[0];
    return d && d.km <= 120 ? { label: `Near ${d.x.name}`, source: "approximate" as const } : { label: "Your location", source: "approximate" as const };
  };
  const key = serverKey();
  if (!key) return nearestKnown();
  let data: any;
  try {
    const res = await fetch(
      `${GEOCODE()}/maps/api/geocode/json?latlng=${p.lat},${p.lng}&result_type=locality|administrative_area_level_2|administrative_area_level_1&key=${encodeURIComponent(key)}`,
      { signal: AbortSignal.timeout(8_000) },
    );
    data = await res.json();
  } catch {
    return nearestKnown();
  }
  if (data?.status !== "OK" || !Array.isArray(data.results) || !data.results[0]) {
    if (data?.status && data.status !== "ZERO_RESULTS") log.warn("GOOGLE_API_FAILED", { action: "Geocoding API", status: "failure", errorCode: "UPSTREAM_ERROR", reason: data.status, message: sanitize(`google Geocoding API: ${data.status}: ${String(data.error_message ?? "")}`) });
    return nearestKnown();
  }
  const comps: any[] = data.results[0].address_components ?? [];
  const pick = (t: string) => comps.find((c) => Array.isArray(c.types) && c.types.includes(t))?.long_name;
  const area = pick("locality") ?? pick("administrative_area_level_2") ?? pick("administrative_area_level_1");
  const country = pick("country");
  return { label: [area, country].filter(Boolean).join(", ") || String(data.results[0].formatted_address ?? "Your location"), source: "google" };
}

// --- Routes API ----------------------------------------------------------------

export type Waypoint = { placeId: string } | LatLng;
const waypoint = (w: Waypoint) => ("placeId" in w ? { placeId: w.placeId } : { location: { latLng: { latitude: w.lat, longitude: w.lng } } });
const seconds = (d: unknown): number => (typeof d === "string" ? Number.parseFloat(d) : 0) || 0;

function summariseSteps(steps: any[]): RouteStep[] {
  const out: RouteStep[] = [];
  for (const s of steps) {
    const t = s.transitDetails;
    if (s.travelMode === "TRANSIT" && t) {
      const step: TransitStep = {
        kind: "transit",
        line: t.transitLine?.nameShort || t.transitLine?.name || null,
        vehicle: t.transitLine?.vehicle?.name?.text ?? null,
        color: t.transitLine?.color ?? null,
        textColor: t.transitLine?.textColor ?? null,
        headsign: t.headsign ?? null,
        from: t.stopDetails?.departureStop?.name ?? null,
        to: t.stopDetails?.arrivalStop?.name ?? null,
        departureTime: t.stopDetails?.departureTime ?? null,
        arrivalTime: t.stopDetails?.arrivalTime ?? null,
        localDeparture: t.localizedValues?.departureTime?.time?.text ?? null,
        localArrival: t.localizedValues?.arrivalTime?.time?.text ?? null,
        stops: typeof t.stopCount === "number" ? t.stopCount : null,
      };
      out.push(step);
    } else {
      const last = out[out.length - 1];
      const dur = seconds(s.staticDuration);
      const dist = Number(s.distanceMeters) || 0;
      if (last && last.kind === "walk") {
        last.durationSec += dur;
        last.distanceM += dist;
      } else {
        out.push({ kind: "walk", durationSec: dur, distanceM: dist });
      }
    }
  }
  return out;
}

const TRANSIT_PAST_MS = 7 * 86_400_000;
const TRANSIT_FUTURE_MS = 100 * 86_400_000;

// One mode between two points. polyline is Google's encoded route geometry,
// returned only when Google provides it.
export async function computeRoute(origin: Waypoint, destination: Waypoint, mode: Mode, departure: Date | null, now = Date.now()): Promise<RouteOption> {
  const body: Record<string, unknown> = { origin: waypoint(origin), destination: waypoint(destination), travelMode: mode, languageCode: "en", units: "METRIC" };
  if (mode === "TRANSIT") {
    const t = (departure ?? new Date(now)).getTime();
    if (t < now - TRANSIT_PAST_MS || t > now + TRANSIT_FUTURE_MS) {
      return { mode, status: "error", message: "Google only provides transit schedules from 7 days ago to 100 days ahead, and this departure is outside that window." };
    }
    if (departure) body.departureTime = departure.toISOString();
  }
  try {
    const data = await google(`${ROUTES()}/directions/v2:computeRoutes`, {
      method: "POST",
      fieldMask: [
        "routes.duration",
        "routes.distanceMeters",
        "routes.polyline.encodedPolyline",
        "routes.legs.steps.travelMode",
        "routes.legs.steps.staticDuration",
        "routes.legs.steps.distanceMeters",
        "routes.legs.steps.transitDetails",
      ].join(","),
      body,
    });
    const route = Array.isArray(data.routes) ? data.routes[0] : undefined;
    if (!route) return { mode, status: "none", message: `Google found no ${mode.toLowerCase()} route between these places.` };
    return {
      mode,
      status: "ok",
      durationSec: seconds(route.duration),
      distanceM: Number(route.distanceMeters) || 0,
      steps: mode === "TRANSIT" ? summariseSteps((route.legs ?? []).flatMap((l: any) => l.steps ?? [])) : undefined,
      polyline: typeof route.polyline?.encodedPolyline === "string" ? route.polyline.encodedPolyline : undefined,
    };
  } catch (err) {
    if (err instanceof HttpError && err.status === 503) throw err;
    return { mode, status: "error", message: err instanceof Error ? err.message : "Route lookup failed." };
  }
}

// All three modes for a trip's consecutive stops, in parallel. Each mode's
// outcome stands on its own. Geometry isn't kept for trip segments.
// assumed: when the earlier stop has no time, transit is looked up for this
// stand-in departure (midday on the trip's date) instead of not at all, and
// the option says so; walking and driving don't depend on the time.
export async function computeRouteOptions(origin: Waypoint, destination: Waypoint, departure: Date | null, now = Date.now(), assumed: { at: Date; label: string } | null = null): Promise<RouteOption[]> {
  const one = async (mode: Mode): Promise<RouteOption> => {
    if (mode === "TRANSIT" && !departure && !assumed) {
      return { mode, status: "error", message: "Give the earlier stop a start time to look up transit departures." };
    }
    const at = mode === "TRANSIT" && !departure && assumed ? assumed.at : departure;
    const { polyline: _drop, ...rest } = await computeRoute(origin, destination, mode, at, now);
    return mode === "TRANSIT" && !departure && assumed ? { ...rest, assumedDeparture: assumed.label } : rest;
  };
  return Promise.all((["WALK", "TRANSIT", "DRIVE"] as Mode[]).map(one));
}
