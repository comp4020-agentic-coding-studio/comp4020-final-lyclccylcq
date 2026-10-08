import { HttpError } from "./errors.ts";
import type { Mode, RouteOption, RouteStep, TransitStep } from "./schedule.ts";

// Server-side Google Maps Platform calls: Places API (New) and the Routes
// API. The key (GOOGLE_MAPS_SERVER_KEY) never leaves this process. Results are
// passed through to the browser, not stored, apart from what Google allows:
// place ids indefinitely, and coordinates and route data as a temporary copy
// that the trip store drops after 30 days.

const serverKey = (): string | undefined => process.env.GOOGLE_MAPS_SERVER_KEY || undefined;
export const googleConfigured = (): boolean => Boolean(serverKey());

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
};

// A handful of real Sydney landmarks with approximate coordinates, for
// trying Wayline without a Google key. They're labelled "demo" everywhere
// they appear, carry no opening hours, and can't be routed between.
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

async function google(url: string, init: { method: string; fieldMask: string; body?: unknown }): Promise<any> {
  const key = serverKey();
  if (!key) throw new HttpError(503, "Google Maps isn't configured on this server.");
  let res: Response;
  try {
    res = await fetch(url, {
      method: init.method,
      headers: {
        "content-type": "application/json",
        "x-goog-api-key": key,
        "x-goog-fieldmask": init.fieldMask,
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
  address: p.formattedAddress ?? null,
  lat: Number(p.location?.latitude),
  lng: Number(p.location?.longitude),
  category: p.primaryTypeDisplayName?.text ?? null,
  types: Array.isArray(p.types) ? p.types : [],
  source: "google",
});

export async function searchPlaces(
  query: string,
  bias: { lat: number; lng: number } | null,
): Promise<{ source: "google" | "demo"; places: PlaceSummary[] }> {
  if (!googleConfigured()) {
    const words = query.toLowerCase().split(/\s+/).filter(Boolean);
    const places = DEMO_PLACES.filter((p) =>
      words.some((w) => `${p.name} ${p.category} ${p.types.join(" ")}`.toLowerCase().includes(w)),
    );
    return { source: "demo", places: places.length ? places : DEMO_PLACES.slice(0, 6) };
  }
  const data = await google("https://places.googleapis.com/v1/places:searchText", {
    method: "POST",
    fieldMask: "places.id,places.displayName,places.formattedAddress,places.location,places.primaryTypeDisplayName,places.types",
    body: {
      textQuery: query,
      pageSize: 8,
      ...(bias ? { locationBias: { circle: { center: { latitude: bias.lat, longitude: bias.lng }, radius: 30_000 } } } : {}),
    },
  });
  const places = (Array.isArray(data.places) ? data.places : []).map(toSummary).filter((p: PlaceSummary) => Number.isFinite(p.lat));
  return { source: "google", places };
}

export async function placeDetails(placeId: string): Promise<PlaceDetails> {
  const demo = DEMO_PLACES.find((p) => p.placeId === placeId);
  if (demo) return { ...demo, openingHours: null, openNow: null, googleMapsUri: null };
  if (!/^[A-Za-z0-9_-]{10,300}$/.test(placeId)) throw new HttpError(400, "That isn't a place id.");
  const data = await google(`https://places.googleapis.com/v1/places/${encodeURIComponent(placeId)}`, {
    method: "GET",
    fieldMask:
      "id,displayName,formattedAddress,location,primaryTypeDisplayName,types,regularOpeningHours.weekdayDescriptions,currentOpeningHours.openNow,googleMapsUri",
  });
  return {
    ...toSummary(data),
    openingHours: data.regularOpeningHours?.weekdayDescriptions ?? null,
    openNow: typeof data.currentOpeningHours?.openNow === "boolean" ? data.currentOpeningHours.openNow : null,
    googleMapsUri: data.googleMapsUri ?? null,
  };
}

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

// One Routes API call per mode (the API takes a single travelMode per
// request), run in parallel. Each mode's outcome is reported on its own: a
// missing transit route never hides a walking one.
export async function computeRouteOptions(
  originPlaceId: string,
  destinationPlaceId: string,
  departure: Date | null,
  now = Date.now(),
): Promise<RouteOption[]> {
  const fieldMask = [
    "routes.duration",
    "routes.distanceMeters",
    "routes.legs.steps.travelMode",
    "routes.legs.steps.staticDuration",
    "routes.legs.steps.distanceMeters",
    "routes.legs.steps.transitDetails",
  ].join(",");

  const one = async (mode: Mode): Promise<RouteOption> => {
    const body: Record<string, unknown> = {
      origin: { placeId: originPlaceId },
      destination: { placeId: destinationPlaceId },
      travelMode: mode,
      languageCode: "en",
      units: "METRIC",
    };
    if (mode === "TRANSIT") {
      if (!departure) {
        return { mode, status: "error", message: "Give the earlier stop a start time to look up transit departures." };
      }
      const t = departure.getTime();
      if (t < now - TRANSIT_PAST_MS || t > now + TRANSIT_FUTURE_MS) {
        return {
          mode,
          status: "error",
          message: "Google only provides transit schedules from 7 days ago to 100 days ahead, and this departure is outside that window.",
        };
      }
      body.departureTime = departure.toISOString();
    }
    try {
      const data = await google("https://routes.googleapis.com/directions/v2:computeRoutes", { method: "POST", fieldMask, body });
      const route = Array.isArray(data.routes) ? data.routes[0] : undefined;
      if (!route) return { mode, status: "none", message: `Google found no ${mode.toLowerCase()} route between these places.` };
      return {
        mode,
        status: "ok",
        durationSec: seconds(route.duration),
        distanceM: Number(route.distanceMeters) || 0,
        steps: mode === "TRANSIT" ? summariseSteps((route.legs ?? []).flatMap((l: any) => l.steps ?? [])) : undefined,
      };
    } catch (err) {
      return { mode, status: "error", message: err instanceof Error ? err.message : "Route lookup failed." };
    }
  };

  return Promise.all((["WALK", "TRANSIT", "DRIVE"] as Mode[]).map(one));
}
