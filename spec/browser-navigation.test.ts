import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { chromePath, inPage, launch, signUpIn, sleep } from "./browser.ts";
import { uniqueName } from "./helpers.ts";

// Leaving a page while it's still loading. The itinerary page awaits its
// itinerary and then its map; if the person has gone elsewhere by then (the
// brand back home, Sign in), what arrives late must change nothing: not the
// new page, not its address, no uncaught error. Found in production: a late
// itinerary drew Sydney over the homepage at "/", or threw reading the
// login page's <main>.
const baseUrl = inject("baseUrl");
let browser: NonNullable<Awaited<ReturnType<typeof launch>>>;
beforeAll(async () => {
  if (chromePath) browser = (await launch())!;
});
afterAll(() => browser?.close());

// Holds the page's answers to GET /api/itineraries/<id> (the real server
// answers at once; only handing the answer to the page waits) until
// __release(); records uncaught errors and rejections. With slowMap, the
// config gets a (fake) browser key and Google's loader waits for
// __releaseMap(), then fails, so the map is made after it's released: the
// schematic fallback, as when Google refuses a key.
const harness = (slowMap: boolean) => `
  window.__errors = [];
  addEventListener('error', (e) => window.__errors.push(String(e.message)));
  addEventListener('unhandledrejection', (e) => window.__errors.push(String(e.reason && e.reason.stack || e.reason)));
  window.__held = [];
  window.__release = () => { for (const go of window.__held.splice(0)) go(); };
  const realFetch = window.fetch;
  window.fetch = (u, o) => {
    const url = String(u);
    if (/\\/api\\/itineraries\\/[a-z0-9-]+$/.test(url) && (!o || !o.method || o.method === 'GET')) {
      const res = realFetch(u, o);
      return new Promise((go) => window.__held.push(() => go(res)));
    }
    if (${slowMap} && url.endsWith('/api/config')) {
      return realFetch(u, o).then(async (r) => { const c = await r.json(); c.mapsBrowserKey = 'test-key-not-real'; return new Response(JSON.stringify(c), { status: 200, headers: { 'content-type': 'application/json' } }); });
    }
    return realFetch(u, o);
  };
  if (${slowMap}) {
    window.__mapWaits = [];
    window.__releaseMap = () => { for (const go of window.__mapWaits.splice(0)) go(); };
    window.google = { maps: { importLibrary: () => new Promise((_, no) => window.__mapWaits.push(() => no(new Error('test: no Google here')))) } };
  }
`;

const VIEWPORTS = [
  { w: 1920, h: 1080, m: false },
  { w: 390, h: 844, m: true },
];

describe.skipIf(!chromePath)("leaving an itinerary while it's loading", () => {
  for (const vp of VIEWPORTS) {
    for (const outcome of ["found", "missing"] as const) {
      const id = outcome === "found" ? "tpl-sydney-harbour-highlights" : "tpl-no-such-itinerary";
      it(`back home by the brand: the late ${outcome === "found" ? "itinerary" : "error"} doesn't replace the homepage (${vp.w}×${vp.h})`, async () => {
        const page = await browser.newPage();
        await page.viewport(vp.w, vp.h, vp.m);
        await page.initScript(harness(false));
        await page.goto(new URL(`/itineraries/${id}`, baseUrl).href);
        await page.waitFor(`window.__held.length === 1 && /Loading itinerary/.test(document.body.textContent)`, 8000);
        // a real click on the brand, while the itinerary is on its way
        await page.tap(".topbar .brand");
        await page.waitFor(`location.pathname === '/' && document.querySelector('#explore-map')`, 8000);
        await page.eval(`window.__release()`);
        await sleep(800);
        expect(await page.eval(`location.pathname`)).toBe("/");
        expect(await page.eval(`Boolean(document.querySelector('#explore-map'))`)).toBe(true);
        expect(await page.eval(`Boolean(document.querySelector('main.preview, .preview-grid, .pv-stops'))`)).toBe(false);
        // (the homepage lists curated trips itself, Sydney's among them; what
        // mustn't be here is the preview's page or its "not found" card)
        expect(await page.eval(`Boolean(document.querySelector('.preview-panel h1, .pv-meta, .invite-card'))`)).toBe(false);
        expect(await page.eval(`/Itinerary not found/.test(document.body.textContent)`)).toBe(false);
        expect(await page.eval(`window.__errors`)).toEqual([]);
        // and the homepage still works: its search answers
        await page.eval(`(() => { const i = document.querySelector('input[placeholder="Search a city or destination"]'); i.focus(); })()`);
        expect(await page.eval(`document.activeElement.tagName`)).toBe("INPUT");
      });

      it(`to Sign in: the late ${outcome === "found" ? "itinerary" : "error"} doesn't touch the login page (${vp.w}×${vp.h})`, async () => {
        const page = await browser.newPage();
        await page.viewport(vp.w, vp.h, vp.m);
        await page.initScript(harness(false));
        await page.goto(new URL(`/itineraries/${id}`, baseUrl).href);
        await page.waitFor(`window.__held.length === 1`, 8000);
        // the bar's Sign in (on phones it may sit behind the account button)
        await page.waitFor(`[...document.querySelectorAll('.topbar a[href^="/login"]')].some((a) => a.offsetParent)`, 5000);
        await page.eval(`window.__signIn = [...document.querySelectorAll('.topbar a[href^="/login"]')].find((a) => a.offsetParent); window.__signIn.setAttribute('data-test-signin', '')`);
        await page.tap("[data-test-signin]");
        await page.waitFor(`location.pathname === '/login' && document.querySelector('form input[name=username], form input[autocomplete=username]')`, 8000);
        await page.eval(`window.__release()`);
        await sleep(800);
        expect(await page.eval(`location.pathname`)).toBe("/login");
        expect(await page.eval(`Boolean(document.querySelector('form input[name=username], form input[autocomplete=username]'))`)).toBe(true);
        expect(await page.eval(`Boolean(document.querySelector('.preview-grid, .pv-stops'))`)).toBe(false);
        expect(await page.eval(`Boolean(document.querySelector('.preview-panel h1, .pv-meta, .invite-card'))`)).toBe(false);
        expect(await page.eval(`/Itinerary not found/.test(document.body.textContent)`)).toBe(false);
        expect(await page.eval(`window.__errors`)).toEqual([]);
      });
    }

    it(`a map that finishes starting after the page was left is cleared, not shown (${vp.w}×${vp.h})`, async () => {
      const page = await browser.newPage();
      await page.viewport(vp.w, vp.h, vp.m);
      await page.initScript(harness(true));
      await page.goto(new URL("/itineraries/tpl-sydney-harbour-highlights", baseUrl).href);
      await page.waitFor(`window.__held.length === 1`, 8000);
      // the itinerary arrives; the page is drawn and its map is starting
      await page.eval(`window.__release()`);
      await page.waitFor(`document.querySelector('.preview-grid .map-host') && window.__mapWaits.length >= 1`, 8000);
      await page.eval(`window.__host = document.querySelector('.preview-grid .map-host')`);
      // leave by the brand while the map waits for Google
      await page.tap(".topbar .brand");
      await page.waitFor(`location.pathname === '/' && document.querySelector('#explore-map')`, 8000);
      // watch what the late map does: a ResizeObserver it keeps (not
      // destroyed) is counted, and so is anything drawn for the stops
      await page.eval(`(() => {
        // only observers watching something inside the late map's host
        window.__observing = 0;
        const RO = window.ResizeObserver;
        window.ResizeObserver = class extends RO { observe(el, ...a) { if (window.__host.contains(el)) { this.__mine = true; window.__observing++; } return super.observe(el, ...a); } disconnect() { if (this.__mine) { this.__mine = false; window.__observing--; } return super.disconnect(); } };
      })()`);
      await page.eval(`window.__releaseMap()`);
      await sleep(800);
      expect(await page.eval(`location.pathname`)).toBe("/");
      expect(await page.eval(`Boolean(document.querySelector('.preview-grid'))`)).toBe(false);
      // the late map was made (the schematic fallback), then destroyed at
      // once: its observer let go, its stops never drawn, never on the page
      expect(await page.eval(`Boolean(window.__host.querySelector('.schematic'))`)).toBe(true);
      expect(await page.eval(`window.__observing`)).toBe(0);
      expect(await page.eval(`window.__host.querySelectorAll('.schematic-svg g, .schematic-svg circle').length`)).toBe(0);
      expect(await page.eval(`window.__host.isConnected`)).toBe(false);
      expect(await page.eval(`window.__errors`)).toEqual([]);
    });
  }
});

describe.skipIf(!chromePath)("the editor's back button", () => {
  for (const vp of VIEWPORTS) {
    it(`is named "Back to your trips" and goes to My Trips (${vp.w}×${vp.h})`, async () => {
      const page = await browser.newPage();
      await page.viewport(vp.w, vp.h, vp.m);
      await signUpIn(page, baseUrl, uniqueName("back"));
      const trip = await inPage(page, "POST", "/api/trips", { title: "Going back", destination: "Sydney", startDate: "2026-12-01", endDate: "2026-12-01", timezone: "Australia/Sydney" });
      await page.goto(new URL(`/trips/${trip.id}`, baseUrl).href);
      await page.waitFor(`document.querySelector('.conn-live')`, 8000);
      const names = await page.accessibleNames("link");
      expect(names).toContain("Back to your trips");
      expect(await page.eval(`document.querySelector('a[aria-label="Back to your trips"]').getAttribute('href')`)).toBe("/trips");
      await page.clickAccessible("link", "Back to your trips");
      await page.waitFor(`location.pathname === '/trips' && [...document.querySelectorAll('.trip-grid h3')].some((h) => h.textContent === 'Going back')`, 8000);
      expect(await page.eval(`document.querySelector('.topbar a[href="/trips"]').classList.contains('on')`)).toBe(true);
    });
  }
});

// The two plans that made every journey-window destination open a plan
// (November 2026), through the pages a person uses: the preview with its
// map and stops, the export, and copying into a private trip.
describe.skipIf(!chromePath)("the Lake Brienz and Malé plans, used", () => {
  for (const [id, title, stops] of [
    ["tpl-lake-brienz-giessbach", "Lake Brienz: Iseltwald, Giessbach Falls & Brienz", 6],
    ["tpl-male-hulhumale-local", "Malé & Hulhumalé: A Day on the Local Islands", 8],
  ] as const) {
    it(`${id}: preview, map, export and a private copy`, async () => {
      const page = await browser.newPage();
      await page.viewport(1440, 900);
      await page.goto(new URL(`/itineraries/${id}`, baseUrl).href);
      await page.waitFor(`document.querySelector('.preview h1')?.textContent === ${JSON.stringify(title)}`, 10000);
      expect(await page.eval(`document.querySelectorAll('.pv-stops > li.pv-stop').length`)).toBe(stops);
      // the map shows every stop (the schematic here: no browser key in tests)
      await page.waitFor(`document.querySelector('.preview-map .schematic-svg')`, 5000);
      expect(await page.eval(`document.querySelectorAll('.preview-map .schematic-svg g.schematic-stop').length`)).toBe(stops);
      // its cover and nothing borrowed from another city
      expect(await page.eval(`document.querySelector('.pv-source').textContent`)).toMatch(/curated sample itinerary/i);
      // export: the document with every stop, no account needed
      await page.click("[data-pv=export]");
      await page.waitFor(`location.pathname === '/itineraries/${id}/export' && document.querySelector('.tp-doc .tp-title')?.textContent === ${JSON.stringify(title)}`, 10000);
      expect(await page.eval(`document.querySelectorAll('.tp-stop').length`)).toBe(stops);
      // copied into a private trip (signed in, on this test server)
      await signUpIn(page, baseUrl, uniqueName("cp"));
      await page.goto(new URL(`/itineraries/${id}`, baseUrl).href);
      await page.waitFor(`document.querySelector('[data-pv=use]')`, 10000);
      await page.click("[data-pv=use]");
      await page.waitFor(`document.querySelector('dialog[open] form')`, 5000);
      await page.eval(`document.querySelector('dialog[open] form').requestSubmit()`);
      await page.waitFor(`/^\\/trips\\/[0-9a-f-]{36}$/.test(location.pathname)`, 10000);
      const trip = await inPage(page, "GET", `/api/trips/${await page.eval<string>(`location.pathname.split('/')[2]`)}`);
      expect(trip.title).toBe(title);
      expect(trip.days.flatMap((d: any) => d.activities).filter((a: any) => a.role !== "start").length).toBe(stops);
    });
  }
});
