import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { chromePath, inPage, launch, signUpIn, sleep } from "./browser.ts";
import { uniqueName } from "./helpers.ts";

// My Trips under live updates. The account's own stream (watchInvitations)
// tells the page when its invitations or trips may have changed, and the
// page asks again. An answer that changes nothing must not rebuild what
// someone is pressing: a click is a press and a release on the same
// element, so a list rebuilt in between loses it (seen on CI, where the
// refresh after the stream opened landed mid-tap on "Plan your first trip").
const baseUrl = inject("baseUrl");
let browser: NonNullable<Awaited<ReturnType<typeof launch>>>;
beforeAll(async () => {
  if (chromePath) browser = (await launch())!;
});
afterAll(() => browser?.close());

type P = Parameters<typeof inPage>[0];
const newTrip = (p: P, title: string) => inPage(p, "POST", "/api/trips", { title, destination: "Sydney", startDate: "2026-12-01", endDate: "2026-12-01", timezone: "Australia/Sydney" });

// Counts the page's refreshes of its lists (each answer to /api/trips or
// /api/invitations that reached it), so a test can wait for one to land.
const countRefreshes = `
  window.__answers = 0;
  const realFetch = window.fetch;
  window.fetch = (u, o) => {
    const p = realFetch(u, o);
    if (/\\/api\\/(trips|invitations)$/.test(String(u)) && (!o || !o.method || o.method === 'GET')) p.then(() => setTimeout(() => window.__answers++, 0), () => {});
    return p;
  };
`;

describe.skipIf(!chromePath)("My Trips under live updates", () => {
  it("a refresh that changes nothing, landing between press and release, doesn't lose the tap", async () => {
    const owner = await browser.newPage();
    const page = await browser.newPage();
    await page.viewport(390, 844, true);
    await signUpIn(owner, baseUrl, uniqueName("dashO"));
    const me = await signUpIn(page, baseUrl, uniqueName("dash"));
    const other = await newTrip(owner, "Not mine");
    await page.initScript(countRefreshes);
    await page.goto(new URL("/trips", baseUrl).href);
    await page.waitFor(`document.querySelector('[data-create="first"]')`, 8000);
    await sleep(600); // the stream is open and its first refresh is done
    const button = await page.eval(`window.__btn = document.querySelector('[data-create="first"]'), true`);
    expect(button).toBe(true);
    // press; while the button is down an invitation is sent and cancelled,
    // two real live updates that end where they started; release once the
    // page's refreshes for them have landed
    await page.tapAround('[data-create="first"]', async () => {
      const before = await page.eval<number>(`window.__answers`);
      const sent = await inPage(owner, "POST", `/api/trips/${other.id}/invitations`, { userId: me.id });
      await inPage(owner, "DELETE", `/api/trips/${other.id}/invitations/${sent.invitation.id}`);
      await page.waitFor(`window.__answers >= ${before} + 3`, 5000); // invitations and trips at least, after both events
      await sleep(100);
    });
    await page.waitFor(`document.querySelector('dialog[open] input[name=destination]')`, 3000);
    expect(await page.eval(`document.querySelector('dialog[open] input[name=destination]').value`)).toBe("");
    // the same button: the unchanged answers didn't rebuild it
    expect(await page.eval(`window.__btn === document.querySelector('[data-create="first"]') && window.__btn.isConnected`)).toBe(true);
    expect((await inPage(page, "GET", "/api/trips")).owned).toHaveLength(0);
  }, 40_000);

  it("keeps focus on a card's link through a refresh that changes nothing", async () => {
    const owner = await browser.newPage();
    const page = await browser.newPage();
    await page.viewport(1440, 900);
    await signUpIn(owner, baseUrl, uniqueName("dashO"));
    const me = await signUpIn(page, baseUrl, uniqueName("dashF"));
    await newTrip(page, "Mine");
    const other = await newTrip(owner, "Theirs");
    await page.initScript(countRefreshes);
    await page.goto(new URL("/trips", baseUrl).href);
    await page.waitFor(`[...document.querySelectorAll('.trip-grid h3')].some(h => h.textContent === 'Mine')`, 8000);
    await sleep(600);
    await page.eval(`document.querySelector('.trip-grid a').focus()`);
    const before = await page.eval<number>(`window.__answers`);
    const sent = await inPage(owner, "POST", `/api/trips/${other.id}/invitations`, { userId: me.id });
    await inPage(owner, "DELETE", `/api/trips/${other.id}/invitations/${sent.invitation.id}`);
    await page.waitFor(`window.__answers >= ${before} + 3`, 5000);
    await sleep(100);
    expect(await page.eval(`document.activeElement?.closest?.('.trip-grid') !== null && document.activeElement.tagName === 'A'`)).toBe(true);
  }, 40_000);

  it("keeps focus on an invitation's Accept while another part of the page changes", async () => {
    const owner = await browser.newPage();
    const joiner = await browser.newPage();
    const page = await browser.newPage();
    await page.viewport(1440, 900);
    await signUpIn(owner, baseUrl, uniqueName("dashO"));
    await signUpIn(joiner, baseUrl, uniqueName("dashJ"));
    const me = await signUpIn(page, baseUrl, uniqueName("dashI"));
    const waiting = await newTrip(owner, "Waiting");
    await inPage(owner, "POST", `/api/trips/${waiting.id}/invitations`, { userId: me.id });
    const mine = await newTrip(page, "Mine");
    const link = await inPage(page, "POST", `/api/trips/${mine.id}/invite`, {});
    await page.initScript(countRefreshes);
    await page.goto(new URL("/trips", baseUrl).href);
    await page.waitFor(`document.querySelector('[data-invite=accept]')`, 8000);
    await sleep(600);
    await page.eval(`window.__acc = document.querySelector('[data-invite=accept]'); window.__acc.focus()`);
    // someone asks to join this person's trip: the requests box changes, the invitations don't
    const before = await page.eval<number>(`window.__answers`);
    await inPage(joiner, "POST", `/api/invites/${link.token}/request`, {});
    await page.waitFor(`document.querySelector('[data-dash=requests]:not([hidden])') && window.__answers >= ${before} + 2`, 5000);
    await sleep(100);
    expect(await page.eval(`document.activeElement === window.__acc && window.__acc.isConnected`)).toBe(true);
    // and Enter still answers it
    await page.key("Enter");
    await page.waitFor(`!document.querySelector('[data-invite=accept]')`, 5000);
    expect((await inPage(page, "GET", "/api/invitations")).invitations).toHaveLength(0);
  }, 40_000);

  it("still shows real changes at once: a new trip, an invitation and its acceptance", async () => {
    const owner = await browser.newPage();
    const page = await browser.newPage();
    await page.viewport(1440, 900);
    await signUpIn(owner, baseUrl, uniqueName("dashO"));
    const me = await signUpIn(page, baseUrl, uniqueName("dashR"));
    await page.goto(new URL("/trips", baseUrl).href);
    await page.waitFor(`document.querySelector('[data-create="first"]')`, 8000);
    await sleep(600);
    const titles = `[...document.querySelectorAll('.dash-section .trip-grid h3')].map(h => h.textContent).sort()`;
    // a trip made in another tab (the same account): the page hears of it
    // when the stream next speaks; an invitation is that next word here
    await newTrip(page, "Made elsewhere");
    const shared = await newTrip(owner, "Shared trip");
    const sent = await inPage(owner, "POST", `/api/trips/${shared.id}/invitations`, { userId: me.id });
    await page.waitFor(`[...document.querySelectorAll('[data-invitation] h3')].some(h => h.textContent === 'Shared trip')`, 5000);
    await page.waitFor(`${titles}.includes('Made elsewhere')`, 5000);
    expect(await page.eval(`document.querySelector('[data-create="first"]')`)).toBe(null);
    // accepted: the invitation goes and the trip is under "Shared with you"
    await inPage(page, "POST", `/api/invitations/${sent.invitation.id}/accept`);
    await page.waitFor(`!document.querySelector('[data-invitation]') && ${titles}.includes('Shared trip')`, 5000);
    expect(await page.eval(titles)).toEqual(["Made elsewhere", "Shared trip"]);
  }, 40_000);

  it("an older answer to the trips list, arriving last, doesn't put back what a newer one changed", async () => {
    const owner = await browser.newPage();
    const page = await browser.newPage();
    await page.viewport(1440, 900);
    await signUpIn(owner, baseUrl, uniqueName("dashO"));
    const me = await signUpIn(page, baseUrl, uniqueName("dashS"));
    const shared = await newTrip(owner, "Shared later");
    // each /api/trips answer is held, tagged with how many trips it lists
    await page.initScript(`
      window.__held = [];
      const realFetch = window.fetch;
      window.fetch = (u, o) => {
        if (/\\/api\\/trips$/.test(String(u)) && (!o || !o.method || o.method === 'GET') && window.__hold) {
          return realFetch(u, o).then(async (res) => { const d = await res.clone().json(); return new Promise((go) => window.__held.push({ n: d.owned.length + d.shared.length, go: () => go(res) })); });
        }
        return realFetch(u, o);
      };
      window.__let = (n) => { for (const h of window.__held.filter((x) => x.n === n)) { window.__held.splice(window.__held.indexOf(h), 1); h.go(); } };
    `);
    await page.goto(new URL("/trips", baseUrl).href);
    await page.waitFor(`document.querySelector('[data-create="first"]')`, 8000);
    await sleep(600);
    await page.eval(`window.__hold = true`);
    // an invitation: the page asks for its trips (none yet)
    const sent = await inPage(owner, "POST", `/api/trips/${shared.id}/invitations`, { userId: me.id });
    await page.waitFor(`window.__held.some((x) => x.n === 0)`, 5000);
    // accepted elsewhere: it asks again (one trip now)
    await inPage(page, "POST", `/api/invitations/${sent.invitation.id}/accept`);
    await page.waitFor(`window.__held.some((x) => x.n === 1)`, 5000);
    // the newer answer lands first, then the older one
    await page.eval(`window.__let(1)`);
    await page.waitFor(`[...document.querySelectorAll('.trip-grid h3')].some(h => h.textContent === 'Shared later')`, 5000);
    await page.eval(`window.__let(0)`);
    await sleep(500);
    expect(await page.eval(`[...document.querySelectorAll('.trip-grid h3')].map(h => h.textContent)`)).toEqual(["Shared later"]);
  }, 40_000);

  it("catches up after losing the connection: what changed while offline appears once it's back", async () => {
    const owner = await browser.newPage();
    const page = await browser.newPage();
    await page.viewport(390, 844, true);
    await signUpIn(owner, baseUrl, uniqueName("dashO"));
    const me = await signUpIn(page, baseUrl, uniqueName("dashN"));
    await page.goto(new URL("/trips", baseUrl).href);
    await page.waitFor(`document.querySelector('[data-create="first"]')`, 8000);
    await sleep(600);
    await page.offline(true);
    await sleep(300);
    // while it's offline: invited to a trip
    const shared = await newTrip(owner, "While offline");
    const sent = await inPage(owner, "POST", `/api/trips/${shared.id}/invitations`, { userId: me.id });
    await page.offline(false);
    // the stream reconnects (its retry is 4 s) and the page asks again
    await page.waitFor(`[...document.querySelectorAll('[data-invitation] h3')].some(h => h.textContent === 'While offline')`, 12000);
    // and the live list keeps working after it: accepted, it moves to "Shared with you"
    await inPage(page, "POST", `/api/invitations/${sent.invitation.id}/accept`);
    await page.waitFor(`!document.querySelector('[data-invitation]') && [...document.querySelectorAll('.dash-section .trip-grid h3')].some(h => h.textContent === 'While offline')`, 5000);
  }, 40_000);
});
