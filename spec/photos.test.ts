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
    // an itinerary may borrow its city's photo (SHARED_COVERS), never a missing one
    const shared: Record<string, string> = JSON.parse(`{${src.slice(src.indexOf("export const SHARED_COVERS = {") + "export const SHARED_COVERS = {".length, src.indexOf("\n};", src.indexOf("SHARED_COVERS")))}}`.replace(/,\s*}$/, "}"));
    for (const t of CURATED) expect(PHOTOS[`tpl-${t.slug}`] ?? PHOTOS[shared[`tpl-${t.slug}`]], t.slug).toBeTruthy();
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

// The homepage hero's clips: licensed, credited, self-hosted, with a poster,
// and served so a video player can ask for byte ranges.
describe("hero video clips", async () => {
  const vsrc = readFileSync("public/media.js", "utf8");
  const start = vsrc.indexOf("export const HERO_CLIPS = [") + "export const HERO_CLIPS = ".length;
  const CLIPS: { city: string; mp4: string; webm: string; poster: string; author: string | null; license: string; licenseUrl: string; page: string }[] = JSON.parse(vsrc.slice(start, vsrc.indexOf("\n];", start) + 2).replace(/,\s*]$/, "]"));

  it("credits each clip with a free license and its Commons page, and ships every file", () => {
    expect(CLIPS.length).toBeGreaterThan(0);
    for (const c of CLIPS) {
      expect(c.license, c.city).toMatch(/^(CC0|Public domain|CC BY(-SA)? \d\.\d( [A-Z]{2})?)$/); // a ported licence names its country
      if (c.license !== "CC0" && c.license !== "Public domain") expect(c.author, c.city).toBeTruthy();
      expect(c.licenseUrl, c.city).toMatch(/^https:\/\/creativecommons\.org\//);
      expect(c.page, c.city).toMatch(/^https:\/\/commons\.wikimedia\.org\/wiki\/File:/);
      for (const f of [c.mp4, c.webm, c.poster]) expect(existsSync(`public${f}`), f).toBe(true);
    }
  });

  it("rotates the chosen places, starting with a bright still (October 2026)", () => {
    // Seoul, Tokyo and Kyoto were replaced for low quality; their photos stay
    expect(CLIPS.map((c) => c.city)).toEqual(["Sydney", "London", "Venice", "New York", "Landwasser Viaduct", "Paris", "Shanghai"]);
    for (const gone of ["seoul", "tokyo", "kyoto"]) expect(existsSync(`public/video/hero-${gone}.mp4`), gone).toBe(false);
  });

  it("serves clips with byte ranges and a long cache, and nothing outside public/video", async () => {
    const c = CLIPS[0];
    const full = await fetch(new URL(c.mp4, baseUrl));
    expect(full.status).toBe(200);
    expect(full.headers.get("content-type")).toBe("video/mp4");
    expect(full.headers.get("accept-ranges")).toBe("bytes");
    expect(full.headers.get("cache-control")).toMatch(/max-age=\d+/);
    const size = (await full.arrayBuffer()).byteLength;
    const part = await fetch(new URL(c.mp4, baseUrl), { headers: { range: "bytes=0-99" } });
    expect(part.status).toBe(206);
    expect(part.headers.get("content-range")).toBe(`bytes 0-99/${size}`);
    expect((await part.arrayBuffer()).byteLength).toBe(100);
    const tail = await fetch(new URL(c.mp4, baseUrl), { headers: { range: "bytes=-10" } });
    expect(tail.headers.get("content-range")).toBe(`bytes ${size - 10}-${size - 1}/${size}`);
    expect((await fetch(new URL(c.mp4, baseUrl), { headers: { range: `bytes=${size}-` } })).status).toBe(416);
    expect((await fetch(new URL(c.webm, baseUrl))).headers.get("content-type")).toBe("video/webm");
    for (const bad of ["/video/../package.json", "/video/../src/server.ts", "/video/x/../../README.md"]) {
      const r = await fetch(new URL(bad, baseUrl));
      expect(await r.text(), bad).not.toMatch(/createServer|"devDependencies"/);
    }
  });
});
