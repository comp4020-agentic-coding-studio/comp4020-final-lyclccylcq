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

  for (const vp of VIEWPORTS) {
    it(`opens a place for reading, then schedules it in a separate card; Cancel changes nothing (${vp.name})`, async () => {
      const page = await browser!.newPage();
      await page.viewport(vp.width, vp.height, vp.mobile);
      await signUpIn(page, baseUrl, uniqueName("add"));
      const trip = await inPage(page, "POST", "/api/trips", { title: "Search trip", destination: "Sydney", startDate: "2026-12-01", endDate: "2026-12-01", timezone: "Australia/Sydney" });
      await page.goto(new URL(`/trips/${trip.id}`, baseUrl).href);
      await page.waitFor(`document.querySelector('.timeline-empty')`);
      if (vp.mobile) await page.click(".mobile-tabs button:nth-child(1)");
      await page.eval(`document.querySelector('.search input').value = 'zoo'; document.querySelector('.search').requestSubmit()`);
      await page.waitFor(`document.querySelector('.result')`);
      const name = await page.eval<string>(`document.querySelector('.result strong').textContent`);
      await page.click(".result");
      await page.waitFor(`document.querySelector('.place-card .add-to-trip')`);
      // the place card is for reading: no day, time or duration inputs
      expect(await page.eval<number>(`document.querySelectorAll('.place-card select, .place-card input, .place-card textarea').length`)).toBe(0);

      // Cancel: the card closes, nothing is added, the place stays open
      await page.click(".place-card .add-to-trip");
      await page.waitFor(`document.querySelector('dialog[open].schedule-card')`);
      expect(await page.eval(`document.querySelector('dialog[open].schedule-card h2').textContent`)).toBe(name);
      await page.eval(`[...document.querySelectorAll('dialog[open].schedule-card button')].find(b => b.textContent === 'Cancel').click()`);
      await page.waitFor(`!document.querySelector('dialog[open]')`);
      expect(await page.eval(`Boolean(document.querySelector('.place-card'))`)).toBe(true);
      expect((await inPage(page, "GET", `/api/trips/${trip.id}`)).days[0].activities).toEqual([]);

      // Confirm & add, with a chosen time, length and note
      await page.click(".place-card .add-to-trip");
      await page.waitFor(`document.querySelector('dialog[open].schedule-card')`);
      await page.eval(`(() => { const f = document.querySelector('dialog[open].schedule-card form'); f.start.value = '10:15'; f.duration.value = '45'; f.notes.value = 'Ferry from Circular Quay'; f.requestSubmit(); })()`);
      await page.waitFor(`!document.querySelector('dialog[open]') && ${stopTitles}.includes(${JSON.stringify(name)})`);
      const saved = (await inPage(page, "GET", `/api/trips/${trip.id}`)).days[0].activities[0];
      expect(saved).toMatchObject({ title: name, startMin: 615, durationMin: 45, notes: "Ferry from Circular Quay" });
      expect(await page.eval(`document.documentElement.scrollWidth <= innerWidth`)).toBe(true);

      await page.goto(new URL(`/trips/${trip.id}`, baseUrl).href);
      await page.waitFor(`${stopTitles}.includes(${JSON.stringify(name)})`);
      expect(await page.eval(`document.querySelector('.timeline .stop .stop-clock').textContent`)).toBe("10:15");
      expect(await page.eval(`document.querySelector('.timeline .stop .stop-meta').textContent`)).toContain("Visit 45 min");
    });
  }

  it("orders timed stops by time (moved by changing the time), untimed ones by the move buttons", async () => {
    const page = await browser!.newPage();
    await page.viewport(390, 844, true);
    await signUpIn(page, baseUrl, uniqueName("kb"));
    const trip = await inPage(page, "POST", "/api/trips", { title: "Order trip", destination: "Sydney", startDate: "2026-12-01", endDate: "2026-12-01", timezone: "Australia/Sydney" });
    // with places, so each has a numbered marker on the map
    for (const [title, startMin, slug, lat, lng] of [["Zoo", 540, "taronga-zoo", -33.8435, 151.2413], ["Lunch", 720, "the-rocks", -33.8599, 151.209], ["Opera House", 840, "opera-house", -33.8568, 151.2153]] as const) {
      await inPage(page, "POST", `/api/trips/${trip.id}/activities`, { clientId: `${title}-${Math.random()}`, dayId: trip.days[0].id, title, kind: "attraction", startMin, durationMin: 60, place: { placeId: `demo:${slug}`, source: "demo", lat, lng } });
    }
    for (const title of ["Souvenirs", "Gelato"]) {
      await inPage(page, "POST", `/api/trips/${trip.id}/activities`, { clientId: `${title}-${Math.random()}`, dayId: trip.days[0].id, title, kind: "custom", startMin: null, durationMin: 30 });
    }
    await page.goto(new URL(`/trips/${trip.id}`, baseUrl).href);
    await page.waitFor(`document.querySelectorAll('.timeline .stop').length === 5`);
    expect(await page.eval<string[]>(stopTitles)).toEqual(["Zoo", "Lunch", "Opera House", "Souvenirs", "Gelato"]);
    expect(await page.eval<string[]>(`[...document.querySelectorAll('.timeline .stop-clock')].map(e => e.textContent)`)).toEqual(["09:00", "12:00", "14:00", "No time", "No time"]);
    // a timed stop has no arrows: its time decides where it is
    expect(await page.eval(`Boolean(document.querySelector('[aria-label="Move Zoo earlier"]'))`)).toBe(false);

    // moving Opera House to the morning: change its time
    await page.click('[aria-label="Change the time of Opera House"]');
    await page.waitFor(`document.querySelector('dialog[open] input[name=start]') === document.activeElement`);
    await page.eval(`(() => { const f = document.querySelector('dialog[open] form'); f.start.value = '08:00'; f.requestSubmit(); })()`);
    await page.waitFor(`JSON.stringify(${stopTitles}) === '["Opera House","Zoo","Lunch","Souvenirs","Gelato"]'`);
    // the map's numbers follow the new order
    await page.click(".mobile-tabs button:nth-child(1)");
    await page.waitFor(`document.querySelectorAll('.schematic-stop').length === 3`);
    expect(await page.eval<string[]>(`[...document.querySelectorAll('.schematic-stop')].map(g => g.getAttribute('aria-label'))`)).toEqual(expect.arrayContaining(["Stop 1: Opera House", "Stop 2: Zoo", "Stop 3: Lunch"]));
    await page.click(".mobile-tabs button:nth-child(2)");

    // untimed stops still move with the buttons, after the timed ones
    expect(await page.eval(`document.querySelector('[aria-label="Move Souvenirs earlier"]').disabled`)).toBe(true);
    await page.click('[aria-label="Move Souvenirs later"]');
    await page.waitFor(`JSON.stringify(${stopTitles}.slice(3)) === '["Gelato","Souvenirs"]'`);
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

    // Bob moves Opera House to the morning on his phone (by its time); Alice sees the new order
    await bob.click('[aria-label="Change the time of Opera House"]');
    await bob.waitFor(`document.querySelector('dialog[open] input[name=start]')`);
    await bob.eval(`(() => { const f = document.querySelector('dialog[open] form'); f.start.value = '08:00'; f.requestSubmit(); })()`);
    const moved = await alice.waitFor(`JSON.stringify(${stopTitles}.slice(0, 3)) === '["Opera House","Zoo","Lunch"]'`, 3000);
    expect(moved).toBeLessThan(1500);

    // Alice edits a time; it reaches Bob too
    const zoo = trip.days[0].activities?.[0];
    const fresh = await inPage(alice, "GET", `/api/trips/${trip.id}`);
    const zooNow = fresh.days[0].activities.find((a: any) => a.title === "Zoo") ?? zoo;
    await inPage(alice, "PATCH", `/api/trips/${trip.id}/activities/${zooNow.id}`, { baseVersion: zooNow.version, startMin: 7 * 60 + 30 });
    await bob.waitFor(`document.querySelector('.timeline .stop h3').textContent === 'Zoo' && document.querySelector('.timeline .stop .stop-clock').textContent === '07:30'`, 3000);
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

// A new trip starts with one light question: where does it start? Then the
// editor, with the start first in the timeline and on the map.
describe.skipIf(!chromePath)("starting a trip in the editor", () => {
  const prompt = `document.querySelector('.start-panel')?.textContent ?? ''`;
  const option = (label: string) => `[...document.querySelectorAll('.start-option')].find(b => b.textContent.includes(${JSON.stringify(label)}))`;
  const sydneyTrip = (page: Page) => inPage(page, "POST", "/api/trips", { title: "Start trip", destination: "Sydney", startDate: "2026-12-01", endDate: "2026-12-02", timezone: "Australia/Sydney" });
  const searchFor = (page: Page, q: string) => page.eval(`document.querySelector('.search input').value = ${JSON.stringify(q)}; document.querySelector('.search').requestSubmit()`);

  for (const vp of VIEWPORTS) {
    it(`asks where a new trip starts, sets it from a search, and doesn't ask again (${vp.name})`, async () => {
      const page = await browser!.newPage();
      await page.viewport(vp.width, vp.height, vp.mobile);
      await signUpIn(page, baseUrl, uniqueName("start"));
      const trip = await sydneyTrip(page);
      await page.goto(new URL(`/trips/${trip.id}?new=1`, baseUrl).href);
      await page.waitFor(`/Where would you like to start\\?/.test(${prompt})`);
      expect(await page.eval(`location.search`)).toBe(""); // asked once, not on every reload
      expect(await page.eval<number>(`document.querySelectorAll('.start-option').length`)).toBe(3);
      expect(await page.eval(`${option("Choose on map")}.disabled`)).toBe(true); // the schematic isn't a map
      expect(await page.eval(`getComputedStyle(document.querySelector('.search-panel')).display !== 'none' && document.querySelector('.search-panel').getBoundingClientRect().width > 0`)).toBe(true);

      await page.eval(`${option("Search a location")}.click()`);
      await searchFor(page, "opera");
      await page.waitFor(`document.querySelector('.result')`);
      const name = await page.eval<string>(`document.querySelector('.result strong').textContent`);
      await page.click(".result");
      await page.waitFor(`[...document.querySelectorAll('.place-card button')].some(b => b.textContent.includes('Set as starting point'))`);
      await page.eval(`[...document.querySelectorAll('.place-card button')].find(b => b.textContent.includes('Set as starting point')).click()`);
      await page.waitFor(`document.querySelector('.stop-start h3')?.textContent === ${JSON.stringify(name)}`);
      expect(await page.eval(`document.querySelector('.stop-start .stop-num').textContent`)).toBe("S");
      expect(await page.eval(`document.querySelector('.timeline-hint')?.textContent ?? ''`)).toMatch(/Explore the map or search to add your next stop/);
      expect(await page.eval(`document.documentElement.scrollWidth <= innerWidth`)).toBe(true);

      await page.goto(new URL(`/trips/${trip.id}`, baseUrl).href);
      await page.waitFor(`document.querySelector('.stop-start h3')?.textContent === ${JSON.stringify(name)}`);
      await sleep(200);
      expect(await page.eval(`Boolean(document.querySelector('.start-panel'))`)).toBe(false);
    });
  }

  it("lets the start change later, keeping the other stops below it", async () => {
    const page = await browser!.newPage();
    await page.viewport(1920, 1080);
    await signUpIn(page, baseUrl, uniqueName("chg"));
    const trip = await tripWithStops(page);
    await page.goto(new URL(`/trips/${trip.id}`, baseUrl).href);
    await page.waitFor(`document.querySelectorAll('.timeline .stop').length === 3`);
    expect(await page.eval(`Boolean(document.querySelector('.start-panel'))`)).toBe(false); // an existing trip isn't interrupted
    await page.eval(`document.querySelector('.day-start-link button').click()`);
    await page.waitFor(`/Where would you like to start\\?/.test(${prompt})`);
    await page.eval(`${option("Search a location")}.click()`);
    await searchFor(page, "zoo");
    await page.waitFor(`document.querySelector('.result')`);
    await page.click(".result");
    await page.waitFor(`[...document.querySelectorAll('.place-card button')].some(b => b.textContent.includes('Set as starting point'))`);
    await page.eval(`[...document.querySelectorAll('.place-card button')].find(b => b.textContent.includes('Set as starting point')).click()`);
    await page.waitFor(`document.querySelectorAll('.timeline .stop').length === 4 && document.querySelector('.timeline .stop').classList.contains('stop-start')`);
    expect(await page.eval<string[]>(`${stopTitles}.slice(1)`)).toEqual(["Zoo", "Lunch", "Opera House"]);
    // nothing can go ahead of the start: timed stops move by time, not arrows
    expect(await page.eval(`Boolean(document.querySelectorAll('.timeline .stop')[1].querySelector('[aria-label^="Move"]'))`)).toBe(false);

    await page.eval(`[...document.querySelectorAll('.stop-start button')].find(b => b.textContent.includes('Change start')).click()`);
    await page.waitFor(`/Change the starting point/.test(${prompt})`);
    await page.eval(`${option("Search a location")}.click()`);
    await searchFor(page, "bondi");
    await page.waitFor(`document.querySelector('.result')`);
    const other = await page.eval<string>(`document.querySelector('.result strong').textContent`);
    await page.click(".result");
    await page.waitFor(`[...document.querySelectorAll('.place-card button')].some(b => b.textContent.includes('Set as starting point'))`);
    await page.eval(`[...document.querySelectorAll('.place-card button')].find(b => b.textContent.includes('Set as starting point')).click()`);
    await page.waitFor(`document.querySelector('.stop-start h3')?.textContent === ${JSON.stringify(other)}`);
    expect(await page.eval<string[]>(`${stopTitles}.slice(1)`)).toEqual(["Zoo", "Lunch", "Opera House"]);
  });

  it("starts from the current location only when asked, and copes with a refusal", async () => {
    const denied = await browser!.newPage();
    await denied.viewport(1920, 1080);
    await signUpIn(denied, baseUrl, uniqueName("deny"));
    await denied.geolocation(baseUrl, "denied");
    const t1 = await sydneyTrip(denied);
    await denied.goto(new URL(`/trips/${t1.id}?new=1`, baseUrl).href);
    await denied.waitFor(option("Use my location"));
    await denied.eval(`${option("Use my location")}.click()`);
    await denied.waitFor(`/denied/.test(${prompt})`);
    expect(await denied.eval(`${option("Search a location")}.disabled`)).toBe(false); // other ways stay open

    const page = await browser!.newPage();
    await page.viewport(1920, 1080);
    await signUpIn(page, baseUrl, uniqueName("here"));
    await page.geolocation(baseUrl, { lat: -35.2809, lng: 149.13 }); // Canberra, while planning Sydney
    const t2 = await sydneyTrip(page);
    await page.goto(new URL(`/trips/${t2.id}?new=1`, baseUrl).href);
    await page.waitFor(option("Use my location"));
    await page.eval(`${option("Use my location")}.click()`);
    await page.waitFor(`[...document.querySelectorAll('.start-panel button')].some(b => b.textContent === 'Start here' && !b.disabled)`);
    expect(await page.eval(prompt)).toMatch(/km from Sydney/); // the physical location isn't assumed to be the start
    await page.eval(`[...document.querySelectorAll('.start-panel button')].find(b => b.textContent === 'Start here').click()`);
    await page.waitFor(`document.querySelector('.stop-start')`);
    const saved = await inPage(page, "GET", `/api/trips/${t2.id}`);
    expect(saved.days[0].activities[0]).toMatchObject({ role: "start", place: { source: "custom" } });
    expect(saved.days[0].activities[0].place.placeId).toMatch(/^custom:/);
  });

  it("says when a place is already in the plan, and only adds it again on purpose", async () => {
    const page = await browser!.newPage();
    await page.viewport(1920, 1080);
    await signUpIn(page, baseUrl, uniqueName("dup"));
    const trip = await sydneyTrip(page);
    await page.goto(new URL(`/trips/${trip.id}`, baseUrl).href);
    await page.waitFor(`document.querySelector('.timeline-empty')`);
    for (const round of [0, 1]) {
      await searchFor(page, "zoo");
      await page.waitFor(`document.querySelector('.result')`);
      await page.click(".result");
      await page.waitFor(`document.querySelector('.place-card .add-to-trip')`);
      const label = await page.eval<string>(`document.querySelector('.place-card .add-to-trip').textContent`);
      expect(label).toBe(round === 0 ? "Add to Itinerary" : "Add another visit");
      if (round === 1) expect(await page.eval(`document.querySelector('.already')?.textContent ?? ''`)).toMatch(/Already in your plan: Day 1/);
      await page.click(".place-card .add-to-trip");
      await page.waitFor(`document.querySelector('dialog[open].schedule-card')`);
      await page.eval(`document.querySelector('dialog[open].schedule-card form').requestSubmit()`);
      await page.waitFor(`document.querySelectorAll('.timeline .stop').length === ${round + 1}`);
    }
  });
});

// Two separate browser sessions on one trip: each kind of change reaches the
// other within about a second, and the timings are printed.
describe.skipIf(!chromePath)("collaborating live, every kind of change", () => {
  it("syncs remove, retime and a new starting point to the other browser within about a second", async () => {
    const alice = await browser!.newPage();
    const bob = await browser!.newPage();
    await alice.viewport(1920, 1080);
    await bob.viewport(390, 844, true);
    await signUpIn(alice, baseUrl, uniqueName("alice"));
    await signUpIn(bob, baseUrl, uniqueName("bob"));
    const trip = await tripWithStops(alice);
    const { token } = await inPage(alice, "POST", `/api/trips/${trip.id}/invite`, {});
    await inPage(bob, "POST", `/api/invites/${token}/accept`, {});
    await alice.goto(new URL(`/trips/${trip.id}`, baseUrl).href);
    await bob.goto(new URL(`/trips/${trip.id}`, baseUrl).href);
    await alice.waitFor(`document.querySelector('.conn-live') && /2 people/.test(document.querySelector('.presence-label').textContent)`);
    await bob.waitFor(`document.querySelector('.conn-live') && document.querySelectorAll('.timeline .stop').length === 3`);
    const timings: Record<string, number> = {};
    const ids = (await inPage(alice, "GET", `/api/trips/${trip.id}`)).days[0].activities.map((a: any) => a);

    // Bob removes Lunch; Alice sees it go
    await bob.eval(`window.confirm = () => true; document.querySelector('[aria-label="Remove Lunch"]').click()`);
    timings.remove = await alice.waitFor(`!${stopTitles}.includes('Lunch') && ${stopTitles}.length === 2`, 3000);

    // Bob retimes the Zoo; Alice's timeline shows the new time
    const zoo = ids.find((a: any) => a.title === "Zoo");
    await inPage(bob, "PATCH", `/api/trips/${trip.id}/activities/${zoo.id}`, { baseVersion: zoo.version, startMin: 8 * 60 + 30 });
    timings.retime = await alice.waitFor(`document.querySelector('.timeline .stop .stop-clock').textContent === '08:30'`, 3000);
    expect(await alice.eval(`document.querySelector('.stop-touched')?.textContent ?? ''`)).toMatch(/Changed by/);

    // Alice sets a starting point; it arrives first in Bob's timeline
    await inPage(alice, "PUT", `/api/trips/${trip.id}/start`, { clientId: crypto.randomUUID(), title: "Central Station", place: { placeId: `custom:${crypto.randomUUID()}`, source: "custom", lat: -33.8832, lng: 151.2069 }, baseVersion: null });
    timings.start = await bob.waitFor(`document.querySelector('.timeline .stop.stop-start h3')?.textContent === 'Central Station'`, 3000);

    console.log(`live sync (ms): ${JSON.stringify(timings)}`);
    for (const ms of Object.values(timings)) expect(ms).toBeLessThan(1500);
    // nothing confirmed was lost on either side
    const final = ["Central Station", "Zoo", "Opera House"];
    expect(await alice.eval<string[]>(stopTitles)).toEqual(final);
    expect(await bob.eval<string[]>(stopTitles)).toEqual(final);
  });

  it("keeps both of two simultaneous adds, and shows the latest state to someone who comes back", async () => {
    const alice = await browser!.newPage();
    const bob = await browser!.newPage();
    await alice.viewport(1920, 1080);
    await bob.viewport(1920, 1080);
    await signUpIn(alice, baseUrl, uniqueName("alice"));
    await signUpIn(bob, baseUrl, uniqueName("bob"));
    const trip = await inPage(alice, "POST", "/api/trips", { title: "Same time", destination: "Sydney", startDate: "2026-12-01", endDate: "2026-12-01", timezone: "Australia/Sydney" });
    const { token } = await inPage(alice, "POST", `/api/trips/${trip.id}/invite`, {});
    await inPage(bob, "POST", `/api/invites/${token}/accept`, {});
    await alice.goto(new URL(`/trips/${trip.id}`, baseUrl).href);
    await bob.goto(new URL(`/trips/${trip.id}`, baseUrl).href);
    await alice.waitFor(`/2 people/.test(document.querySelector('.presence-label')?.textContent ?? '')`);
    const add = (title: string) => ({ clientId: crypto.randomUUID(), dayId: trip.days[0].id, title, kind: "food", startMin: 720, durationMin: 60 });
    await Promise.all([inPage(alice, "POST", `/api/trips/${trip.id}/activities`, add("Restaurant")), inPage(bob, "POST", `/api/trips/${trip.id}/activities`, add("Museum"))]);
    for (const p of [alice, bob]) await p.waitFor(`${stopTitles}.length === 2 && ${stopTitles}.includes('Restaurant') && ${stopTitles}.includes('Museum')`, 3000);

    // Bob leaves; Alice keeps editing; when Bob comes back he sees it all
    await bob.goto("about:blank");
    await inPage(alice, "POST", `/api/trips/${trip.id}/activities`, add("Late dinner"));
    await bob.goto(new URL(`/trips/${trip.id}`, baseUrl).href);
    await bob.waitFor(`${stopTitles}.includes('Late dinner') && ${stopTitles}.length === 3`, 3000);
  });
});

describe.skipIf(!chromePath)("My Trips", () => {
  it("shows a cover photo on each trip that has one, the colour band otherwise, after a reload too", async () => {
    const page = await browser!.newPage();
    await page.viewport(390, 844, true);
    await signUpIn(page, baseUrl, uniqueName("mytrips"));
    await inPage(page, "POST", "/api/itineraries/tpl-tokyo-asakusa-ueno/copy", { startDate: "2026-12-01" });
    await inPage(page, "POST", "/api/trips", { title: "Somewhere new", destination: "Reykjavik", startDate: "2026-12-01", endDate: "2026-12-02", timezone: "Atlantic/Reykjavik" });
    for (const pass of [1, 2]) {
      await page.goto(new URL("/trips", baseUrl).href);
      await page.waitFor(`document.querySelectorAll('.trip-card').length === 2`);
      await page.eval(`document.querySelectorAll('.trip-card img').forEach(i => (i.loading = 'eager'))`);
      await page.waitFor(`[...document.querySelectorAll('.trip-card img')].every(i => i.complete)`, 8000);
      const cards = await page.eval<any[]>(`[...document.querySelectorAll('.trip-card')].map(c => ({ title: c.querySelector('h3').textContent, img: c.querySelector('img.cover-img')?.naturalWidth ?? null, alt: c.querySelector('img.cover-img')?.getAttribute('alt') ?? null }))`);
      const tokyo = cards.find((c) => /Asakusa/.test(c.title));
      const iceland = cards.find((c) => c.title === "Somewhere new");
      expect(tokyo.img, `pass ${pass}`).toBeGreaterThan(0);
      expect(tokyo.alt).toBe(""); // decorative: the card already names the place
      expect(iceland.img).toBe(null); // no photo: the colour band, never a broken image
      expect(await page.eval(`document.documentElement.scrollWidth <= innerWidth`)).toBe(true);
    }
  });
});
