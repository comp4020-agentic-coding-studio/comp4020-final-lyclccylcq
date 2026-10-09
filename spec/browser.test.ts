import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { chromePath, inPage, launch, type Page, signUpIn, sleep } from "./browser.ts";
import { uniqueName } from "./helpers.ts";

// Promises only a real browser can check: the map and timeline are usable at
// both marking viewports, adding and reordering work without a mouse drag,
// what you add survives a reload, and two people in two browsers see each
// other's changes without refreshing.
const baseUrl = inject("baseUrl");
let browser: Awaited<ReturnType<typeof launch>>;

beforeAll(async () => {
  browser = await launch();
});
afterAll(() => browser?.close());

const VIEWPORTS = [
  { name: "desktop 1920×1080", width: 1920, height: 1080, mobile: false },
  { name: "phone 390×844", width: 390, height: 844, mobile: true },
];

async function tripWithStops(page: Page) {
  const trip = await inPage(page, "POST", "/api/trips", { title: "Browser trip", destination: "Sydney", startDate: "2026-12-01", endDate: "2026-12-02", timezone: "Australia/Sydney" });
  for (const [title, startMin] of [["Zoo", 540], ["Lunch", 720], ["Opera House", 840]] as const) {
    await inPage(page, "POST", `/api/trips/${trip.id}/activities`, { clientId: `${title}-${Math.random()}`, dayId: trip.days[0].id, title, kind: "attraction", startMin, durationMin: 60 });
  }
  return trip;
}

const box = (sel: string) => `(() => { const r = document.querySelector(${JSON.stringify(sel)})?.getBoundingClientRect(); return r ? { x: r.x, y: r.y, w: r.width, h: r.height } : null; })()`;
const stopTitles = `[...document.querySelectorAll('.timeline .stop h3')].map(e => e.textContent)`;

describe.skipIf(!chromePath)("in a real browser", () => {
  for (const vp of VIEWPORTS) {
    it(`gives the map and the timeline real room at ${vp.name}`, async () => {
      const page = await browser!.newPage();
      await page.viewport(vp.width, vp.height, vp.mobile);
      await signUpIn(page, baseUrl, uniqueName("vp"));
      const trip = await tripWithStops(page);
      await page.goto(new URL(`/trips/${trip.id}`, baseUrl).href);
      await page.waitFor(`document.querySelectorAll('.timeline .stop').length === 3`);

      expect(await page.eval(`document.documentElement.scrollWidth <= innerWidth`)).toBe(true);
      const plan = await page.eval<any>(box(".pane-plan"));
      if (!vp.mobile) {
        const map = await page.eval<any>(box(".pane-map"));
        expect(map.w).toBeGreaterThan(vp.width * 0.5);
        expect(map.h).toBeGreaterThan(vp.height * 0.8);
        expect(plan.x).toBeGreaterThanOrEqual(map.x + map.w - 1); // side by side
        expect(plan.w).toBeGreaterThanOrEqual(380);
      } else {
        expect(plan.w).toBe(vp.width);
        expect(plan.h).toBeGreaterThan(vp.height * 0.6);
        await page.click(".mobile-tabs button:nth-child(1)");
        await page.waitFor(`getComputedStyle(document.querySelector('.pane-map')).display !== 'none'`);
        const map = await page.eval<any>(box(".pane-map"));
        expect(map.w).toBe(vp.width);
        expect(map.h).toBeGreaterThan(vp.height * 0.6);
        await page.click(".mobile-tabs button:nth-child(2)");
      }
      // every move/edit control is big enough to tap and inside the screen
      const controls = await page.eval<any[]>(`[...document.querySelectorAll('.stop-actions button')].map(b => { const r = b.getBoundingClientRect(); return { w: r.width, h: r.height, right: r.right }; })`);
      expect(controls.length).toBeGreaterThan(0);
      for (const c of controls) {
        expect(c.h).toBeGreaterThanOrEqual(28);
        expect(c.right).toBeLessThanOrEqual(vp.width);
      }
    });
  }

  it("adds a place from search into the day, and it's still there after a reload", async () => {
    const page = await browser!.newPage();
    await page.viewport(1920, 1080);
    await signUpIn(page, baseUrl, uniqueName("add"));
    const trip = await inPage(page, "POST", "/api/trips", { title: "Search trip", destination: "Sydney", startDate: "2026-12-01", endDate: "2026-12-01", timezone: "Australia/Sydney" });
    await page.goto(new URL(`/trips/${trip.id}`, baseUrl).href);
    await page.waitFor(`document.querySelector('.timeline-empty')`);
    await page.eval(`document.querySelector('.search input').value = 'zoo'; document.querySelector('.search').requestSubmit()`);
    await page.waitFor(`document.querySelector('.result')`);
    const name = await page.eval<string>(`document.querySelector('.result strong').textContent`);
    await page.click(".result");
    await page.waitFor(`document.querySelector('.add-form')`);
    await page.click(".add-form [type=submit]");
    await page.waitFor(`${stopTitles}.includes(${JSON.stringify(name)})`);

    await page.goto(new URL(`/trips/${trip.id}`, baseUrl).href);
    await page.waitFor(`${stopTitles}.includes(${JSON.stringify(name)})`);
  });

  it("reorders with the move buttons, no dragging needed", async () => {
    const page = await browser!.newPage();
    await page.viewport(390, 844, true);
    await signUpIn(page, baseUrl, uniqueName("kb"));
    const trip = await tripWithStops(page);
    await page.goto(new URL(`/trips/${trip.id}`, baseUrl).href);
    await page.waitFor(`document.querySelectorAll('.timeline .stop').length === 3`);
    expect(await page.eval(`document.querySelector('[aria-label="Move Zoo earlier"]').disabled`)).toBe(true);
    await page.click('[aria-label="Move Opera House earlier"]');
    await page.waitFor(`JSON.stringify(${stopTitles}) === '["Zoo","Opera House","Lunch"]'`);
    await page.click('[aria-label="Move Zoo later"]');
    await page.waitFor(`JSON.stringify(${stopTitles}) === '["Opera House","Zoo","Lunch"]'`);
  });

  it("shows one collaborator's changes in the other's browser within about a second", async () => {
    const alice = await browser!.newPage();
    const bob = await browser!.newPage();
    await alice.viewport(1920, 1080);
    await bob.viewport(390, 844, true);
    await signUpIn(alice, baseUrl, uniqueName("alice"));
    await signUpIn(bob, baseUrl, uniqueName("bob"));
    const trip = await tripWithStops(alice);
    const { token } = await inPage(alice, "POST", `/api/trips/${trip.id}/invite`, {});

    // Bob joins through the invite page, like a person would
    await bob.goto(new URL(`/join/${token}`, baseUrl).href);
    await bob.waitFor(`[...document.querySelectorAll('button')].some(b => b.textContent === 'Join this trip')`);
    await bob.eval(`[...document.querySelectorAll('button')].find(b => b.textContent === 'Join this trip').click()`);
    await bob.waitFor(`location.pathname === '/trips/${trip.id}' && document.querySelectorAll('.timeline .stop').length === 3`);
    await alice.goto(new URL(`/trips/${trip.id}`, baseUrl).href);
    await alice.waitFor(`document.querySelector('.conn-live') && /2 people/.test(document.querySelector('.presence-label').textContent)`);

    // Alice adds a stop through the UI; Bob's open page shows it
    await alice.click(".plan-foot button");
    await alice.waitFor(`document.querySelector('dialog[open] input[name=title]')`);
    await alice.eval(`document.querySelector('dialog[open] input[name=title]').value = 'Ferry to Manly'; document.querySelector('dialog[open] form').requestSubmit()`);
    const added = await bob.waitFor(`${stopTitles}.includes('Ferry to Manly')`, 3000);
    expect(added).toBeLessThan(1500);

    // Bob reorders on his phone; Alice sees the new order
    await bob.click('[aria-label="Move Opera House earlier"]');
    const moved = await alice.waitFor(`JSON.stringify(${stopTitles}.slice(0, 3)) === '["Zoo","Opera House","Lunch"]'`, 3000);
    expect(moved).toBeLessThan(1500);

    // Alice edits a time; it reaches Bob too
    const zoo = trip.days[0].activities?.[0];
    const fresh = await inPage(alice, "GET", `/api/trips/${trip.id}`);
    const zooNow = fresh.days[0].activities.find((a: any) => a.title === "Zoo") ?? zoo;
    await inPage(alice, "PATCH", `/api/trips/${trip.id}/activities/${zooNow.id}`, { baseVersion: zooNow.version, startMin: 8 * 60 });
    await bob.waitFor(`document.querySelector('.timeline .stop .stop-time').textContent.startsWith('08:00')`, 3000);
    await sleep(50);
  });
});

// The homepage's discovery flow, end to end in a real browser.
describe.skipIf(!chromePath)("homepage discovery in a real browser", () => {
  const cards = `[...document.querySelectorAll('#near .it-card:not(.skeleton) h3')].map(e => e.textContent)`;

  it("uses the browser's location to recommend nearby itineraries, then previews one and comes back", async () => {
    const page = await browser!.newPage();
    await page.viewport(390, 844, true);
    await page.geolocation(baseUrl, { lat: -35.2835, lng: 149.1281 }); // central Canberra
    await page.goto(new URL("/", baseUrl).href);
    await page.waitFor(`document.querySelector('.hero h1')?.textContent === 'Your next journey starts here.'`);
    await page.waitFor(`${cards}.length > 4`); // general content before any location
    await page.eval(`[...document.querySelectorAll('button')].find(b => b.textContent.includes('Use my location')).click()`);
    await page.waitFor(`document.querySelector('.chip-place') && ${cards}.length === 4`);
    expect(await page.eval(`document.querySelector('#near h2').textContent`)).toBe("Near you");
    const distances = await page.eval<number[]>(`[...document.querySelectorAll('#near .it-distance')].map(e => parseFloat(e.textContent))`);
    expect(distances).toEqual([...distances].sort((a, b) => a - b));
    expect(await page.eval(`document.documentElement.scrollWidth <= innerWidth`)).toBe(true);

    // preview: ordered stops, a marker per stop, an inspector per place
    await page.eval(`document.querySelector('#near .it-card .btn-outline').click()`);
    await page.waitFor(`location.pathname.startsWith('/itineraries/') && document.querySelectorAll('.pv-stop').length > 1`);
    const stops = await page.eval<number>(`document.querySelectorAll('.pv-stop').length`);
    expect(await page.eval<number>(`document.querySelectorAll('.schematic-stop, .pin:not(.pin-result)').length`)).toBe(stops);
    await page.eval(`document.querySelector('.pv-stop .btn-ghost').click()`);
    await page.waitFor(`document.querySelector('dialog[open].place-dialog h2')`);
    await page.eval(`document.querySelector('dialog[open]').close()`);
    await page.eval(`document.querySelector('.back-link').click()`);
    await page.waitFor(`location.pathname === '/' && document.querySelector('.chip-place') && ${cards}.length === 4`);
  });

  it("updates recommendations for a searched destination, independent of location", async () => {
    const page = await browser!.newPage();
    await page.viewport(1920, 1080);
    await page.geolocation(baseUrl, "denied");
    await page.goto(new URL("/", baseUrl).href);
    await page.waitFor(`document.querySelector('#dest-search')`);
    const config = await page.eval<any>(`fetch('/api/config').then(r => r.json())`);
    await page.eval(`(() => { const i = document.querySelector('#dest-search'); i.focus(); i.value = 'Tokyo'; i.dispatchEvent(new Event('input')); })()`);
    await page.waitFor(`document.querySelector('#dest-list li[role=option]')`, 4000);
    if (config.places === "demo") expect(await page.eval(`document.querySelector('#dest-list li[role=option] strong').textContent`)).toBe("Tokyo");
    await page.eval(`document.querySelector('#dest-list li[role=option]').dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))`);
    await page.waitFor(`/Tokyo/.test(document.querySelector('.chip-place')?.textContent ?? '') && ${cards}.length > 0`);
    const dest = await page.eval<string[]>(`[...document.querySelectorAll('#near .it-cover-dest')].map(e => e.textContent)`);
    expect(dest.every((d) => /Tokyo/.test(d))).toBe(true);
  });

  it("carries on without location when permission is denied, and doesn't ask again", async () => {
    const page = await browser!.newPage();
    await page.viewport(390, 844, true);
    await page.geolocation(baseUrl, "denied");
    await page.goto(new URL("/", baseUrl).href);
    await page.waitFor(`${cards}.length > 4`);
    await page.eval(`window.__asks = 0; const g = navigator.geolocation.getCurrentPosition.bind(navigator.geolocation); navigator.geolocation.getCurrentPosition = (...a) => { window.__asks++; return g(...a); };`);
    const btn = `[...document.querySelectorAll('button')].find(b => b.textContent.includes('Use my location'))`;
    if (await page.eval<boolean>(`Boolean(${btn}) && !${btn}.hidden`)) {
      await page.eval(`${btn}.click()`);
      await page.waitFor(`/denied|off/i.test(document.querySelector('.hero-status').textContent + document.querySelector('.place-chip').textContent)`);
      if (await page.eval<boolean>(`Boolean(${btn}) && !${btn}.hidden`)) await page.eval(`${btn}.click()`);
    }
    expect(await page.eval<number>(`window.__asks`)).toBeLessThanOrEqual(1);
    expect(await page.eval<number>(`${cards}.length`)).toBeGreaterThan(4); // general recommendations still shown
    expect(await page.eval(`document.querySelector('#dest-search').disabled`)).toBe(false);
  });
});
