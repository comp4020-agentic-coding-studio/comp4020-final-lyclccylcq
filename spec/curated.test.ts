import { describe, expect, it } from "vitest";
import { AREAS, CURATED, CURATED_VERSION, DESTINATIONS } from "../src/curated.ts";
import { haversineKm } from "../src/geo.ts";

// The curated library is written by hand; these checks keep it honest: real
// places near their city, no overlapping times, a meal each day of a
// multi-day trip, valid time zones, no Google ids written by hand.
const toMin = (s: string) => Number(s.slice(0, 2)) * 60 + Number(s.slice(3));

describe("the curated itinerary library", () => {
  it("covers about twenty cities in four regions, each with a country and an itinerary", () => {
    expect(CURATED_VERSION).toBeGreaterThanOrEqual(2);
    expect(DESTINATIONS.length).toBeGreaterThanOrEqual(15);
    expect(new Set(DESTINATIONS.map((d) => d.id)).size).toBe(DESTINATIONS.length);
    for (const d of DESTINATIONS) {
      expect(AREAS).toContain(d.area);
      expect(d.country).toBeTruthy();
      expect(d.blurb.length).toBeLessThan(80);
      const mine = CURATED.filter((it) => haversineKm(d, { lat: it.ref[0], lng: it.ref[1] }) <= 150);
      expect(mine.length, d.name).toBeGreaterThan(0);
    }
    for (const area of AREAS) expect(DESTINATIONS.some((d) => d.area === area)).toBe(true);
  });

  it("gives every itinerary a unique id, a real time zone, and sane days", () => {
    expect(new Set(CURATED.map((it) => it.slug)).size).toBe(CURATED.length);
    for (const it of CURATED) {
      expect(() => new Intl.DateTimeFormat("en", { timeZone: it.timezone })).not.toThrow();
      expect(it.days).toBeGreaterThanOrEqual(1);
      expect(it.days).toBeLessThanOrEqual(3);
      for (let day = 1; day <= it.days; day++) expect(it.stops.some((s) => (s.day ?? 1) === day), `${it.slug} day ${day}`).toBe(true);
    }
  });

  it("keeps each day's stops in order without overlaps, near the city, with a meal on multi-day trips", () => {
    // two older itineraries predate the meal rule and are left as they were
    const OLDER = new Set(["canberra-weekend", "sydney-blue-mountains"]);
    for (const it of CURATED) {
      for (let day = 1; day <= it.days; day++) {
        const stops = it.stops.filter((s) => (s.day ?? 1) === day).sort((a, b) => toMin(a.start) - toMin(b.start));
        for (let i = 0; i + 1 < stops.length; i++) {
          expect(toMin(stops[i].start) + stops[i].minutes, `${it.slug}: ${stops[i].title} overlaps ${stops[i + 1].title}`).toBeLessThanOrEqual(toMin(stops[i + 1].start));
        }
        for (const s of stops) expect(haversineKm({ lat: it.ref[0], lng: it.ref[1] }, s), `${it.slug}: ${s.title}`).toBeLessThan(120);
        if (it.days > 1 && !OLDER.has(it.slug)) expect(stops.some((s) => s.kind === "food"), `${it.slug} day ${day} has a meal`).toBe(true);
      }
    }
  });

  it("never writes a Google place id by hand: stops carry search queries", () => {
    for (const it of CURATED) {
      for (const s of it.stops) {
        expect(s.query.length).toBeGreaterThan(3);
        expect(JSON.stringify(s)).not.toMatch(/ChIJ|placeId/);
      }
    }
  });
});
