import { existsSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, inject, it, vi } from "vitest";
import { CURATED } from "../src/curated.ts";
import { chromePath, launch, type Page, sleep } from "./browser.ts";

// The scroll-driven prototype was superseded by the user's homepage
// requirement: automatic playback with ordinary page scrolling.
const baseUrl = inject("baseUrl");
const JOURNEY = "../public/journey.js";
const J: any = await import(JOURNEY);

const sizes = [[1920, 880], [1440, 780], [1366, 648], [768, 900], [390, 724]];

describe("automatic journey playback", () => {
  it("visits all five destinations and loops from Shanghai to Switzerland", () => {
    expect(J.SCENES.map((s: any) => s.id)).toEqual(["switzerland", "london", "sydney", "maldives", "shanghai"]);
    const p = J.createPlayback();
    const seen = new Set<number>();
    for (let n = 0; n < Math.ceil(J.CYCLE / 0.05) + 1; n++) {
      seen.add(p.state().label);
      p.tick(0.05);
    }
    expect([...seen]).toEqual([0, 1, 2, 3, 4]);
    expect(p.state()).toMatchObject({ kind: "scene", scene: 0 });
    expect(J.stateAt(J.CYCLE)).toMatchObject({ kind: "scene", scene: 0 });
    expect(J.stateAt(Number.NaN)).toMatchObject({ kind: "scene", scene: 0 });
  });

  it("waits for an undecoded next photo, then continues", () => {
    const p = J.createPlayback();
    for (let n = 0; n < 120; n++) p.tick(0.1, () => false);
    expect(p.state()).toMatchObject({ kind: "scene", scene: 0 });
    expect(p.clock).toBeLessThan(J.TIMING.hold);
    p.tick(0.1, () => true);
    expect(p.state().kind).toBe("tunnel");
  });

  // A pick runs the same tunnel as the journey, then a full hold. Rapid
  // picks never overlap tunnels or flash a scene: before the scene ahead
  // has been seen the tunnel is retargeted; after, the pick waits.
  it("tunnels to a picked destination, restarts its hold, and handles rapid picks", () => {
    const p = J.createPlayback();
    p.tick(1);
    p.select(2);
    expect(p.state()).toMatchObject({ kind: "tunnel", scene: 0, next: 2, jumping: true });
    p.tick(0.2);
    p.select(4); // still showing Switzerland: retarget
    expect(p.state()).toMatchObject({ next: 4 });
    while (p.state().jumping) p.tick(0.05);
    expect(p.state()).toMatchObject({ kind: "scene", scene: 4, clock: J.sceneStart(4) });
    expect(p.layers().map((x: any) => x.scene)).toEqual([4]);
    // late in a tunnel (the next scene already showing): the pick waits for it
    p.select(1);
    while (p.state().t < 0.8) p.tick(0.05);
    p.select(3);
    expect(p.state()).toMatchObject({ next: 1, queued: 3 });
    while (p.state().next === 1) p.tick(0.05);
    // the first tunnel finished, then the queued one began: never both
    expect(p.state()).toMatchObject({ kind: "tunnel", scene: 1, next: 3, queued: null });
    while (p.state().jumping) p.tick(0.05);
    expect(p.state()).toMatchObject({ kind: "scene", scene: 3, queued: null });
    // never more than one scene drawn, at any moment of any of this
    p.select(0);
    for (let n = 0; n < 60; n++) {
      expect(p.layers().length).toBe(1);
      if (n % 7 === 0) p.select(n % 5);
      p.tick(0.05);
    }
    p.select(1, { instant: true });
    expect(p.state()).toMatchObject({ kind: "scene", scene: 1, jumping: false, clock: J.sceneStart(1) });
    expect(() => p.select(8)).toThrow(RangeError);
    const c = p.clock;
    p.tick(Number.NaN);
    p.tick(-2);
    expect(p.clock).toBe(c);
  });

  // Regression: four of five boundaries used to be crossfades, two photos
  // dissolving into each other. Every boundary, the last back to the
  // first included, is now the same tunnel, and the swap is only ever
  // behind its wall.
  it("joins every pair of destinations, Shanghai back to Switzerland too, with one tunnel", () => {
    expect(J.TRANSITIONS.map((t: any) => t.kind)).toEqual(Array(5).fill("tunnel"));
    for (let i = 0; i < J.SCENES.length; i++) {
      const at = (t: number) => J.sceneStart(i) + J.TIMING.hold + J.TIMING.move * t;
      for (let t = 0; t < 1; t += 0.02) {
        const layers = J.layersAt(at(t));
        expect(layers.length).toBe(1);
        expect(layers[0].opacity).toBe(1);
        // the photo changes only while the wall covers all the glass
        if (layers[0].scene !== J.layersAt(at(Math.max(0, t - 0.02)))[0].scene) expect(J.band(t).covered, `${i} ${t}`).toBe(1);
      }
    }
    // dark for well under a second, the transition itself 1–2 seconds
    const dark = Array.from({ length: 1001 }, (_, k) => k / 1000).filter((t) => J.band(t).covered === 1).length / 1000;
    expect(dark * J.TIMING.move).toBeLessThan(0.6);
    expect(J.TIMING.move).toBeGreaterThanOrEqual(1);
    expect(J.TIMING.move).toBeLessThanOrEqual(2);
  });

  // Regression: drawn trees, masts, railings and palms composited over the
  // photos looked like stickers. Nothing moves over a photo now: each
  // scene's only motion is a gentle drift within its own photo, never
  // faster than a few percent of the window a second, and every scene has
  // some.
  it("moves each scene only by a gentle drift within its photo", () => {
    for (const s of J.SCENES) {
      expect(s.track, s.id).toBeUndefined();
      const persec = s.photo.pan / (J.TIMING.hold + 2 * J.TIMING.move);
      expect(persec, s.id).toBeGreaterThan(0.005);
      expect(persec, s.id).toBeLessThan(0.03);
    }
    expect(existsSync("public/journey-track.js")).toBe(false);
    expect(existsSync("public/img/train/pass-spruce.webp")).toBe(false);
  });

  it("keeps each photo whole, covering the glass throughout its pan at desktop and phone sizes", () => {
    for (const [w, h] of sizes) {
      const f = J.fitWindow(w, h);
      const g = f.glass;
      expect(g.w * g.h / (w * h)).toBeGreaterThan(0.9);
      // a thin margin, the same on all four sides: no heavy bottom band
      expect(f.frame).toBeLessThanOrEqual(14);
      expect(g.x).toBe(w - g.x - g.w);
      expect(g.y).toBe(h - g.y - g.h);
      expect(f.radius).toBeGreaterThan(0);
      for (const s of J.SCENES) for (const u of [-1, -0.5, 0, 0.5, 1]) {
        const r = J.placePhoto(s, g, u, f.portrait, f.portrait ? J.PHONE_VIEW : 1);
        const at = `${s.id} ${w}x${h} ${u}`;
        expect(r.x, at).toBeLessThanOrEqual(g.x + 0.1);
        expect(r.y, at).toBeLessThanOrEqual(g.y + 0.1);
        expect(r.x + r.w, at).toBeGreaterThanOrEqual(g.x + g.w - 0.1);
        expect(r.y + r.h, at).toBeGreaterThanOrEqual(g.y + g.h - 0.1);
        expect(r.w / r.h, at).toBeCloseTo(s.photo.w / s.photo.h, 6);
        if (s.photo.tip !== undefined) expect(r.y + s.photo.tip * r.h, at).toBeGreaterThanOrEqual(g.y - 1);
      }
    }
  });

  it("links to existing itineraries, with map destinations for Switzerland and Maldives", () => {
    const slugs = new Set(CURATED.map((c) => `/itineraries/${c.slug}`));
    for (const s of J.SCENES) {
      const go = J.exploreFor(s);
      if (go.href) expect(slugs.has(go.href), s.id).toBe(true);
      else expect(go.search).toMatchObject({ label: expect.any(String), lat: expect.any(Number), lng: expect.any(Number) });
    }
  });
});

describe("journey media", () => {
  it("ships every image with accurate dimensions, a bounded download size and a credit", () => {
    let total = 0;
    const credits = readFileSync("public/img/train/CREDITS.md", "utf8");
    for (const s of J.SCENES) {
      const path = `public/img/train/${s.id}.webp`;
      expect(existsSync(path), s.id).toBe(true);
      const b = readFileSync(path);
      const kind = b.toString("ascii", 12, 16);
      const size = kind === "VP8X" ? [b.readUIntLE(24, 3) + 1, b.readUIntLE(27, 3) + 1] : [b.readUInt16LE(26) & 0x3fff, b.readUInt16LE(28) & 0x3fff];
      expect(size, s.id).toEqual([s.photo.w, s.photo.h]);
      expect(b.length).toBeLessThan(760 * 1024);
      total += b.length;
      const c = J.CREDITS.find((x: any) => x.scene === s.id);
      expect(c).toBeDefined();
      expect(credits).toContain(c.page);
      expect(credits).toContain(c.author);
    }
    expect(existsSync("public/img/train/frame-h.webp")).toBe(false); // the walnut picture frame is gone

    expect(total).toBeLessThan(4 * 1024 * 1024);
  });

  it("serves the images and preview safely", async () => {
    for (const s of J.SCENES) {
      const r = await fetch(new URL(`/img/train/${s.id}.webp`, baseUrl));
      expect(r.status).toBe(200);
      expect(r.headers.get("content-type")).toBe("image/webp");
      expect(r.headers.get("cache-control")).toMatch(/max-age=\d+/);
    }
    for (const path of ["/img/train/%2e%2e%2fpackage.json", "/img/train/x/../../src/server.ts"]) {
      expect(await (await fetch(new URL(path, baseUrl))).text()).not.toMatch(/createServer|"devDependencies"/);
    }
    expect((await fetch(new URL("/experiments/pixel-train", baseUrl))).status).toBe(200);
  });
});

vi.setConfig({ testTimeout: 45_000, hookTimeout: 45_000 });
describe.skipIf(!chromePath)("homepage journey in a real browser", () => {
  let browser: Awaited<ReturnType<typeof launch>>;
  const open = async (reduced = false) => {
    const page = await browser!.newPage();
    if (reduced) await page.emulateMedia({ "prefers-reduced-motion": "reduce" });
    await page.viewport(1920, 1080);
    await page.goto(baseUrl);
    await page.waitFor("window.__journey?.state().loaded[0]", 15000);
    return page;
  };
  beforeAll(async () => { browser = await launch(); });
  afterAll(() => browser?.close());

  it("automatically visits every scene and loops without changing the scroll position", async () => {
    const page = await open();
    await page.eval(`window.__journey.speed(20); window.__seen = []; window.__looped = false; window.__watch = setInterval(() => {
      const s = window.__journey.state();
      if (!window.__seen.includes(s.shown)) window.__seen.push(s.shown);
      if (window.__seen.length === 5 && s.shown === 0) window.__looped = true;
    }, 20)`);
    await page.waitFor("window.__looped", 25000);
    expect(await page.eval("window.__seen")).toEqual([0, 1, 2, 3, 4]);
    expect(await page.eval("scrollY")).toBe(0);
    await page.eval("clearInterval(window.__watch)");
  });

  it("pauses and resumes, switches destinations without scrolling, and clears itself on navigation", async () => {
    const page = await open();
    await page.click(".jh-pause");
    const clock = await page.eval("window.__journey.state().clock");
    await sleep(200);
    expect(await page.eval("window.__journey.state().clock")).toBe(clock);
    await page.click(".jh-stop:nth-child(3)");
    await page.waitFor("window.__journey.state().shown === 2");
    expect(await page.eval("window.__journey.state().layers")).toEqual(["sydney"]);
    expect(await page.eval("scrollY")).toBe(0);
    expect(await page.eval("document.querySelector('.jh-credit').textContent")).toContain("Dietmar Rabich");
    await page.click(".jh-pause");
    await page.waitFor("window.__journey.state().clock > " + Number(J.sceneStart(2) + 0.1));
    await page.click(".jh-actions a");
    await page.waitFor("location.pathname === '/itineraries/sydney-harbour-highlights'");
    expect(await page.eval("window.__journey")).toBeUndefined();
  });

  it("stays still for reduced motion, loads only the chosen photos and supports rapid selection", async () => {
    const page = await open(true);
    expect(await page.eval("window.__journey.state().requested")).toEqual([true, false, false, false, false]);
    expect(await page.eval("window.__journey.state().running")).toBe(false);
    await page.eval("document.querySelectorAll('.jh-stop')[2].click(); document.querySelectorAll('.jh-stop')[3].click()");
    await page.waitFor("window.__journey.state().shown === 3");
    await sleep(600);
    expect(await page.eval("window.__journey.state().shown")).toBe(3);
    expect(await page.eval("window.__journey.state().layers")).toEqual(["maldives"]);
    expect(await page.eval("document.querySelector('.jh-pause').hidden")).toBe(true);
    // no tunnel runs with reduced motion
    expect(await page.eval("window.__journey.state().tunnel")).toBeNull();
    await page.click(".jh-actions a");
    await page.waitFor("/Maldives/.test(document.querySelector('.chip-place')?.textContent ?? '')");
    expect(await page.eval("location.pathname")).toBe("/");
    expect(await page.eval("scrollY > 0")).toBe(true);
  });

  it("stops off screen, resumes on return, and responds to motion preference changes", async () => {
    const page = await open();
    await page.eval("scrollTo(0, 1200)");
    await page.waitFor("!window.__journey.state().running");
    const c = await page.eval("window.__journey.state().clock");
    await sleep(200);
    expect(await page.eval("window.__journey.state().clock")).toBe(c);
    await page.eval("scrollTo(0, 0)");
    await page.waitFor("window.__journey.state().running");
    await page.emulateMedia({ "prefers-reduced-motion": "reduce" });
    await page.waitFor("!window.__journey.state().running && document.querySelector('.jh-pause').hidden");
    await page.emulateMedia({ "prefers-reduced-motion": "no-preference" });
    await page.waitFor("window.__journey.state().running");
  });

  it("keeps a usable view when a selected photo fails to load", async () => {
    const page = await open(true);
    await page.offline(true);
    await page.click(".jh-stop:nth-child(3)");
    await page.waitFor("/unavailable/.test(document.querySelector('.jh [aria-live]').textContent)");
    expect(await page.eval("window.__journey.state().layers")).toEqual(["switzerland"]);
    expect(await page.eval("document.querySelector('.jh-place').textContent")).toBe("SWITZERLAND");
    await page.offline(false);
    await page.click(".jh-stop:nth-child(3)");
    await page.waitFor("window.__journey.state().shown === 2");
    expect(await page.eval("document.querySelector('.jh-credit').textContent")).toContain("Dietmar Rabich");
  });

  it("fits desktop and phone layouts and shows each replacement image without overflow", async () => {
    const page: Page = await open(true);
    for (const [w, h] of [[1920, 1080], [390, 844]]) {
      await page.viewport(w, h, w < 500);
      await page.waitFor(`window.__journey.state().glass.w < ${w} && document.querySelector('.jh').classList.contains('jh-portrait') === ${w < 500}`);
      for (const i of [0, 2, 3, 4]) {
        await page.eval(`document.querySelectorAll('.jh-stop')[${i}].click()`);
        await page.waitFor(`window.__journey.state().shown === ${i}`);
        const q = await page.eval<any>(`({ overflow: document.documentElement.scrollWidth > innerWidth, buttons: [...document.querySelectorAll('.jh-actions .btn')].map(e => e.getBoundingClientRect().toJSON()), image: window.__journey.state().photo(${i}), glass: window.__journey.state().glass })`);
        expect(q.overflow).toBe(false);
        for (const b of q.buttons) {
          expect(b.right).toBeLessThanOrEqual(w);
          expect(b.left).toBeGreaterThanOrEqual(0);
          expect(b.bottom).toBeLessThanOrEqual(h);
        }
        expect(q.image.x + q.image.w).toBeGreaterThanOrEqual(q.glass.x + q.glass.w - 1);
        if (i === 2 || i === 3) await page.screenshot(join(tmpdir(), `wayline-${w}-${J.SCENES[i].id}.png`));
      }
    }
  });

  // A pick while playing runs a tunnel, never a crossfade: one photo at a
  // time throughout. Afterwards the scene drifts, and nothing but the photo
  // is drawn over the glass.
  it("tunnels to a picked destination with only one photo ever on view, then drifts", async () => {
    const page = await open();
    await page.eval(`window.__seen = []; window.__watch = setInterval(() => { const s = window.__journey.state(); window.__seen.push([s.layers.length, Boolean(s.tunnel)]); }, 16)`);
    await page.click(".jh-stop:nth-child(5)");
    await page.waitFor("window.__journey.state().shown === 4 && !window.__journey.state().jumping", 8000);
    const seen = await page.eval<[number, boolean][]>("(clearInterval(window.__watch), window.__seen)");
    expect(seen.every(([n]) => n <= 1)).toBe(true);
    expect(seen.some(([, tunnel]) => tunnel)).toBe(true);
    await page.click(".jh-stop:nth-child(2)");
    await page.waitFor("window.__journey.state().shown === 1 && !window.__journey.state().jumping", 8000);
    const x0 = await page.eval<number>("window.__journey.state().photo(1).x");
    await sleep(1500);
    expect(await page.eval<number>("window.__journey.state().photo(1).x")).toBeLessThan(x0);
    expect(await page.eval("document.querySelectorAll('.jh canvas, .jh-trackside, .jh-passer').length")).toBe(0);
  });

  // Regression: a thick, nearly black band ran along the hero's bottom
  // edge (the hero's dark background showing through its deeper sill),
  // right above the light search section. The margin round the glass is
  // now the page's own background, the same on all four sides.
  it("sits on the page's own background, with no dark band above the search section", async () => {
    const page = await open();
    for (const [w, h] of [[1920, 1080], [390, 844]]) {
      await page.viewport(w, h, w < 500);
      await page.waitFor(`Math.abs(window.__journey.state().glass.w + 2 * window.__journey.state().frame - document.querySelector('.jh').clientWidth) < 1`);
      const q = await page.eval<any>(`(() => {
        const hero = document.querySelector('.jh'), g = window.__journey.state().glass;
        return { hero: getComputedStyle(hero).backgroundColor, page: getComputedStyle(document.querySelector('main.home')).backgroundColor,
          below: hero.clientHeight - g.y - g.h, above: g.y, left: g.x };
      })()`);
      expect(q.hero, `${w}`).toBe(q.page);
      expect(q.below, `${w}`).toBe(q.above);
      expect(q.below, `${w}`).toBe(q.left);
    }
  });

  it("credits every new scene, and keeps the original preview address working", async () => {
    const page = await open();
    await page.goto(new URL("/credits", baseUrl).href);
    await page.waitFor("document.querySelector('main h1')");
    for (const c of J.CREDITS) expect(await page.eval(`[...document.querySelectorAll('main a')].some(a => a.href === ${JSON.stringify(c.page)})`)).toBe(true);
    await page.goto(new URL("/experiments/pixel-train", baseUrl).href);
    await page.waitFor("window.__journey?.state().loaded[0]");
    expect(await page.eval("document.querySelectorAll('.jh').length")).toBe(1);
  });
});
