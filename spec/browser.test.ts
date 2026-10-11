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
    // a collaborator has no settings button, and no stray "false" where it would be
    expect(await bob.eval<string>(`document.querySelector('.trip-bar').textContent`)).not.toMatch(/false|undefined|null/);
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

describe.skipIf(!chromePath)("explore places on the homepage map", () => {
  it("shows places around the chosen location on the map, and opens one with Add to Trip", async () => {
    const page = await browser!.newPage();
    await page.viewport(1920, 1080);
    await signUpIn(page, baseUrl, uniqueName("xm"));
    await inPage(page, "POST", "/api/trips", { title: "Map trip", destination: "Sydney", startDate: "2026-12-01", endDate: "2026-12-02", timezone: "Australia/Sydney" });
    await page.geolocation(baseUrl, { lat: -33.8688, lng: 151.2093 }); // Sydney CBD
    await page.goto(new URL("/", baseUrl).href);
    await page.waitFor(`document.querySelector('#explore-map')`);
    expect(await page.eval(`document.querySelectorAll('#explore-map .place-row').length`)).toBe(0); // nothing fetched before a location
    await page.eval(`[...document.querySelectorAll('button')].find(b => b.textContent.includes('Use my location')).click()`);
    await page.waitFor(`document.querySelectorAll('#explore-map .place-row').length > 0`, 6000);
    const rows = await page.eval<number>(`document.querySelectorAll('#explore-map .place-row').length`);
    const marks = await page.eval<number>(`document.querySelectorAll('#explore-map .schematic-result, #explore-map .pin-result').length`);
    expect(marks).toBe(rows);
    await page.click("#explore-map .place-row");
    await page.waitFor(`document.querySelector('#explore-map .xm-panel h3')`);
    await page.waitFor(`[...document.querySelectorAll('#explore-map .xm-panel button')].some(b => b.textContent.includes('Add to Trip'))`);
    await page.eval(`[...document.querySelectorAll('#explore-map .xm-panel button')].find(b => b.textContent.includes('Add to Trip')).click()`);
    await page.waitFor(`document.querySelector('dialog[open] select[name=day] option')`);
    const name = await page.eval<string>(`document.querySelector('#explore-map .xm-panel h3').textContent`);
    await page.eval(`document.querySelector('dialog[open] form').requestSubmit()`);
    await page.waitFor(`!document.querySelector('dialog[open]')`);
    const trips = await inPage(page, "GET", "/api/trips");
    const trip = await inPage(page, "GET", `/api/trips/${trips.owned[0].id}`);
    expect(trip.days[0].activities.map((a: any) => a.title)).toContain(name);
    expect(trip.days[0].activities[0].place.placeId).toBeTruthy();
  });
});

// First-visit location: offered, never forced, remembered, and kept apart from
// the destination someone picks.
describe.skipIf(!chromePath)("location on the homepage", () => {
  const chip = `document.querySelector('.chip-place')?.textContent ?? ''`;
  const promptShown = `Boolean(document.querySelector('.geo-prompt') && !document.querySelector('.geo-prompt').hidden)`;
  const cards = `[...document.querySelectorAll('#near .it-card:not(.skeleton) h3')].map(e => e.textContent)`;

  it("offers location on a first visit, and remembers 'Not now'", async () => {
    const page = await browser!.newPage();
    await page.viewport(390, 844, true);
    await page.goto(new URL("/", baseUrl).href);
    await page.waitFor(`${cards}.length > 4`);
    await page.waitFor(promptShown);
    await page.eval(`[...document.querySelectorAll('.geo-prompt button')].find(b => b.textContent === 'Not now').click()`);
    expect(await page.eval(promptShown)).toBe(false);
    await page.goto(new URL("/", baseUrl).href);
    await page.waitFor(`${cards}.length > 4`);
    await sleep(300);
    expect(await page.eval(promptShown)).toBe(false);
    expect(await page.eval(`[...document.querySelectorAll('button')].some(b => b.textContent.includes('Use my location') && !b.hidden && b.offsetParent)`)).toBe(true);
  });

  it("uses the location once allowed, keeps it on the next visit, and keeps a picked destination apart", async () => {
    const page = await browser!.newPage();
    await page.viewport(1920, 1080);
    await page.geolocation(baseUrl, { lat: -35.2835, lng: 149.1281 }); // central Canberra
    await page.goto(new URL("/", baseUrl).href);
    await page.waitFor(promptShown);
    await page.eval(`[...document.querySelectorAll('.geo-prompt button')].find(b => b.textContent === 'Use my location').click()`);
    await page.waitFor(`/^Current location:/.test(${chip}) && ${cards}.length === 4`);
    expect(await page.eval(promptShown)).toBe(false);
    const here = await page.eval<string>(`document.querySelector('.chip-place strong').textContent`);

    // next visit: no prompt, same place, without pressing anything
    await page.goto(new URL("/", baseUrl).href);
    await page.waitFor(`/^Current location:/.test(${chip}) && ${cards}.length === 4`);
    expect(await page.eval(promptShown)).toBe(false);

    // a destination takes over without touching the current location
    await page.eval(`[...document.querySelectorAll('.dest-card')].find(b => b.textContent.includes('Tokyo')).click()`);
    await page.waitFor(`/Exploring: ?Tokyo/.test(${chip})`);
    await page.waitFor(`[...document.querySelectorAll('#near .it-cover-dest')].length > 0 && [...document.querySelectorAll('#near .it-cover-dest')].every(e => /Tokyo|Kamakura/.test(e.textContent))`);
    const stored = await page.eval<any>(`JSON.parse(localStorage.getItem('wayline.location'))`);
    expect(stored.label).toBe(here);
    expect(Math.abs(stored.lat - -35.28)).toBeLessThan(0.02); // rounded, ~1 km

    // it survives a reload, then "Back to …" returns to where you are
    await page.goto(new URL("/", baseUrl).href);
    await page.waitFor(`/Exploring: ?Tokyo/.test(${chip})`);
    await page.eval(`[...document.querySelectorAll('.place-chip button')].find(b => b.textContent.startsWith('Back to')).click()`);
    await page.waitFor(`/^Current location:/.test(${chip}) && ${cards}.length === 4`);
    expect(await page.eval(`localStorage.getItem('wayline.destination')`)).toBe(null);
  });

  it("shows destination photos, credits them, and falls back to the gradient when one fails", async () => {
    const page = await browser!.newPage();
    await page.viewport(1920, 1080);
    await page.goto(new URL("/", baseUrl).href);
    await page.waitFor(`${cards}.length > 4 && document.querySelectorAll('.dest-card').length > 0`);
    await page.eval(`document.querySelectorAll('img.cover-img').forEach(i => (i.loading = 'eager'))`);
    await page.waitFor(`[...document.querySelectorAll('img.cover-img')].every(i => i.complete)`, 8000);
    const broken = await page.eval<number>(`[...document.querySelectorAll('img.cover-img')].filter(i => !i.naturalWidth).length`);
    expect(broken).toBe(0);
    expect(await page.eval<number>(`document.querySelectorAll('#near .it-cover.has-photo .cover-credit a[href*="commons.wikimedia.org"]').length`)).toBe(await page.eval<number>(`document.querySelectorAll('#near .it-cover.has-photo').length`));
    await page.eval(`document.querySelector('#near .it-cover .cover-img').src = '/img/covers/no-such-photo.jpg'`);
    await page.waitFor(`!document.querySelector('#near .it-card .it-cover > img') || document.querySelectorAll('#near .it-cover > img').length < document.querySelectorAll('#near .it-cover').length`);
    expect(await page.eval(`document.documentElement.scrollWidth <= innerWidth`)).toBe(true);
  });
});
