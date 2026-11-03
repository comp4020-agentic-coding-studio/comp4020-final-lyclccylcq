import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { CURATED, DESTINATIONS } from "../src/curated.ts";
import { DESTINATIONS_ZH, ITINERARIES_ZH } from "../src/curated-zh.ts";
import { openDb } from "../src/db.ts";
import { createItineraryStore } from "../src/itineraries.ts";
import { withLang } from "../src/lang.ts";

// Wayline's curated content has a hand-written Chinese version
// (src/curated-zh.ts), laid over the English at read time. Every
// destination, itinerary, stop title and note needs one, and none may be
// left blank or still in English.
const filled = (zh: string | undefined, en: string) => {
  expect(zh, en).toBeTypeOf("string");
  expect((zh as string).trim(), en).not.toBe("");
  expect(zh, en).not.toBe(en);
};

describe("Chinese curated content", () => {
  it("covers every destination", () => {
    for (const d of DESTINATIONS) {
      const zh = DESTINATIONS_ZH[d.id];
      expect(zh, d.id).toBeDefined();
      filled(zh.name, d.name);
      filled(zh.region, d.region);
      filled(zh.blurb, d.blurb);
    }
    expect(Object.keys(DESTINATIONS_ZH).sort()).toEqual(DESTINATIONS.map((d) => d.id).sort());
  });

  it("covers every itinerary, stop title and note", () => {
    for (const c of CURATED) {
      const zh = ITINERARIES_ZH[c.slug];
      expect(zh, c.slug).toBeDefined();
      filled(zh.title, c.title);
      filled(zh.destination, c.destination);
      filled(zh.description, c.description);
      for (const s of c.stops) {
        filled(zh.stops[s.title], s.title);
        if (s.note) filled(zh.notes?.[s.note], s.note);
      }
      // nothing left over from a renamed stop or note
      expect(Object.keys(zh.stops).sort(), c.slug).toEqual([...new Set(c.stops.map((s) => s.title))].sort());
      expect(Object.keys(zh.notes ?? {}).sort(), c.slug).toEqual([...new Set(c.stops.flatMap((s) => (s.note ? [s.note] : [])))].sort());
    }
    expect(Object.keys(ITINERARIES_ZH).sort()).toEqual(CURATED.map((c) => c.slug).sort());
  });

  it("is served by language at read time, matching on the English keys", () => {
    const store = createItineraryStore(openDb(mkdtempSync(join(tmpdir(), "wayline-curated-zh-"))));
    store.seed();
    const en = store.get("tpl-kyoto-shrines-gion");
    expect(en.title).toBe("Kyoto: Shrines, Bamboo & Gion");
    const zh = withLang("zh", () => store.get("tpl-kyoto-shrines-gion"));
    expect(zh.title).toBe(ITINERARIES_ZH["kyoto-shrines-gion"].title);
    expect(zh.stops[0].title).toBe("伏见稻荷大社");
    expect(zh.stops.map((s) => s.placeQuery)).toEqual(en.stops.map((s) => s.placeQuery));
    const kyoto = withLang("zh", () => store.destinations()).find((d) => d.id === "kyoto");
    expect(kyoto).toMatchObject({ name: "京都", country: "Japan", area: "East Asia" });
    // a wished-for place still matches in Chinese, and the answer names the stop in Chinese
    const want = { origin: { lat: 35.0116, lng: 135.7681 }, places: [{ lat: 34.9671, lng: 135.7727, placeId: null }], food: ["market" as const], days: null };
    const hit = withLang("zh", () => store.match(want)).results.find((r) => r.id === "tpl-kyoto-shrines-gion");
    expect(hit?.match.places[0]?.stop).toBe("伏见稻荷大社");
    expect(hit?.match.food[0]?.stops).toContain("锦市场");
  });
});
