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
export const SEARCH_TYPES = ["tourist_attraction", "restaurant", "cafe", "museum", "park", "shopping_mall", "lodging", "store"] as const;

async function google(url: string, init: { method: string; fieldMask?: string; body?: unknown }): Promise<any> {
  const key = serverKey();
  if (!key) throw new HttpError(503, "Google Maps isn't configured on this server.");
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
  } catch {
    throw new HttpError(502, "Couldn't reach Google Maps. Try again in a moment.");
  }
  const data = (await res.json().catch(() => ({}))) as any;
  if (!res.ok) {
    // Google's own message (never the key) so a misconfiguration is visible.
    const message = typeof data?.error?.message === "string" ? data.error.message : `HTTP ${res.status}`;
    throw new HttpError(502, `Google Maps returned an error: ${message}`);
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

// Notable places around a point, for when Wayline has no itinerary nearby.
export async function nearbyPlaces(center: LatLng, radiusM: number, type: string): Promise<{ source: "google" | "demo"; places: (PlaceSummary & { distanceKm: number })[] }> {
  const withDistance = (list: PlaceSummary[]) =>
    list.map((p) => ({ ...p, distanceKm: Math.round(haversineKm(center, p) * 10) / 10 })).sort((a, b) => a.distanceKm - b.distanceKm);
  if (!googleConfigured()) {
    return { source: "demo", places: withDistance(DEMO_PLACES.filter((p) => haversineKm(center, p) * 1000 <= radiusM)) };
  }
  const data = await google(`${PLACES()}/v1/places:searchNearby`, {
    method: "POST",
    fieldMask: LIST_MASK,
    body: { includedTypes: [type], maxResultCount: 12, rankPreference: "POPULARITY", locationRestriction: circle(center, radiusM) },
  });
  // Google's popularity order is kept; distance is shown, not used to re-sort.
  const places = (Array.isArray(data.places) ? data.places : []).map(toSummary).filter((p: PlaceSummary) => Number.isFinite(p.lat));
  return { source: "google", places: places.map((p: PlaceSummary) => ({ ...p, distanceKm: Math.round(haversineKm(center, p) * 10) / 10 })) };
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
  if (demo) return { ...demo, openingHours: null, openNow: null, googleMapsUri: null, photo: null };
  if (!validPlaceId(placeId)) throw new HttpError(400, "That isn't a place id.");
  const data = await google(`${PLACES()}/v1/places/${encodeURIComponent(placeId)}`, {
    method: "GET",
    fieldMask:
      "id,displayName,formattedAddress,location,primaryTypeDisplayName,types,regularOpeningHours.weekdayDescriptions,currentOpeningHours.openNow,googleMapsUri,photos",
  });
  const p0 = Array.isArray(data.photos) ? data.photos[0] : undefined;
  return {
    ...toSummary(data),
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
  if (data?.status !== "OK" || !Array.isArray(data.results) || !data.results[0]) return nearestKnown();
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
export async function computeRouteOptions(originPlaceId: string, destinationPlaceId: string, departure: Date | null, now = Date.now()): Promise<RouteOption[]> {
  const one = async (mode: Mode): Promise<RouteOption> => {
    if (mode === "TRANSIT" && !departure) {
      return { mode, status: "error", message: "Give the earlier stop a start time to look up transit departures." };
    }
    const { polyline: _drop, ...rest } = await computeRoute({ placeId: originPlaceId }, { placeId: destinationPlaceId }, mode, departure, now);
    return rest;
  };
  return Promise.all((["WALK", "TRANSIT", "DRIVE"] as Mode[]).map(one));
}
