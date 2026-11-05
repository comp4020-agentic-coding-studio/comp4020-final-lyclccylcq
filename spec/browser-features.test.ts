import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { chromePath, inPage, launch, signUpIn, sleep } from "./browser.ts";
import { uniqueName } from "./helpers.ts";

// November 2026 additions, each driven in real Chrome: an invitation that
// arrives while the invitee is online, choosing several schedule fixes and
// applying them with one press, exporting a public itinerary without making
// it a trip first, and the About page that replaced the footer's line.
const baseUrl = inject("baseUrl");
let browser: NonNullable<Awaited<ReturnType<typeof launch>>>;
beforeAll(async () => {
  if (chromePath) browser = (await launch())!;
});
afterAll(() => browser?.close());

const newTrip = (p: Parameters<typeof inPage>[0], title: string) => inPage(p, "POST", "/api/trips", { title, destination: "Sydney", startDate: "2026-12-01", endDate: "2026-12-02", timezone: "Australia/Sydney" });

describe.skipIf(!chromePath)("an invitation while the invitee is online", () => {
  it("shows a card on whatever page they're on; offline, it waits in My Trips as before", async () => {
    const owner = await browser.newPage();
    const guest = await browser.newPage();
    await guest.viewport(390, 844, true);
    await signUpIn(owner, baseUrl, uniqueName("own"));
    const g = await signUpIn(guest, baseUrl, uniqueName("gst"));
    const away = await newTrip(owner, "While away");
    const live = await newTrip(owner, "While here");
    // not online: no page of the app open
    await guest.goto("about:blank");
    expect((await inPage(owner, "POST", `/api/trips/${away.id}/invitations`, { userId: g.id })).invitation.status).toBe("pending");
    // online on the homepage: what was already waiting doesn't pop up
    await guest.goto(new URL("/", baseUrl).href);
    await guest.waitFor(`document.querySelector('#explore-map')`, 10000);
    await sleep(800);
    expect(await guest.eval(`document.querySelectorAll('[data-invitation-card]').length`)).toBe(0);
    // a new one does, at once, with who, which trip, and the choice
    await inPage(owner, "POST", `/api/trips/${live.id}/invitations`, { userId: g.id });
    await guest.waitFor(`document.querySelector('dialog[open][data-invitation-card] h2')?.textContent === 'While here'`, 5000);
    expect(await guest.eval(`document.querySelectorAll('dialog[open][data-invitation-card]').length`)).toBe(1);
    expect(await guest.eval(`[...document.querySelectorAll('dialog[open] [data-invite-card]')].map(b => b.dataset.inviteCard)`)).toEqual(["later", "decline", "accept"]);
    expect(await guest.eval(`document.documentElement.scrollWidth <= innerWidth`)).toBe(true);
    // Later: nothing is answered, and it waits in My Trips with the other
    await guest.click("[data-invite-card=later]");
    await guest.waitFor(`!document.querySelector('dialog[open]')`);
    await guest.goto(new URL("/trips", baseUrl).href);
    await guest.waitFor(`document.querySelectorAll('[data-invitation]').length === 2`, 8000);
    expect(await guest.eval(`[...document.querySelectorAll('[data-invitation] h3')].map(e => e.textContent).sort()`)).toEqual(["While away", "While here"]);
    // on My Trips the list is live, so a new invitation adds a row, not a card
    const third = await newTrip(owner, "Third one");
    await inPage(owner, "POST", `/api/trips/${third.id}/invitations`, { userId: g.id });
    await guest.waitFor(`document.querySelectorAll('[data-invitation]').length === 3`, 5000);
    expect(await guest.eval(`document.querySelectorAll('[data-invitation-card]').length`)).toBe(0);
    // Accept from a card: joined, in the trip
    await guest.goto(new URL("/profile", baseUrl).href);
    await guest.waitFor(`document.querySelector('main')`, 5000);
    await sleep(500);
    const fourth = await newTrip(owner, "Fourth one");
    await inPage(owner, "POST", `/api/trips/${fourth.id}/invitations`, { userId: g.id });
    await guest.waitFor(`document.querySelector('dialog[open][data-invitation-card]')`, 5000);
    await guest.click("[data-invite-card=accept]");
    await guest.waitFor(`location.pathname === '/trips/${fourth.id}'`, 8000);
    expect((await inPage(guest, "GET", `/api/trips/${fourth.id}`)).members.map((m: any) => m.id)).toContain(g.id);
    // the owner cancels one while its card is open: the card goes
    const fifth = await newTrip(owner, "Fifth one");
    const sent = await inPage(owner, "POST", `/api/trips/${fifth.id}/invitations`, { userId: g.id });
    await guest.waitFor(`document.querySelector('dialog[open][data-invitation-card]')`, 5000);
    await inPage(owner, "DELETE", `/api/trips/${fifth.id}/invitations/${sent.invitation.id}`);
    await guest.waitFor(`!document.querySelector('dialog[open][data-invitation-card]')`, 5000);
  }, 60_000);
});

describe.skipIf(!chromePath)("fixing a day's conflicts", () => {
  it("lists each conflict's fixes as choices, previews them together, and applies them with one press", async () => {
    const page = await browser.newPage();
    await page.viewport(1440, 900);
    await signUpIn(page, baseUrl, uniqueName("fixes"));
    const trip = await inPage(page, "POST", "/api/trips", { title: "Chain", destination: "Sydney", startDate: "2026-12-01", endDate: "2026-12-01", timezone: "Australia/Sydney" });
    for (const [title, startMin, durationMin] of [["Zoo", 540, 180], ["Lunch", 705, 60], ["Museum", 760, 90], ["Dinner", 840, 60]] as const) {
      await inPage(page, "POST", `/api/trips/${trip.id}/activities`, { clientId: `${title}-${Math.random()}`, dayId: trip.days[0].id, title, kind: "attraction", startMin, durationMin });
    }
    await page.goto(new URL(`/trips/${trip.id}`, baseUrl).href);
    await page.waitFor(`document.querySelector('.conn-live')`, 8000);
    await page.eval(`[...document.querySelectorAll('.timeline button')].find(b => b.textContent === 'See options').click()`);
    await page.waitFor(`document.querySelectorAll('[data-fixes] fieldset').length === 3`, 5000);
    // one choice per problem, plus keeping it; nothing applied yet
    for (const n of [0, 1, 2]) expect(await page.eval(`document.querySelectorAll('[data-fixes] fieldset')[${n}].querySelectorAll('input[type=radio]:checked').length`)).toBe(1);
    // the chosen fixes together clear the chain (each one alone wouldn't), and say so before applying
    expect(await page.eval(`document.querySelector('[data-fixes-remaining]').dataset.fixesRemaining`)).toBe("0");
    expect(await page.eval(`document.querySelector('[data-fixes-apply]').dataset.fixesApply`)).toBe("3");
    expect((await inPage(page, "GET", `/api/trips/${trip.id}`)).days[0].analysis.issues).toHaveLength(3);
    // changing one choice updates the preview at once
    await page.eval(`document.querySelectorAll('[data-fixes] fieldset')[2].querySelector('input[value=keep]').click()`);
    await page.waitFor(`document.querySelector('[data-fixes-apply]').dataset.fixesApply === '2'`);
    expect(await page.eval(`document.querySelector('[data-fixes-remaining]').dataset.fixesRemaining`)).toBe("1");
    // a choice that would change a stop another choice already changes is
    // unavailable: with the first problem's stops all pushed later, the
    // second's "start Museum later" would move Museum a second time
    const radio = (n: number, kind: string) => `[...document.querySelectorAll('[data-fixes] fieldset')[${n}].querySelectorAll('input')].find(i => i.value.startsWith('${kind}'))`;
    await page.eval(`${radio(0, "push_rest")}.click()`);
    await page.waitFor(`${radio(0, "push_rest")}.checked`);
    expect(await page.eval(`${radio(1, "delay_next")}.disabled`)).toBe(true);
    expect(await page.eval(`${radio(1, "shorten_prev")}.disabled`)).toBe(false);
    await page.eval(`${radio(0, "shorten_prev")}.click()`);
    await page.waitFor(`document.querySelector('[data-fixes-apply]').dataset.fixesApply === '2'`);
    // one press: both chosen fixes, in one change. The one kept as planned
    // is still a conflict on the server (shown on the timeline), and the
    // form doesn't ask about it again, as "Keep as planned" always did
    await page.click("[data-fixes-apply]");
    await page.waitFor(`!document.querySelector('[data-fixes]')`, 5000);
    const day = (await inPage(page, "GET", `/api/trips/${trip.id}`)).days[0];
    expect(day.activities.map((a: any) => [a.title, a.startMin, a.durationMin])).toEqual([["Zoo", 540, 165], ["Lunch", 705, 55], ["Museum", 760, 90], ["Dinner", 840, 60]]);
    expect(day.analysis.issues.map((x: any) => x.kind)).toEqual(["overlap"]);
    expect(await page.eval(`document.querySelectorAll('.timeline .leg-warn, .timeline [class*=conflict]').length > 0 || /Overlaps/.test(document.querySelector('.timeline').textContent)`)).toBe(true);
  }, 40_000);

  it("refuses the whole set if the day changed after the choices were shown", async () => {
    const page = await browser.newPage();
    await page.viewport(1440, 900);
    await signUpIn(page, baseUrl, uniqueName("fixstale"));
    const trip = await inPage(page, "POST", "/api/trips", { title: "Stale", destination: "Sydney", startDate: "2026-12-01", endDate: "2026-12-01", timezone: "Australia/Sydney" });
    const ids: string[] = [];
    for (const [title, startMin, durationMin] of [["Zoo", 540, 180], ["Lunch", 705, 60]] as const) {
      ids.push((await inPage(page, "POST", `/api/trips/${trip.id}/activities`, { clientId: `${title}-${Math.random()}`, dayId: trip.days[0].id, title, kind: "attraction", startMin, durationMin })).activityId);
    }
    await page.goto(new URL(`/trips/${trip.id}`, baseUrl).href);
    await page.waitFor(`document.querySelector('.conn-live')`, 8000);
    await page.eval(`[...document.querySelectorAll('.timeline button')].find(b => b.textContent === 'See options').click()`);
    await page.waitFor(`document.querySelector('[data-fixes-apply]')`, 5000);
    // the form holds its choices; the request carries the day they were shown for
    await page.eval(`window.__f = document.querySelector('[data-fixes]').dataset.fixes`);
    const snap = await inPage(page, "GET", `/api/trips/${trip.id}`);
    const res = await inPage(page, "POST", `/api/trips/${trip.id}/proposals/apply-many`, { dayId: snap.days[0].id, basedOn: "stale-fingerprint", proposalIds: [snap.days[0].analysis.proposals[0].id] });
    expect(res.code).toBe("stale");
    expect((await inPage(page, "GET", `/api/trips/${trip.id}`)).days[0].activities.map((a: any) => a.startMin)).toEqual([540, 705]);
  }, 30_000);
});

describe.skipIf(!chromePath)("exporting a public itinerary", () => {
  for (const vp of [{ w: 1920, h: 1080, m: false }, { w: 390, h: 844, m: true }]) {
    it(`exports a curated itinerary without an account, as a document with its stops (${vp.w}×${vp.h})`, async () => {
      const page = await browser.newPage();
      await page.viewport(vp.w, vp.h, vp.m);
      await page.goto(new URL("/itineraries/tpl-sydney-harbour-highlights", baseUrl).href);
      await page.waitFor(`document.querySelector('[data-pv=export]')`, 10000);
      await page.click("[data-pv=export]");
      await page.waitFor(`location.pathname === '/itineraries/tpl-sydney-harbour-highlights/export' && document.querySelector('[data-export-doc=itinerary] .tp-title')`, 10000);
      expect(await page.eval(`document.querySelector('.tp-title').textContent`)).toBe("Sydney Harbour Highlights");
      expect(await page.eval(`document.querySelectorAll('.tp-stop').length`)).toBe(5);
      expect(await page.eval(`document.querySelector('.tp-sub').textContent`)).toContain("Curated by Wayline");
      // no travel times are claimed: the itinerary has none
      expect(await page.eval(`document.querySelectorAll('.tp-leg').length`)).toBe(0);
      expect(await page.eval(`document.querySelector('.tp-foot').textContent`)).toMatch(/Travel times between stops aren't part of this itinerary/);
      expect(await page.eval(`[...document.querySelectorAll('.tp-actions button')].map(b => b.dataset.export ?? b.dataset.print)`)).toEqual(["image", "go"]);
      expect(await page.eval(`document.documentElement.scrollWidth <= innerWidth`)).toBe(true);
    });
  }

  it("exports a published journey as its author shared it: no notes, no account needed, as an image too", async () => {
    const owner = await browser.newPage();
    await signUpIn(owner, baseUrl, uniqueName("pubexp"));
    const trip = await inPage(owner, "POST", "/api/trips", { title: "Shared day", destination: "Sydney", startDate: "2026-12-01", endDate: "2026-12-01", timezone: "Australia/Sydney" });
    await inPage(owner, "POST", `/api/trips/${trip.id}/activities`, { clientId: `a-${Math.random()}`, dayId: trip.days[0].id, title: "Opera House", kind: "attraction", startMin: 600, durationMin: 60, notes: "PRIVATE NOTE" });
    const pub = (await inPage(owner, "PUT", `/api/trips/${trip.id}/publication`, { description: "A day out", visibility: "link" })).publication;
    const reader = await browser.newPage();
    await reader.viewport(1440, 900);
    await reader.goto(new URL(`/journeys/${pub.id}`, baseUrl).href);
    await reader.waitFor(`document.querySelector('[data-jy=export]')`, 10000);
    await reader.click("[data-jy=export]");
    await reader.waitFor(`document.querySelector('[data-export-doc=itinerary] .tp-title')?.textContent === 'Shared day'`, 10000);
    expect(await reader.eval(`document.body.innerText.includes('PRIVATE NOTE')`)).toBe(false);
    expect(await reader.eval(`document.querySelector('.tp-sub').textContent`)).toContain("By ");
    await reader.eval(`window.__saved = []; HTMLAnchorElement.prototype.click = function () { window.__saved.push(this.download); }`);
    await reader.click("[data-export=image]");
    await reader.waitFor(`window.__saved.length === 1`, 10000);
    expect(await reader.eval(`window.__saved[0]`)).toBe("shared-day.png");
    // withdrawn: the export goes with it
    await inPage(owner, "DELETE", `/api/trips/${trip.id}/publication`);
    await reader.goto(new URL(`/itineraries/${pub.id}/export`, baseUrl).href);
    await reader.waitFor(`document.querySelector('.invite-card h1')`, 8000);
    expect(await reader.eval(`document.querySelector('.invite-card h1').textContent`)).toBe("This itinerary isn't available");
  }, 30_000);
});

describe.skipIf(!chromePath)("the footer and About", () => {
  it("keeps the footer to links, and says where the information comes from on /about", async () => {
    const page = await browser.newPage();
    await page.viewport(390, 844, true);
    await page.goto(new URL("/", baseUrl).href);
    await page.waitFor(`document.querySelector('.site-footer a[href="/about"]')`, 10000);
    expect(await page.eval(`document.querySelector('.site-footer').innerText`)).not.toMatch(/Maps, places and routes come from/);
    await page.click('.site-footer a[href="/about"]');
    await page.waitFor(`location.pathname === '/about' && document.querySelector('main.about h1')`, 5000);
    const text = await page.eval<string>(`document.querySelector('main.about').innerText`);
    expect(text).toMatch(/Google Maps Platform/);
    expect(text).toMatch(/never estimates a travel time/);
    expect(await page.eval(`Boolean(document.querySelector('main.about a[href="/readme/"]'))`)).toBe(true);
    expect((await fetch(new URL("/about", baseUrl))).status).toBe(200);
    expect(await page.eval(`document.documentElement.scrollWidth <= innerWidth`)).toBe(true);
  });
});
