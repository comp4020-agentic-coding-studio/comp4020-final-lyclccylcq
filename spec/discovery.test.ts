import { describe, expect, inject, it } from "vitest";
import { haversineKm } from "../src/geo.ts";
import { anon, signUp } from "./helpers.ts";

// Geographic discovery against the running app, whatever its configuration.
// Itinerary ranking is Wayline's own logic and never needs Google.
const baseUrl = inject("baseUrl");
const nobody = anon(baseUrl);
const ids = (r: any) => r.data.itineraries.map((t: any) => t.id);

describe("itinerary recommendations", () => {
  it("ranks curated itineraries by distance from the given point", async () => {
    const r = await nobody.get("/api/itineraries/nearby?lat=-35.2809&lng=149.13");
    expect(r.status).toBe(200);
    const list = r.data.itineraries;
    expect(list.length).toBe(4);
    expect(list.every((t: any) => t.destination === "Canberra")).toBe(true);
    const d = list.map((t: any) => t.distanceKm);
    expect(d).toEqual([...d].sort((a: number, b: number) => a - b));
  });

  it("measures distance, not city names: a point just over the ACT border still gets Canberra", async () => {
    // Queanbeyan, NSW: another city, about 12 km from Canberra's centre
    const r = await nobody.get("/api/itineraries/nearby?lat=-35.3535&lng=149.2340");
    expect(ids(r)).toContain("tpl-canberra-national-institutions");
    expect(r.data.itineraries.every((t: any) => t.distanceKm < 20)).toBe(true);
  });

  it("returns nothing for a point far from every itinerary", async () => {
    const r = await nobody.get("/api/itineraries/nearby?lat=-1.2921&lng=36.8219"); // Nairobi: no curated city near
    expect(r.status).toBe(200);
    expect(r.data.itineraries).toEqual([]);
  });

  it("includes a day trip outside the city, and filters by category", async () => {
    const all = await nobody.get("/api/itineraries/nearby?lat=-33.8688&lng=151.2093");
    expect(ids(all)).toContain("tpl-sydney-blue-mountains"); // ~80 km away
    expect(ids(all)[0]).not.toBe("tpl-sydney-blue-mountains");
    const weekend = await nobody.get("/api/itineraries/nearby?lat=-33.8688&lng=151.2093&category=weekend");
    expect(ids(weekend)).toEqual(["tpl-sydney-blue-mountains"]);
    const tight = await nobody.get("/api/itineraries/nearby?lat=-33.8688&lng=151.2093&radiusKm=20");
    expect(ids(tight)).not.toContain("tpl-sydney-blue-mountains");
  });

  it("doesn't echo precise coordinates back", async () => {
    const r = await nobody.get("/api/itineraries/nearby?lat=-35.281234&lng=149.128765");
    expect(r.data.origin).toEqual({ lat: -35.28, lng: 149.13 });
  });

  it("rejects bad input with a 400", async () => {
    for (const qs of ["lat=91&lng=0", "lat=0&lng=181", "lat=abc&lng=1", "lat=&lng=", "lat=0&lng=0&radiusKm=5000", "lat=0&lng=0&limit=0", "lat=0&lng=0&category=beach"]) {
      expect((await nobody.get(`/api/itineraries/nearby?${qs}`)).status, qs).toBe(400);
    }
    expect((await nobody.get("/api/places/autocomplete?q=a")).status).toBe(400);
    expect((await nobody.get("/api/places/nearby?lat=0&lng=0&radius=999999")).status).toBe(400);
    expect((await nobody.get("/api/places/nearby?lat=0&lng=0&type=casino")).status).toBe(400);
    expect((await nobody.get("/api/places/search?q=zoo&type=casino")).status).toBe(400);
    expect((await nobody.send("POST", "/api/routes", { origin: { lat: 200, lng: 0 }, destination: { lat: 0, lng: 0 } })).status).toBe(400);
    expect((await nobody.send("POST", "/api/routes", { origin: { lat: 1, lng: 0 }, destination: { lat: 0, lng: 0 }, mode: "FLY" })).status).toBe(400);
  });

  it("serves featured itineraries and the destination list", async () => {
    const f = await nobody.get("/api/itineraries/featured");
    expect(f.data.itineraries.length).toBeGreaterThan(0);
    expect(f.data.itineraries.every((t: any) => t.featured && t.source === "curated")).toBe(true);
    const d = await nobody.get("/api/itineraries/destinations");
    const names = d.data.destinations.map((x: any) => x.name);
    expect(names).toEqual(expect.arrayContaining(["Canberra", "Sydney", "Tokyo", "Paris", "London", "New York", "Seoul", "Shanghai", "Melbourne"]));
    // every destination says where it is, and has at least one itinerary
    for (const x of d.data.destinations) {
      expect(x).toMatchObject({ country: expect.any(String), area: expect.stringMatching(/^(Europe|North America|East Asia|Oceania)$/) });
      expect(x.itineraries, x.name).toBeGreaterThan(0);
    }
    // regions in order, each listing its countries
    expect(d.data.areas.map((a: any) => a.area)).toEqual(["Europe", "North America", "East Asia", "Oceania"]);
    expect(d.data.areas.find((a: any) => a.area === "East Asia").countries.sort()).toEqual(["China", "Japan", "South Korea"]);
  });

  it("tags each curated itinerary with its city, country and region, for browsing", async () => {
    const all = (await nobody.get("/api/itineraries")).data.itineraries;
    expect(all.length).toBeGreaterThanOrEqual(25);
    expect(new Set(all.map((t: any) => t.id)).size).toBe(all.length); // unique ids
    expect(all.every((t: any) => t.source === "curated")).toBe(true); // published trips aren't mixed in
    const seoul = all.find((t: any) => t.id === "tpl-seoul-palaces-markets");
    expect(seoul).toMatchObject({ destinationId: "seoul", country: "South Korea", area: "East Asia", days: 2 });
    // the old cities keep their ids and land in the right region
    expect(all.find((t: any) => t.id === "tpl-tokyo-asakusa-ueno")).toMatchObject({ destinationId: "tokyo", area: "East Asia" });
    expect(all.find((t: any) => t.id === "tpl-canberra-weekend")).toMatchObject({ destinationId: "canberra", area: "Oceania" });
  });

  it("copies a new city's two-day itinerary into a private trip, with its own time zone", async () => {
    const c = await signUp(baseUrl);
    const r = await c.send("POST", "/api/itineraries/tpl-paris-classic-weekend/copy", { startDate: "2026-12-05" });
    expect(r.status).toBe(201);
    expect(r.data).toMatchObject({ title: "Paris: The Classic Weekend", destination: "Paris", timezone: "Europe/Paris", startDate: "2026-12-05", endDate: "2026-12-06" });
    expect(r.data.days).toHaveLength(2);
    expect(r.data.members).toEqual([expect.objectContaining({ id: c.userId, role: "owner" })]);
    // no invented place ids: unmatched stops stay curated approximations
    for (const a of r.data.days.flatMap((d: any) => d.activities)) {
      expect(["google", "curated"]).toContain(a.place.source);
      if (a.place.source === "curated") expect(a.place.placeId.startsWith("tpl:")).toBe(true);
    }
  });

  it("describes each itinerary with ordered stops and no invented Google data", async () => {
    const r = await nobody.get("/api/itineraries/tpl-sydney-blue-mountains");
    expect(r.status).toBe(200);
    const t = r.data;
    expect(t).toMatchObject({ title: "Blue Mountains Weekend", days: 2, source: "curated", timezone: "Australia/Sydney" });
    expect(t.stops.map((s: any) => [s.day, s.position])).toEqual([[1, 0], [1, 1], [1, 2], [2, 0], [2, 1]]);
    for (const s of t.stops) {
      expect(s.placeQuery).toBeTruthy();
      // every stop is near the itinerary's reference point
      expect(haversineKm(s, t.ref)).toBeLessThan(15);
    }
    // no fabricated popularity or ratings anywhere
    expect(JSON.stringify(t)).not.toMatch(/rating|review|popular|likes|views/i);
    expect((await nobody.get("/api/itineraries/tpl-nowhere")).status).toBe(404);
  });
});

describe("copying an itinerary into a trip", () => {
  it("needs an account", async () => {
    expect((await nobody.send("POST", "/api/itineraries/tpl-tokyo-kamakura/copy", { startDate: "2026-12-05" })).status).toBe(401);
  });

  it("creates the user's own trip, one day per itinerary day, stops in order", async () => {
    const c = await signUp(baseUrl);
    const r = await c.send("POST", "/api/itineraries/tpl-sydney-blue-mountains/copy", { startDate: "2026-12-05" });
    expect(r.status).toBe(201);
    const trip = r.data;
    expect(trip).toMatchObject({ title: "Blue Mountains Weekend", startDate: "2026-12-05", endDate: "2026-12-06", timezone: "Australia/Sydney" });
    expect(trip.members).toEqual([expect.objectContaining({ id: c.userId, role: "owner" })]);
    expect(trip.days[0].activities.map((a: any) => a.title)).toEqual(["Echo Point Lookout", "Scenic World", "Leura Mall"]);
    expect(trip.days[1].activities.map((a: any) => a.title)).toEqual(["Wentworth Falls", "Govetts Leap Lookout"]);
    for (const a of trip.days.flatMap((d: any) => d.activities)) {
      expect(["google", "curated"]).toContain(a.place.source);
      if (a.place.source === "curated") expect(a.place.placeId.startsWith("tpl:")).toBe(true);
    }
    expect((await c.get("/api/trips")).data.owned.map((t: any) => t.id)).toContain(trip.id);
    expect((await c.send("POST", "/api/itineraries/tpl-sydney-blue-mountains/copy", { startDate: "not-a-date" })).status).toBe(400);
  });
});

describe("Google-backed discovery without a key", () => {
  it("falls back to labelled demo data, and never invents a route", async () => {
    const config = (await nobody.get("/api/config")).data;
    if (config.places === "google") return; // the app under test has a real key
    const ac = await nobody.get("/api/places/autocomplete?q=syd&session=abcdefgh12");
    expect(ac.data).toEqual({ source: "demo", suggestions: [expect.objectContaining({ placeId: "demo-city:sydney", main: "Sydney" })] });
    const basic = await nobody.get("/api/places/demo-city%3Asydney?view=basic");
    expect(basic.data).toMatchObject({ source: "demo", name: "Sydney" });
    const near = await nobody.get("/api/places/nearby?lat=-33.8688&lng=151.2093&radius=5000");
    expect(near.data.source).toBe("demo");
    expect(near.data.places.every((p: any) => p.distanceKm <= 5)).toBe(true);
    expect((await nobody.get("/api/geo/reverse?lat=-35.30&lng=149.12")).data).toEqual({ label: "Near Canberra", source: "approximate" });
    expect((await nobody.get("/api/geo/reverse?lat=48.85&lng=2.35")).data).toEqual({ label: "Near Paris", source: "approximate" }); // a curated city now
    expect((await nobody.get("/api/geo/reverse?lat=-1.29&lng=36.82")).data).toEqual({ label: "Your location", source: "approximate" }); // far from all of them
    const route = await nobody.send("POST", "/api/routes", { origin: { lat: -33.86, lng: 151.21 }, destination: { lat: -33.85, lng: 151.2 }, mode: "WALK" });
    expect(route.status).toBe(503);
    expect(route.data.durationSec).toBeUndefined();
    expect((await nobody.get("/api/places/photo?name=places/x/photos/y")).status).toBe(503);
  });
});
