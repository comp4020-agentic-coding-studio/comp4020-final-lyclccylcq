import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { chromePath, inPage, launch, signUpIn } from "./browser.ts";
import { uniqueName } from "./helpers.ts";

// November 2026 fixes found in manual testing, each in real Chrome: removing
// a stop while choosing a new place for it, changing a stop's place from its
// edit form, collaborators planning any stop, a missing meal shown where it
// would go. (Places to eat from that row, and suggestions cleared once the
// day changes, need Google: spec/browser-suggest.test.ts.)
const baseUrl = inject("baseUrl");
let browser: NonNullable<Awaited<ReturnType<typeof launch>>>;
beforeAll(async () => {
  if (chromePath) browser = (await launch())!;
});
afterAll(() => browser?.close());

type P = Parameters<typeof inPage>[0];
const trip = (p: P, title: string) => inPage(p, "POST", "/api/trips", { title, destination: "Sydney", startDate: "2026-11-19", endDate: "2026-11-19", timezone: "Australia/Sydney" });
const spot = (lat: number, lng: number) => ({ placeId: `custom:${crypto.randomUUID()}`, source: "custom", lat, lng });
const stop = (p: P, t: any, title: string, startMin: number | null, durationMin = 60, extra: Record<string, unknown> = {}) =>
  inPage(p, "POST", `/api/trips/${t.id}/activities`, { clientId: `${title}-${Math.random()}`, dayId: t.days[0].id, title, kind: "attraction", startMin, durationMin, place: spot(-33.89, 151.27), ...extra });
const open = async (p: P, t: any) => {
  await p.goto(new URL(`/trips/${t.id}`, baseUrl).href);
  await p.waitFor(`document.querySelector('.conn-live')`, 8000);
};

describe.skipIf(!chromePath)("changing a stop's place", () => {
  it("leaves the change cleanly if the stop is removed meanwhile, so planning again works", async () => {
    const page = await browser.newPage();
    await page.viewport(1440, 900);
    await signUpIn(page, baseUrl, uniqueName("rep"));
    const t = await trip(page, "coast walk");
    const bondi = (await stop(page, t, "Bondi Beach", 960, 20)).activityId;
    await open(page, t);
    // the place can be changed from a labelled button, and from the edit form
    await page.waitFor(`document.querySelector('[data-change-place="${bondi}"]')`);
    expect(await page.eval(`document.querySelector('.stop-actions [data-change-place]').textContent`)).toBe("Change place");
    await page.eval(`[...document.querySelectorAll('.stop-actions button')].find(b => b.textContent === 'Edit').click()`);
    await page.waitFor(`document.querySelector('dialog[open] [data-change-place]')`);
    await page.click(`dialog[open] [data-change-place]`);
    await page.waitFor(`!document.querySelector('dialog[open]') && /New place for Bondi Beach/.test(document.querySelector('.start-panel')?.textContent ?? '')`);
    // removed (here) while choosing: the change ends, nothing says "Use for Bondi Beach"
    await page.eval(`window.confirm = () => true; document.querySelector('.stop-actions .icon-btn-danger').click()`);
    await page.waitFor(`!document.querySelector('.stop')`, 5000);
    expect(await page.eval(`document.body.innerText.includes('Use for Bondi Beach') || document.body.innerText.includes('New place for Bondi Beach')`)).toBe(false);
    // the same, removed in another tab (what happened in manual testing)
    const again = (await stop(page, t, "Bondi Beach", 960, 20)).activityId;
    await page.waitFor(`document.querySelector('[data-change-place="${again}"]')`, 5000);
    await page.click(`[data-change-place="${again}"]`);
    await page.waitFor(`/New place for Bondi Beach/.test(document.querySelector('.start-panel')?.textContent ?? '')`);
    await inPage(page, "DELETE", `/api/trips/${t.id}/activities/${again}`);
    await page.waitFor(`!document.querySelector('.start-panel') && /there's no place to change/.test(document.body.innerText)`, 5000);
    // and planning again works: a click on the map now adds, no "no longer exists" error
    await page.eval(`document.querySelector('.search input').value = 'coogee'`);
    expect(await page.eval(`document.body.innerText.includes('no longer exists')`)).toBe(false);
    const added = await stop(page, t, "Coogee Beach", 1020, 60);
    expect(added.activityId).toBeTruthy();
  }, 40_000);
});

describe.skipIf(!chromePath)("a collaborator plans the trip", () => {
  it("changes, re-places and removes the owner's stops, sets the start and applies fixes", async () => {
    const owner = await browser.newPage();
    const guest = await browser.newPage();
    await owner.viewport(1440, 900);
    await guest.viewport(1440, 900);
    await signUpIn(owner, baseUrl, uniqueName("own"));
    const g = await signUpIn(guest, baseUrl, uniqueName("col"));
    const t = await trip(owner, "Together");
    await stop(owner, t, "Zoo", 540, 180);
    await stop(owner, t, "Lunch", 705, 60);
    const inv = await inPage(owner, "POST", `/api/trips/${t.id}/invitations`, { userId: g.id });
    await inPage(guest, "POST", `/api/invitations/${inv.invitation.id}/accept`);
    await open(guest, t);
    // every stop has its actions for the collaborator, the owner's included
    await guest.waitFor(`document.querySelectorAll('.stop .stop-actions').length === 2`, 5000);
    expect(await guest.eval(`[...document.querySelectorAll('.stop .stop-actions')].every(x => x.querySelector('[data-change-place]') && x.querySelector('.icon-btn-danger'))`)).toBe(true);
    expect(await guest.eval(`Boolean([...document.querySelectorAll('button')].find(b => b.textContent.includes('Set a starting point')))`)).toBe(true);
    // the timing conflict's fixes can be chosen and applied by them
    await guest.eval(`[...document.querySelectorAll('.timeline button')].find(b => b.textContent === 'See options').click()`);
    await guest.waitFor(`document.querySelector('[data-fixes-apply]')`, 5000);
    expect(await guest.eval(`document.querySelector('[data-fixes] input[type=radio]').disabled`)).toBe(false);
    expect(await guest.eval(`document.body.innerText.includes("Only the trip's owner can apply changes.")`)).toBe(false);
    await guest.click("[data-fixes-apply]");
    await guest.waitFor(`!document.querySelector('[data-fixes]')`, 5000);
    expect((await inPage(owner, "GET", `/api/trips/${t.id}`)).days[0].analysis.issues).toEqual([]);
    // the owner's settings stay with the owner
    expect(await guest.eval(`Boolean(document.querySelector('[aria-label="Trip settings"]'))`)).toBe(false);
  }, 40_000);
});

describe.skipIf(!chromePath)("a missing meal", () => {
  it("shows where it would go on the day: before setting out, and after the last stop", async () => {
    const page = await browser.newPage();
    await page.viewport(1440, 900);
    await signUpIn(page, baseUrl, uniqueName("meal"));
    const t = await trip(page, "Meals");
    await inPage(page, "PUT", `/api/trips/${t.id}/start`, { clientId: crypto.randomUUID(), title: "Hotel", place: spot(-33.87, 151.21), startMin: 720, baseVersion: null });
    await stop(page, t, "Bondi Beach", 780, 240);
    await open(page, t);
    // leaving at 12:00, first stop 13:00 until 17:00: lunch first, dinner after
    await page.waitFor(`document.querySelectorAll('[data-meal-gap]').length === 2`, 5000);
    expect(await page.eval(`[...document.querySelectorAll('[data-meal-gap]')].map(x => x.dataset.mealGap)`)).toEqual(["lunch:before", "dinner:after"]);
    // in the order of the day: start, lunch, Bondi, dinner
    expect(await page.eval(`[...document.querySelectorAll('.timeline > li')].filter(x => x.matches('.stop, .meal-gap')).map(x => x.dataset.mealGap ?? x.querySelector('h3').textContent)`)).toEqual(["Hotel", "lunch:before", "Bondi Beach", "dinner:after"]);
    expect(await page.eval(`document.querySelector('[data-meal-gap="lunch:before"] strong').textContent`)).toBe("Lunch before setting out?");
    // planned: it goes
    await stop(page, t, "Cafe", 725, 30, { kind: "food", meal: "lunch" });
    await page.waitFor(`document.querySelectorAll('[data-meal-gap]').length === 1`, 5000);
    expect(await page.eval(`document.querySelector('[data-meal-gap]').dataset.mealGap`)).toBe("dinner:after");
    expect(await page.eval(`document.documentElement.scrollWidth <= innerWidth`)).toBe(true);
  }, 30_000);
});
