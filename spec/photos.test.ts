import { existsSync, readFileSync } from "node:fs";
import { describe, expect, inject, it } from "vitest";
import { CURATED, DESTINATIONS } from "../src/curated.ts";

// Every curated itinerary and destination card has a real, credited photo,
// served from the app itself.
const baseUrl = inject("baseUrl");
const src = readFileSync("public/photos.js", "utf8");
const PHOTOS: Record<string, { src: string; w: number; h: number; alt: string; author: string | null; license: string; licenseUrl: string; page: string }> = JSON.parse(
  `{${src.slice(src.indexOf("export const PHOTOS = {") + "export const PHOTOS = {".length, src.indexOf("\n};"))}}`.replace(/,\s*}$/, "}"),
);

describe("destination photos", () => {
  it("has a photo for every curated itinerary and destination", () => {
    for (const t of CURATED) expect(PHOTOS[`tpl-${t.slug}`], t.slug).toBeTruthy();
    for (const d of DESTINATIONS) expect(PHOTOS[`dest-${d.id}`], d.id).toBeTruthy();
  });

  it("credits each one with a free license and its Commons page", () => {
    for (const [key, p] of Object.entries(PHOTOS)) {
      expect(p.alt, key).toBeTruthy();
      expect(p.license, key).toMatch(/^(CC0|Public domain|CC BY(-SA)? \d\.\d)$/);
      if (p.license !== "CC0" && p.license !== "Public domain") expect(p.author, key).toBeTruthy();
      expect(p.licenseUrl, key).toMatch(/^https:\/\/creativecommons\.org\//);
      expect(p.page, key).toMatch(/^https:\/\/commons\.wikimedia\.org\/wiki\/File:/);
      expect(p.w, key).toBeGreaterThanOrEqual(p.h);
      expect(existsSync(`public${p.src}`), key).toBe(true);
    }
  });

  it("serves the photos as cacheable JPEGs, and nothing outside public/img", async () => {
    for (const p of Object.values(PHOTOS)) {
      const r = await fetch(new URL(p.src, baseUrl));
      expect(r.status, p.src).toBe(200);
      expect(r.headers.get("content-type")).toBe("image/jpeg");
      expect(r.headers.get("cache-control")).toMatch(/max-age=\d+/);
    }
    for (const bad of ["/img/../package.json", "/img/covers/../../src/server.ts", "/src/server.ts"]) {
      const r = await fetch(new URL(bad, baseUrl));
      expect(await r.text(), bad).not.toMatch(/createServer|"devDependencies"/);
    }
    expect((await fetch(new URL("/credits", baseUrl))).status).toBe(200);
  });
});
