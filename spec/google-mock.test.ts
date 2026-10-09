import { createServer, type IncomingMessage } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { anon, signUp, startApp } from "./helpers.ts";

// MOCKED Google Maps Platform. These checks run a private copy of the app
// against a local stand-in that answers in the shapes Google's Places API
// (New), Routes API and Geocoding API document. They verify what Wayline
// sends and how it handles answers. They are NOT evidence that the live
// Google integration works; that needs real keys.

type Seen = { method: string; path: string; headers: IncomingMessage["headers"]; body: any };
const seen: Seen[] = [];
const KEY = "mock-server-key-never-in-responses";
let mock: ReturnType<typeof createServer>;
let app: Awaited<ReturnType<typeof startApp>>;
let base: string;

// A stand-in place near every curated stop except one, to exercise rejection.
function placesFor(body: any) {
  const c = body.locationBias?.circle?.center;
  if (String(body.textQuery).startsWith("Mount Ainslie")) {
    return [{ id: "ChIJ_far_away_result_x", location: { latitude: -33.86, longitude: 151.21 } }]; // Sydney: wrong place
  }
  if (c) return [{ id: `ChIJ_mock_${String(body.textQuery).replace(/[^A-Za-z]/g, "").slice(0, 20)}`, location: { latitude: c.latitude + 0.001, longitude: c.longitude }, displayName: { text: body.textQuery }, formattedAddress: "Mock St", primaryTypeDisplayName: { text: "Tourist attraction" }, types: ["tourist_attraction"] }];
  return [{ id: "ChIJ_plain_search_result", location: { latitude: 1, longitude: 2 }, displayName: { text: "Result" } }];
}

beforeAll(async () => {
  mock = createServer(async (req, res) => {
    let raw = "";
    for await (const c of req) raw += c;
    const url = new URL(req.url ?? "/", "http://x");
    seen.push({ method: req.method ?? "", path: url.pathname + url.search, headers: req.headers, body: raw ? JSON.parse(raw) : null });
    const send = (data: unknown, status = 200) => {
      res.writeHead(status, { "content-type": "application/json" });
      res.end(JSON.stringify(data));
    };
    const body = raw ? JSON.parse(raw) : {};
    if (url.pathname === "/v1/places:autocomplete") {
      return send({ suggestions: [{ placePrediction: { placeId: "ChIJ_paris_city_id", text: { text: "Paris, France" }, structuredFormat: { mainText: { text: "Paris" }, secondaryText: { text: "France" } } } }] });
    }
    if (url.pathname === "/v1/places:searchText") return send({ places: placesFor(body) });
    if (url.pathname === "/v1/places:searchNearby") {
      return send({ places: [{ id: "ChIJ_eiffel_tower_id", displayName: { text: "Eiffel Tower" }, location: { latitude: 48.8584, longitude: 2.2945 }, primaryTypeDisplayName: { text: "Tourist attraction" }, types: ["tourist_attraction"] }] });
    }
    if (url.pathname.endsWith("/media")) return send({ name: "x", photoUri: "https://lh3.googleusercontent.com/mock-photo" });
    if (url.pathname.startsWith("/v1/places/")) {
      return send({
        id: "ChIJ_paris_city_id",
        displayName: { text: "Paris" },
        formattedAddress: "Paris, France",
        location: { latitude: 48.8566, longitude: 2.3522 },
        types: ["locality"],
        regularOpeningHours: { weekdayDescriptions: ["Monday: Open 24 hours"] },
        googleMapsUri: "https://maps.google.com/?cid=1",
        photos: [{ name: "places/ChIJ_paris_city_id/photos/abc123", authorAttributions: [{ displayName: "A Photographer", uri: "https://maps.google.com/contrib/1" }] }],
      });
    }
    if (url.pathname === "/directions/v2:computeRoutes") {
      if (body.travelMode === "DRIVE") return send({}); // no route
      return send({ routes: [{ duration: "754s", distanceMeters: 980, polyline: { encodedPolyline: "_p~iF~ps|U_ulLnnqC_mqNvxq`@" } }] });
    }
    if (url.pathname === "/maps/api/geocode/json") {
      return send({ status: "OK", results: [{ formatted_address: "Paris, France", address_components: [{ long_name: "Paris", types: ["locality"] }, { long_name: "France", types: ["country"] }] }] });
    }
    send({ error: { message: "unknown mock path" } }, 404);
  });
  await new Promise<void>((r) => mock.listen(0, "127.0.0.1", r));
  const m = `http://127.0.0.1:${(mock.address() as AddressInfo).port}`;
  app = await startApp({
    GOOGLE_MAPS_SERVER_KEY: KEY,
    GOOGLE_PLACES_BASE_URL: m,
    GOOGLE_ROUTES_BASE_URL: m,
    GOOGLE_GEOCODE_BASE_URL: m,
  });
  base = app.url;
});

afterAll(async () => {
  await app?.stop();
  mock?.close();
});

const last = (path: string) => [...seen].reverse().find((s) => s.path.startsWith(path)) as Seen;

describe("Google service layer (mocked Google)", () => {
  it("autocompletes cities with a session token, and finishes the session with a basic details call", async () => {
    const c = anon(base);
    const r = await c.get("/api/places/autocomplete?q=par&kind=city&session=sess-12345678");
    expect(r.data).toEqual({ source: "google", suggestions: [{ placeId: "ChIJ_paris_city_id", main: "Paris", secondary: "France" }] });
    const req = last("/v1/places:autocomplete");
    expect(req.body).toMatchObject({ input: "par", sessionToken: "sess-12345678", includedPrimaryTypes: ["(cities)"] });
    expect(req.headers["x-goog-api-key"]).toBe(KEY);

    const d = await c.get("/api/places/ChIJ_paris_city_id?view=basic&session=sess-12345678");
    expect(d.data).toMatchObject({ name: "Paris", lat: 48.8566, source: "google" });
    const det = last("/v1/places/ChIJ_paris_city_id");
    expect(det.path).toContain("sessionToken=sess-12345678");
    expect(det.headers["x-goog-fieldmask"]).toBe("id,displayName,formattedAddress,location,types");
  });

  it("asks only for the fields each view uses", async () => {
    const c = anon(base);
    await c.get("/api/places/search?q=museum&type=museum&lat=48.85&lng=2.35");
    const s = last("/v1/places:searchText");
    expect(s.headers["x-goog-fieldmask"]).toBe("places.id,places.displayName,places.formattedAddress,places.location,places.primaryTypeDisplayName,places.types");
    expect(s.body).toMatchObject({ textQuery: "museum", includedType: "museum", pageSize: 8 });

    const n = await c.get("/api/places/nearby?lat=48.8566&lng=2.3522&radius=5000");
    expect(n.data.places[0]).toMatchObject({ name: "Eiffel Tower", source: "google" });
    expect(n.data.places[0].distanceKm).toBeGreaterThan(3);
    expect(last("/v1/places:searchNearby").body).toMatchObject({ includedTypes: ["tourist_attraction"], maxResultCount: 12, locationRestriction: { circle: { radius: 5000 } } });

    const full = await c.get("/api/places/ChIJ_paris_city_id");
    expect(full.data).toMatchObject({ openingHours: ["Monday: Open 24 hours"], photo: { name: "places/ChIJ_paris_city_id/photos/abc123", attributions: [{ displayName: "A Photographer" }] } });
    expect(last("/v1/places/ChIJ_paris_city_id").headers["x-goog-fieldmask"]).toContain("regularOpeningHours.weekdayDescriptions");
    const photo = await c.get(`/api/places/photo?name=${encodeURIComponent(full.data.photo.name)}`);
    expect(photo.data).toEqual({ uri: "https://lh3.googleusercontent.com/mock-photo" });
    expect((await c.get("/api/places/photo?name=../../etc")).status).toBe(400);
  });

  it("names the area around a point with the Geocoding API", async () => {
    const r = await anon(base).get("/api/geo/reverse?lat=48.8566&lng=2.3522");
    expect(r.data).toEqual({ label: "Paris, France", source: "google" });
  });

  it("returns route duration, distance and geometry; reports a missing route honestly", async () => {
    const c = anon(base);
    const walk = await c.send("POST", "/api/routes", { origin: { lat: 48.85, lng: 2.35 }, destination: { placeId: "ChIJ_paris_city_id" }, mode: "WALK" });
    expect(walk.data).toMatchObject({ mode: "WALK", status: "ok", durationSec: 754, distanceM: 980, polyline: "_p~iF~ps|U_ulLnnqC_mqNvxq`@" });
    const req = last("/directions/v2:computeRoutes");
    expect(req.body.origin).toEqual({ location: { latLng: { latitude: 48.85, longitude: 2.35 } } });
    expect(req.body.destination).toEqual({ placeId: "ChIJ_paris_city_id" });
    expect(req.headers["x-goog-fieldmask"]).toContain("routes.polyline.encodedPolyline");

    const drive = await c.send("POST", "/api/routes", { origin: { lat: 48.85, lng: 2.35 }, destination: { lat: 48.86, lng: 2.29 }, mode: "DRIVE" });
    expect(drive.data).toMatchObject({ status: "none" });
    expect(drive.data.durationSec).toBeUndefined();

    // the same question again within minutes: no second call to Google
    const calls = seen.filter((s) => s.path.startsWith("/directions")).length;
    await c.send("POST", "/api/routes", { origin: { lat: 48.85, lng: 2.35 }, destination: { placeId: "ChIJ_paris_city_id" }, mode: "WALK" });
    expect(seen.filter((s) => s.path.startsWith("/directions")).length).toBe(calls);

    // transit outside Google's schedule window is refused without a call
    const far = await c.send("POST", "/api/routes", { origin: { lat: 48.85, lng: 2.35 }, destination: { lat: 48.86, lng: 2.29 }, mode: "TRANSIT", departureTime: "2030-01-01T09:00:00Z" });
    expect(far.data).toMatchObject({ status: "error" });
    expect(seen.filter((s) => s.path.startsWith("/directions")).length).toBe(calls);
  });

  it("verifies curated stops against Google once, rejecting a match in the wrong place", async () => {
    const c = anon(base);
    const before = seen.filter((s) => s.path === "/v1/places:searchText").length;
    const t = (await c.get("/api/itineraries/tpl-canberra-lookouts-gardens")).data;
    const lookups = seen.filter((s) => s.path === "/v1/places:searchText").length - before;
    expect(lookups).toBe(3);
    const byTitle = Object.fromEntries(t.stops.map((s: any) => [s.title, s.placeId]));
    expect(byTitle["Australian National Botanic Gardens"]).toMatch(/^ChIJ_mock_/);
    expect(byTitle["Mount Ainslie Lookout"]).toBeNull(); // Google's answer was in Sydney
    expect(last("/v1/places:searchText").headers["x-goog-fieldmask"]).toBe("places.id,places.location");

    await c.get("/api/itineraries/tpl-canberra-lookouts-gardens");
    expect(seen.filter((s) => s.path === "/v1/places:searchText").length - before).toBe(3); // not asked again

    const owner = await signUp(base);
    const trip = (await owner.send("POST", "/api/itineraries/tpl-canberra-lookouts-gardens/copy", { startDate: "2026-12-05" })).data;
    const sources = trip.days[0].activities.map((a: any) => a.place.source);
    expect(sources).toEqual(["google", "google", "curated"]);
  });

  it("never puts the server key in a response", async () => {
    const c = anon(base);
    const bodies = await Promise.all(
      ["/api/config", "/api/places/ChIJ_paris_city_id", "/api/places/autocomplete?q=par", "/api/geo/reverse?lat=1&lng=1", "/api/itineraries/tpl-tokyo-kamakura"].map((p) => fetch(new URL(p, base)).then((r) => r.text())),
    );
    for (const b of bodies) expect(b).not.toContain(KEY);
  });
});
