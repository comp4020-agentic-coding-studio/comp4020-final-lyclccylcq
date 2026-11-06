import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { chromePath, inPage, launch, type Page, signUpIn, sleep } from "./browser.ts";
import { uniqueName } from "./helpers.ts";

// Regressions found in review (November 2026), each driven in real Chrome:
// answers that arrive out of order, keyboard focus through a collaborator's
// change, the phone header, and the new-trip entry points.
const baseUrl = inject("baseUrl");
let browser: NonNullable<Awaited<ReturnType<typeof launch>>>;
beforeAll(async () => {
  if (chromePath) browser = (await launch())!;
});
afterAll(() => browser?.close());

const newTrip = (p: Page, title = "Fix trip") => inPage(p, "POST", "/api/trips", { title, destination: "Sydney", startDate: "2026-12-01", endDate: "2026-12-03", timezone: "Australia/Sydney" });
const addStop = (p: Page, tripId: string, dayId: string, title: string, startMin: number) =>
  inPage(p, "POST", `/api/trips/${tripId}/activities`, { clientId: `${title}-${Math.random()}`, dayId, title, kind: "attraction", startMin, durationMin: 60 });

// The page's fetch, with answers that wait until the test lets them go:
// __hold(pattern) holds matching requests; __release(pattern, n) lets the
// nth held one through (its real answer, or a failure).
const HOLD = `(() => {
  const real = window.fetch.bind(window);
  const held = [];
  const rules = [];
  window.__hold = (re) => rules.push(new RegExp(re));
  window.__held = (re) => held.filter((x) => new RegExp(re).test(x.key)).length;
  window.__release = (re, n = 0, fail = false) => {
    const list = held.filter((x) => new RegExp(re).test(x.key));
    const x = list[n];
    held.splice(held.indexOf(x), 1);
    x.go(fail);
  };
  window.fetch = (url, init) => {
    const key = String(url) + " " + (init?.body ?? "");
    if (!rules.some((r) => r.test(key))) return real(url, init);
    return new Promise((resolve, reject) => held.push({ key, go: (fail) => (fail ? reject(new TypeError("held request failed")) : real(url, init).then(resolve, reject)) }));
  };
})();`;

describe.skipIf(!chromePath)("regressions: order, focus, header, entry points", () => {
  it("files each travel-time answer under the mode it was asked for, however late it comes", async () => {
    const page = await browser.newPage();
    await page.viewport(1440, 900);
    // routes on for this page (the app's config), answered by a stand-in
    // whose numbers differ by mode, so a mix-up shows
    await page.initScript(`(() => {
        const f = window.fetch.bind(window);
        window.fetch = (url, init) => {
          const u = String(url);
          if (u.endsWith("/api/config")) return f(url, init).then((r) => r.json()).then((c) => new Response(JSON.stringify({ ...c, routes: true }), { headers: { "content-type": "application/json" } }));
          if (u.endsWith("/api/routes")) {
            const mode = JSON.parse(init.body).mode;
            const sec = { WALK: 2940, TRANSIT: 1500, DRIVE: 480 }[mode];
            return Promise.resolve(new Response(JSON.stringify({ mode, status: "ok", durationSec: sec, distanceM: 3000, steps: [] }), { headers: { "content-type": "application/json" } }));
          }
          return f(url, init);
        };
      })();
      ${HOLD}`);
    await page.goto(new URL("/itineraries/tpl-sydney-harbour-highlights", baseUrl).href);
    await page.eval(`window.__hold("WALK")`);
    await page.waitFor(`document.querySelector('[data-routes="load"]')`, 8000);
    // ask for walking times; while they're out, switch to driving and ask again
    await page.eval(`document.querySelector('[data-routes="load"]').click()`);
    await page.waitFor(`window.__held("WALK") > 0`);
    await page.eval(`[...document.querySelectorAll('.modes .mode')].find((b) => /Drive/.test(b.textContent)).click()`);
    await page.eval(`document.querySelector('[data-routes="load"]').click()`);
    await page.waitFor(`document.querySelector('.pv-leg-drive')?.textContent.includes('8 min')`, 8000);
    // the late walking answers arrive: driving still shows driving times
    while (await page.eval<number>(`window.__held("WALK")`)) await page.eval(`window.__release("WALK")`);
    await sleep(200);
    const drive = await page.eval<string>(`[...document.querySelectorAll('.pv-leg')].map((l) => l.textContent).join(' | ')`);
    expect(drive).toContain("Drive · 8 min");
    expect(drive).not.toContain("49 min");
    // back to walking: the walking answers are there
    await page.eval(`[...document.querySelectorAll('.modes .mode')].find((b) => /Walk/.test(b.textContent)).click()`);
    expect(await page.eval<string>(`document.querySelector('.pv-leg').textContent`)).toContain("Walk · 49 min");
  }, 30_000);

  it("shows only the latest place search, whatever order the answers come back in", async () => {
    const page = await browser.newPage();
    await page.viewport(1440, 900);
    await page.initScript(HOLD);
    await signUpIn(page, baseUrl, uniqueName("srch"));
    const trip = await newTrip(page);
    await page.goto(new URL(`/trips/${trip.id}`, baseUrl).href);
    await page.waitFor(`document.querySelector('.conn-live')`, 8000);
    await page.eval(`window.__hold("places/search")`);
    const search = async (q: string) => {
      await page.eval(`(() => { const i = document.querySelector('form.search input'); i.value = ${JSON.stringify(q)}; i.form.requestSubmit(); })()`);
    };
    // "Opera" first, then "Bondi"; Bondi answers first, Opera last
    await search("Opera");
    await search("Bondi");
    await page.waitFor(`window.__held("places/search") === 2`);
    await page.eval(`window.__release("q=Bondi")`);
    await page.waitFor(`/Bondi/.test(document.querySelector('.search-panel')?.textContent ?? '')`, 8000);
    await page.eval(`window.__release("q=Opera")`);
    await sleep(300);
    const shown = await page.eval<string>(`document.querySelector('.search-panel').textContent`);
    expect(shown).toContain("Bondi");
    expect(shown).not.toMatch(/Opera House/);
    // a failure for an old search doesn't replace the current results either
    await search("Opera");
    await search("Bondi");
    await page.waitFor(`window.__held("places/search") === 2`);
    await page.eval(`window.__release("q=Bondi")`);
    await page.waitFor(`/Bondi/.test(document.querySelector('.search-panel')?.textContent ?? '')`, 8000);
    await page.eval(`window.__release("q=Opera", 0, true)`);
    await sleep(300);
    expect(await page.eval<string>(`document.querySelector('.search-panel').textContent`)).not.toMatch(/offline|form-error/);
    expect(await page.eval(`document.querySelector('.search-panel .form-error')`)).toBe(null);
    // closing the search makes a pending one old: it never reopens the panel
    await search("Opera");
    await page.waitFor(`window.__held("places/search") === 1`);
    await page.eval(`document.querySelector('.search-panel button[aria-label="Close search results"]').click()`);
    expect(await page.eval(`document.querySelector('.search-panel').hidden`)).toBe(true);
    await page.eval(`window.__release("q=Opera")`);
    await sleep(300);
    expect(await page.eval(`document.querySelector('.search-panel').hidden`)).toBe(true);
  }, 30_000);

  // The homepage map's places list, with answers held and released out of
  // order (no Google key: demo places around Sydney, none around Canberra,
  // and "In Wayline plans" answered from Wayline's own plans). Each case
  // checks what the panel and map end up showing: the list, its markers,
  // the note naming the place, the error line and the loading line.
  describe("the homepage map's places, answered out of order", () => {
    const side = `document.querySelector('#explore-map .xm-side').textContent`;
    const note = `document.querySelector('#explore-map .xm-note').textContent`;
    const rows = `[...document.querySelectorAll('#explore-map .place-row strong')].map((e) => e.textContent)`;
    const marks = `document.querySelectorAll('#explore-map .schematic-result').length`;
    const loading = `Boolean(document.querySelector('#explore-map .xm-side [role=status]'))`;
    const error = `document.querySelector('#explore-map .xm-side .form-error')?.textContent ?? null`;
    const pressed = `document.querySelector('#explore-map .xm-cats button[aria-pressed=true]')?.textContent ?? null`;
    const open = async () => {
      const page = await browser.newPage();
      await page.viewport(1440, 900);
      await page.initScript(HOLD);
      await page.goto(new URL("/", baseUrl).href);
      await page.waitFor(`document.querySelector('#explore-map .xm-ideas button')`, 10000);
      return page;
    };
    const city = (page: Page, name: string) => page.eval(`[...document.querySelectorAll('#explore-map .xm-ideas button')].find((b) => b.textContent === ${JSON.stringify(name)}).click()`);
    const chip = (page: Page, label: string) => page.eval(`[...document.querySelectorAll('#explore-map .xm-cats button')].find((b) => b.textContent === ${JSON.stringify(label)}).click()`);
    const search = (page: Page, q: string) => page.eval(`(() => { const i = document.querySelector('#explore-map .xm-search input'); i.value = ${JSON.stringify(q)}; i.form.requestSubmit(); })()`);
    const inSydney = async (page: Page) => {
      await city(page, "Sydney");
      await page.waitFor(`${rows}.includes("Queen Victoria Building")`, 8000);
    };

    it("keeps the newer city's places when the older city answers last", async () => {
      const page = await open();
      await page.eval(`window.__hold("places/nearby")`);
      await city(page, "Canberra");
      await page.waitFor(`window.__held("places/nearby") === 1`);
      // Sydney from its city card further down (it changes the destination, as the quick picks do)
      await page.waitFor(`document.querySelector('#city-sydney .rx-go')`, 10000);
      await page.click("#city-sydney .rx-go");
      await page.waitFor(`window.__held("places/nearby") === 2`);
      await page.eval(`window.__release("lat=-33.8688")`);
      await page.waitFor(`${rows}.includes("Queen Victoria Building")`, 8000);
      await page.eval(`window.__release("lat=-35.2809")`); // Canberra: no demo places
      await sleep(400);
      expect(await page.eval(note)).toContain("Sydney");
      expect(await page.eval(rows)).toContain("Queen Victoria Building");
      expect(await page.eval(side)).not.toMatch(/No places found here/);
      expect(await page.eval(marks)).toBe((await page.eval<string[]>(rows)).length);
      expect(await page.eval(loading)).toBe(false);
      expect(await page.eval(error)).toBe(null);
    }, 30_000);

    it("ignores an older category's failure after the newer one answered", async () => {
      const page = await open();
      await inSydney(page);
      await page.eval(`window.__hold("places/nearby"); window.__hold("itineraries/highlights")`);
      await chip(page, "Museums");
      await page.waitFor(`window.__held("type=museum") === 1`);
      await chip(page, "In Wayline plans");
      await page.waitFor(`window.__held("itineraries/highlights") === 1`);
      await page.eval(`window.__release("itineraries/highlights")`);
      await page.waitFor(`!${loading}`, 8000);
      const wayline = await page.eval<string[]>(rows);
      expect(wayline.length).toBeGreaterThan(0);
      await page.eval(`window.__release("type=museum", 0, true)`);
      await sleep(400);
      expect(await page.eval(error)).toBe(null);
      expect(await page.eval(rows)).toEqual(wayline);
      expect(await page.eval(marks)).toBe(wayline.length);
      expect(await page.eval(pressed)).toBe("In Wayline plans");
      expect(await page.eval(loading)).toBe(false);
    }, 30_000);

    it("ignores an older search or category once the query has changed, and keeps the newer one loading", async () => {
      const page = await open();
      await inSydney(page);
      await page.eval(`window.__hold("places/nearby"); window.__hold("places/search")`);
      // a search, then a category: the search's late answer (one place) is
      // ignored, and its ending doesn't end the category's loading
      await search(page, "Opera");
      await page.waitFor(`window.__held("places/search") === 1`);
      await chip(page, "Parks");
      await page.waitFor(`window.__held("type=park") === 1`);
      await page.eval(`window.__release("places/search")`);
      await sleep(400);
      expect(await page.eval(loading)).toBe(true); // still waiting for Parks
      expect(await page.eval(rows)).toEqual([]);
      await page.eval(`window.__release("type=park")`);
      await page.waitFor(`!${loading}`, 8000);
      expect((await page.eval<string[]>(rows)).length).toBe(10); // the full demo list
      expect(await page.eval(pressed)).toBe("Parks");
      // a category, then a search: the category's late answer is ignored
      await chip(page, "Restaurants");
      await page.waitFor(`window.__held("type=restaurant") === 1`);
      await search(page, "Bridge");
      await page.waitFor(`window.__held("places/search") === 1`);
      await page.eval(`window.__release("places/search")`);
      await page.waitFor(`!${loading}`, 8000);
      await page.eval(`window.__release("type=restaurant")`);
      await sleep(400);
      expect(await page.eval(rows)).toEqual(["Sydney Harbour Bridge"]);
      expect(await page.eval(marks)).toBe(1);
      expect(await page.eval(pressed)).toBe(null);
      expect(await page.eval(loading)).toBe(false);
    }, 30_000);

    it("changes nothing when a pending answer arrives after the place is cleared", async () => {
      const page = await open();
      await inSydney(page);
      await page.eval(`window.__hold("places/nearby")`);
      await chip(page, "Cafés");
      await page.waitFor(`window.__held("type=cafe") === 1`);
      await chip(page, "Zoos");
      await page.waitFor(`window.__held("type=zoo") === 1`);
      await page.eval(`[...document.querySelectorAll('.chip-place ~ button')].find((x) => /Clear/.test(x.textContent)).click()`);
      await page.waitFor(`document.querySelector('#explore-map .xm-start-title')`);
      await page.eval(`window.__release("type=cafe")`);
      await page.eval(`window.__release("type=zoo", 0, true)`);
      await sleep(400);
      expect(await page.eval(`Boolean(document.querySelector('#explore-map .xm-start-title'))`)).toBe(true);
      expect(await page.eval(rows)).toEqual([]);
      expect(await page.eval(marks)).toBe(0);
      expect(await page.eval(error)).toBe(null);
      expect(await page.eval(note)).toMatch(/Search a city/);
    }, 30_000);

    it("never draws into the map after leaving the page, whether the answer succeeds or fails", async () => {
      const page = await open();
      await page.eval(`window.__hold("places/nearby")`);
      await city(page, "Sydney");
      await page.waitFor(`window.__held("places/nearby") === 1`);
      await chip(page, "Museums");
      await page.waitFor(`window.__held("type=museum") === 1`);
      await page.eval(`window.__xm = document.querySelector('#explore-map')`);
      await page.eval(`document.querySelector('.site-footer a[href="/credits"]').click()`);
      await page.waitFor(`location.pathname === '/credits'`);
      await page.eval(`window.__xmBefore = window.__xm.innerHTML`);
      await page.eval(`window.__release("type=tourist_attraction")`);
      await page.eval(`window.__release("type=museum", 0, true)`);
      await sleep(400);
      expect(await page.eval(`window.__xm.innerHTML === window.__xmBefore`)).toBe(true);
      expect(await page.eval(`window.__xm.querySelectorAll('.place-row, .form-error').length`)).toBe(0);
      expect(await page.eval(`Boolean(document.querySelector('#explore-map'))`)).toBe(false);
    }, 30_000);
  });

  it("keeps the keyboard where it was when a collaborator changes the plan", async () => {
    const a = await browser.newPage();
    await a.viewport(1440, 900);
    const b = await browser.newPage();
    await signUpIn(a, baseUrl, uniqueName("fa"));
    await signUpIn(b, baseUrl, uniqueName("fb"));
    const trip = await newTrip(a);
    const bId = (await inPage(b, "GET", "/api/auth/me")).user.id;
    const inv = await inPage(a, "POST", `/api/trips/${trip.id}/invitations`, { userId: bId });
    await inPage(b, "POST", `/api/invitations/${inv.invitation.id}/accept`, {});
    await addStop(a, trip.id, trip.days[0].id, "Opera House", 600);
    await a.goto(new URL(`/trips/${trip.id}`, baseUrl).href);
    await a.waitFor(`document.querySelector('.conn-live') && document.querySelector('[data-focus^="line-day:"]')`, 8000);
    const focused = () => a.eval<string | null>(`document.activeElement?.dataset?.focus ?? document.activeElement?.tagName ?? null`);

    // A moves along the days with the real keyboard: day 1, Tab, day 2
    await a.eval(`document.querySelector('[data-focus="line-day:${trip.days[0].id}"]').focus()`);
    await a.key("Tab");
    const before = await focused();
    expect(before).toBe(`line-day:${trip.days[1].id}`);
    // B adds a stop: A's page re-renders, A's focus stays put
    await addStop(b, trip.id, trip.days[0].id, "Bondi", 840);
    await a.waitFor(`document.querySelector('.timeline')?.textContent.includes('Bondi')`, 8000);
    expect(await focused()).toBe(before);
    // and the keyboard goes on from there, not from the top of the page
    await a.key("Shift+Tab");
    expect(await focused()).toBe(`line-day:${trip.days[0].id}`);
    await a.key("Tab");
    await a.key("Enter"); // opens day 2
    await a.waitFor(`document.querySelector('[data-focus="${before}"]')?.getAttribute('aria-pressed') === 'true'`, 4000);
    expect(await focused()).toBe(before);
    await a.key("Shift+Tab");
    await a.key("Enter"); // back to day 1
    await a.waitFor(`document.querySelector('[data-focus="line-day:${trip.days[0].id}"]')?.getAttribute('aria-pressed') === 'true'`, 4000);

    // in the timeline: a stop's control keeps the focus through B's retime
    await a.waitFor(`document.querySelector('.timeline [data-id] button')`);
    await a.eval(`document.querySelector('.timeline [data-id] button').focus()`);
    const stopId = await a.eval<string>(`document.activeElement.closest('[data-id]').dataset.id`);
    const label = await a.eval<string>(`document.activeElement.textContent`);
    const bondi = (await inPage(b, "GET", `/api/trips/${trip.id}`)).days[0].activities.find((x: any) => x.title === "Bondi");
    await inPage(b, "PATCH", `/api/trips/${trip.id}/activities/${bondi.id}`, { startMin: 900, baseVersion: bondi.version });
    await a.waitFor(`document.querySelector('.timeline')?.textContent.includes('15:00')`, 8000);
    expect(await a.eval(`document.activeElement.closest('[data-id]')?.dataset.id`)).toBe(stopId);
    expect(await a.eval(`document.activeElement.textContent`)).toBe(label);
    // the stop with the focus is removed: focus stays in its list, not the page's top
    await inPage(b, "DELETE", `/api/trips/${trip.id}/activities/${stopId}`);
    await a.waitFor(`!document.querySelector('.timeline [data-id="${stopId}"]')`, 8000).catch(() => {});
    const now = await a.eval<string>(`document.activeElement === document.body ? 'BODY' : (document.activeElement.closest('[data-region]')?.dataset.region ?? document.activeElement.tagName)`);
    if (!(await a.eval(`Boolean(document.querySelector('.timeline [data-id="${stopId}"]'))`))) expect(now).toBe("timeline");
  }, 40_000);

  it("fits the phone header in both languages, signed in or out, with every entry reachable and named", async () => {
    const page = await browser.newPage();
    for (const lang of ["en", "zh"]) {
      await page.viewport(390, 844, true);
      await page.goto(new URL("/readme/", baseUrl).href);
      await page.eval(`localStorage.setItem('wayline.lang', '${lang}')`);
      await page.goto(new URL("/", baseUrl).href);
      await page.waitFor(`document.querySelector('.topbar [data-create="trip"]')`, 8000);
      expect(await page.eval(`document.documentElement.scrollWidth`)).toBe(390);
      const inView = (sel: string) => page.eval<boolean>(`(() => { const r = document.querySelector(${JSON.stringify(sel)}).getBoundingClientRect(); return r.width > 0 && r.left >= 0 && r.right <= innerWidth; })()`);
      expect(await inView('.topbar a[href^="/login"]')).toBe(true);
      expect(await inView('.topbar [data-create="trip"]')).toBe(true);
      // the + has a name in the page's language
      expect(await page.eval(`document.querySelector('.topbar [data-create="trip"]').getAttribute('aria-label')`)).toBe(lang === "zh" ? "创建行程" : "Create Trip");
      expect(await page.eval(`document.querySelector('.topbar .brand').getAttribute('aria-label')`)).toBe("Wayline");
    }
    await signUpIn(page, baseUrl, uniqueName("hd"));
    for (const lang of ["en", "zh"]) {
      await inPage(page, "PATCH", "/api/me/profile", { lang });
      await page.eval(`localStorage.setItem('wayline.lang', '${lang}')`);
      await page.goto(new URL("/", baseUrl).href);
      await page.waitFor(`document.querySelector('[data-me="menu"]')`, 8000);
      expect(await page.eval(`document.documentElement.scrollWidth`)).toBe(390);
      expect(await page.eval<boolean>(`(() => { const r = document.querySelector('[data-me="menu"]').getBoundingClientRect(); return r.right <= innerWidth && r.width > 0; })()`)).toBe(true);
    }
    // the desktop header is unchanged: the wordmark and the full Create Trip label
    await page.viewport(1920, 1080);
    await page.goto(new URL("/", baseUrl).href);
    await page.waitFor(`document.querySelector('.topbar .brand-word')`, 8000);
    expect(await page.eval(`getComputedStyle(document.querySelector('.topbar .brand-word')).display`)).not.toBe("none");
    expect(await page.eval(`document.documentElement.scrollWidth <= innerWidth`)).toBe(true);
  }, 40_000);

  it("opens New trip with an empty destination, fills it only from a chosen place, and won't save an empty one", async () => {
    const page = await browser.newPage();
    await page.viewport(390, 844, true);
    await signUpIn(page, baseUrl, uniqueName("nt"));
    // no trips yet: "Plan your first trip"
    await page.goto(new URL("/trips", baseUrl).href);
    await page.waitFor(`document.querySelector('[data-create="first"]')`, 8000);
    // what the tap meets, kept for the failure message (CI only ever lost it)
    await page.eval(`(() => { window.__tapLog = []; window.__btn0 = document.querySelector('[data-create="first"]'); const r = window.__btn0.getBoundingClientRect(); window.__tapLog.push('btn ' + [r.x, r.y, r.width, r.height].map(Math.round) + ' fonts ' + document.fonts.status + ' at ' + Math.round(performance.now())); for (const k of ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click', 'touchstart', 'pointercancel']) addEventListener(k, (e) => window.__tapLog.push(k + ' ' + (e.target?.dataset?.create ?? e.target?.tagName) + ' ' + Math.round(e.clientX) + ',' + Math.round(e.clientY) + ' same=' + (document.querySelector('[data-create="first"]') === window.__btn0) + ' at ' + Math.round(performance.now())), true); })()`);
    await page.tap('[data-create="first"]');
    try {
      await page.waitFor(`document.querySelector('dialog[open] input[name=destination]')`);
    } catch (err) {
      const seen = await page.eval<string[]>(`(() => { const b = document.querySelector('[data-create="first"]'); const r = b?.getBoundingClientRect(); const at = r && document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2); return [...window.__tapLog, 'now btn ' + (r ? [r.x, r.y, r.width, r.height].map(Math.round) : 'gone') + ' same=' + (b === window.__btn0) + ' top=' + (at ? at.tagName + '.' + at.className : 'none') + ' dialogs=' + document.querySelectorAll('dialog').length + ' fonts=' + document.fonts.status + ' at ' + Math.round(performance.now())]; })()`).catch((e) => [String(e)]);
      throw new Error(`${(err as Error).message}\n${seen.join("\n")}`);
    }
    expect(await page.eval(`document.querySelector('dialog[open] input[name=destination]').value`)).toBe("");
    // submitting it empty is refused by the form; nothing is created
    await page.eval(`(() => { const f = document.querySelector('dialog[open] form'); f.title.value = 'Empty'; f.requestSubmit(); })()`);
    await sleep(300);
    expect((await inPage(page, "GET", "/api/trips")).owned).toHaveLength(0);
    expect(await page.eval(`document.querySelector('dialog[open] input[name=destination]').validity.valueMissing`)).toBe(true);
    await page.eval(`document.querySelector('dialog[open]').close()`);
    // with a trip: "New trip"
    await newTrip(page);
    await page.goto(new URL("/trips", baseUrl).href);
    await page.waitFor(`document.querySelector('[data-create="new"]')`, 8000);
    await page.tap('[data-create="new"]');
    await page.waitFor(`document.querySelector('dialog[open] input[name=destination]')`);
    expect(await page.eval(`document.querySelector('dialog[open] input[name=destination]').value`)).toBe("");
    await page.eval(`document.querySelector('dialog[open]').close()`);
    // the header's + too
    await page.tap('.topbar [data-create="trip"]');
    await page.waitFor(`document.querySelector('dialog[open] input[name=destination]')`);
    expect(await page.eval(`document.querySelector('dialog[open] input[name=destination]').value`)).toBe("");
    await page.eval(`document.querySelector('dialog[open]').close()`);
    // the server refuses a blank destination whatever the page sends
    expect((await inPage(page, "POST", "/api/trips", { title: "X", destination: "   ", startDate: "2026-12-01", endDate: "2026-12-01", timezone: "Australia/Sydney" })).error).toMatch(/Destination/);
  }, 30_000);

  it("asks before moving the starting point to a new first day, and keeps the trip as it was if not", async () => {
    const page = await browser.newPage();
    await page.viewport(1920, 1080);
    await signUpIn(page, baseUrl, uniqueName("sd"));
    const trip = await newTrip(page);
    await inPage(page, "PUT", `/api/trips/${trip.id}/start`, { clientId: `s-${Math.random()}`, title: "Central Station", place: { placeId: `custom:${crypto.randomUUID()}`, source: "custom", lat: -33.88, lng: 151.2 }, baseVersion: null });
    await page.goto(new URL(`/trips/${trip.id}`, baseUrl).href);
    await page.waitFor(`document.querySelector('.conn-live')`, 8000);
    const openSettings = async () => {
      await page.eval(`document.querySelector('[aria-label="Trip settings"]').click()`);
      await page.waitFor(`document.querySelector('dialog[open] input[name=startDate]')`);
    };
    await openSettings();
    await page.eval(`(() => { const f = document.querySelector('dialog[open] form'); f.startDate.value = '2026-11-30'; f.requestSubmit(); })()`);
    await page.waitFor(`document.querySelector('dialog[open] [data-start-move="confirm"]')`, 6000);
    // the window resizes to a phone and back while the question is open: it, and the typed date, stay
    await page.viewport(390, 844, true);
    await sleep(200);
    expect(await page.eval(`Boolean(document.querySelector('dialog[open] [data-start-move="confirm"]'))`)).toBe(true);
    expect(await page.eval(`document.querySelector('dialog[open] input[name=startDate]').value`)).toBe("2026-11-30");
    await page.viewport(1920, 1080);
    // keep the dates: nothing changed, and the question goes away
    await page.eval(`document.querySelector('dialog[open] [data-start-move="cancel"]').click()`);
    expect(await page.eval(`document.querySelector('dialog[open] [data-start-move]')`)).toBe(null);
    const kept = await inPage(page, "GET", `/api/trips/${trip.id}`);
    expect(kept.startDate).toBe("2026-12-01");
    expect(kept.days[0].activities[0].role).toBe("start");
    // ask again and move it: the same start leads the new first day
    await page.eval(`document.querySelector('dialog[open] form').requestSubmit()`);
    await page.waitFor(`document.querySelector('dialog[open] [data-start-move="confirm"]')`, 6000);
    await page.key("Enter"); // the confirm button has the focus
    await page.waitFor(`!document.querySelector('dialog[open]')`, 6000);
    const moved = await inPage(page, "GET", `/api/trips/${trip.id}`);
    expect(moved.days[0].date).toBe("2026-11-30");
    expect(moved.days[0].activities[0]).toMatchObject({ id: kept.days[0].activities[0].id, role: "start" });
  }, 30_000);
});
