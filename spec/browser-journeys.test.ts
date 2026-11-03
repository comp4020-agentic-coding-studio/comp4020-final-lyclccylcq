import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { chromePath, inPage, launch, signUpIn } from "./browser.ts";
import { uniqueName } from "./helpers.ts";

// Saving, publishing a journey, reading it through its link, and the
// profile, end to end in real Chrome (each page is its own browser context,
// so its own cookies).
const baseUrl = inject("baseUrl");
let browser: NonNullable<Awaited<ReturnType<typeof launch>>>;
beforeAll(async () => {
  if (chromePath) browser = (await launch())!;
});
afterAll(() => browser?.close());

const newTrip = (title: string) => ({ title, destination: "Sydney", startDate: "2026-12-01", endDate: "2026-12-02", timezone: "Australia/Sydney" });
const addStop = (tripId: string, dayId: string, title: string, startMin: number) =>
  ["POST", `/api/trips/${tripId}/activities`, { clientId: `${title}-${Math.random()}`, dayId, title, kind: "attraction", startMin, durationMin: 60 }] as const;

describe.skipIf(!chromePath)("journeys: save, publish, share and the profile", () => {
  it("saves a trip to the account, publishes a link-only journey, keeps it stable until updated, and revokes it", async () => {
    const owner = await browser.newPage();
    await owner.viewport(1440, 900);
    const name = uniqueName("jy");
    await signUpIn(owner, baseUrl, name);
    const trip = await inPage(owner, "POST", "/api/trips", newTrip("Harbour weekend"));
    await inPage(owner, ...addStop(trip.id, trip.days[0].id, "Opera House", 600));

    // the editor says it's saved; an edit in it shows saving then saved
    await owner.goto(new URL(`/trips/${trip.id}`, baseUrl).href);
    await owner.waitFor(`document.querySelector('[data-save="live"]')?.textContent === 'Saved'`, 8000);
    // a change that can't reach the server says so, and leaving would warn
    await owner.offline(true);
    await owner.eval(`fetch && import('/ui.js').then(m => m.api('/api/trips/${trip.id}/activities', { method: 'POST', body: { clientId: 'offline-1', dayId: '${trip.days[0].id}', title: 'Lost?', kind: 'food' } })).catch(() => {})`);
    await owner.waitFor(`document.querySelector('[data-save="failed"]')?.textContent === 'Not saved'`, 8000);
    await owner.offline(false);
    await inPage(owner, ...addStop(trip.id, trip.days[0].id, "Retry", 700)); // through the page's own fetch: not the editor's
    await owner.eval(`import('/ui.js').then(m => m.api('/api/trips/${trip.id}/activities', { method: 'POST', body: { clientId: 'offline-1', dayId: '${trip.days[0].id}', title: 'Lost?', kind: 'food' } }))`);
    await owner.waitFor(`document.querySelector('[data-save]')?.textContent === 'Saved'`, 8000);

    // saved to the account: a fresh session (another device) sees the same trip
    const again = await browser.newPage();
    await again.goto(new URL("/readme/", baseUrl).href);
    await again.eval(`fetch('/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: ${JSON.stringify(name)}, password: 'correct horse battery' }) })`);
    const seen = await inPage(again, "GET", `/api/trips/${trip.id}`);
    expect(seen.days[0].activities.map((a: any) => a.title)).toContain("Opera House");

    // publish from the editor: link only by default, with its link to copy
    await owner.eval(`document.querySelector('[data-publish="none"]').click()`);
    await owner.waitFor(`document.querySelector('dialog[open] input[name=visibility][value=link]')?.checked`);
    await owner.eval(`(() => { const f = document.querySelector('dialog[open] form'); f.description.value = 'Two easy days by the water.'; f.requestSubmit(); })()`);
    await owner.waitFor(`/\\/journeys\\/pub-/.test(document.querySelector('dialog[open] .pub-link input')?.value ?? '')`, 8000);
    const link = await owner.eval<string>(`document.querySelector('dialog[open] .pub-link input').value`);
    const pubId = link.split("/journeys/")[1];
    // link only: not in the homepage's listed trips
    const listed = await inPage(owner, "GET", "/api/publications");
    expect(listed.publications.some((p: any) => p.id === pubId)).toBe(false);

    // anyone with the link reads it, signed out, and can't edit anything
    const reader = await browser.newPage();
    await reader.viewport(390, 844, true);
    await reader.goto(link);
    await reader.waitFor(`document.querySelector('.jy-title')?.textContent === 'Harbour weekend'`, 8000);
    const page = await reader.eval<string>(`document.querySelector('main.journey').textContent`);
    expect(page).toContain("Opera House");
    expect(page).toContain(name); // the author's display name
    expect(page).toContain("Two easy days by the water.");
    expect(await reader.eval(`document.querySelectorAll('main.journey input, main.journey textarea, main.journey [contenteditable], .jy-owner').length`)).toBe(0);
    expect(await reader.eval(`document.documentElement.scrollWidth <= innerWidth`)).toBe(true);
    // its id opens nothing writable: the trip itself stays private
    expect((await inPage(reader, "GET", `/api/trips/${trip.id}`)).error).toBeTruthy();

    // editing the trip doesn't change the journey until the owner updates it
    await inPage(owner, ...addStop(trip.id, trip.days[0].id, "Bondi walk", 840));
    expect((await inPage(reader, "GET", `/api/itineraries/${pubId}`)).stops.map((s: any) => s.title)).not.toContain("Bondi walk");
    await inPage(owner, "PUT", `/api/trips/${trip.id}/publication`, { description: "Two easy days by the water." });
    await reader.goto(link);
    await reader.waitFor(`document.querySelector('main.journey')?.textContent.includes('Bondi walk')`, 8000);

    // revoked from the profile: the link stops showing it, the trip stays
    await owner.goto(new URL("/profile#published", baseUrl).href);
    await owner.waitFor(`document.querySelector('[data-pub="${pubId}"] [data-pub-action="unpublish"]')`);
    await owner.eval(`document.querySelector('[data-pub="${pubId}"] [data-pub-action="unpublish"]').click()`);
    await owner.eval(`document.querySelector('dialog[open] [data-confirm="unpublish"]').click()`);
    await owner.waitFor(`document.querySelector('[data-pub="${pubId}"] [data-pub-action="republish"]')`, 8000);
    await reader.goto(link);
    await reader.waitFor(`/isn't available/.test(document.querySelector('main')?.textContent ?? '')`, 8000);
    expect((await inPage(reader, "GET", `/api/itineraries/${pubId}`)).error).toBeTruthy();
    expect((await inPage(owner, "GET", `/api/trips/${trip.id}`)).days[0].activities.length).toBe(4);
  }, 60_000);

  it("keeps a private trip private, and publishing grants nobody edit rights", async () => {
    const owner = await browser.newPage();
    await signUpIn(owner, baseUrl, uniqueName("jo"));
    const trip = await inPage(owner, "POST", "/api/trips", newTrip("Secret plans"));
    await inPage(owner, ...addStop(trip.id, trip.days[0].id, "Hidden cove", 600));
    const other = await browser.newPage();
    await signUpIn(other, baseUrl, uniqueName("jx"));
    // another account, by URL or API: the same 404 as a missing trip
    await other.goto(new URL(`/trips/${trip.id}`, baseUrl).href);
    await other.waitFor(`/doesn't exist, or you don't have access/.test(document.querySelector('main')?.textContent ?? '')`, 8000);
    expect((await inPage(other, "GET", `/api/trips/${trip.id}`)).error).toBe("Trip not found.");
    expect((await inPage(other, "GET", `/api/trips/${trip.id}/publication`)).error).toBeTruthy();
    // published: still no way in, and only the owner can publish or revoke
    const pub = await inPage(owner, "PUT", `/api/trips/${trip.id}/publication`, { description: "Cove day." });
    expect((await inPage(other, "GET", `/api/itineraries/${pub.publication.id}`)).title).toBe("Secret plans");
    expect((await inPage(other, "POST", `/api/trips/${trip.id}/activities`, { clientId: "x1", dayId: trip.days[0].id, title: "Mine", kind: "food" })).error).toBeTruthy();
    expect((await inPage(other, "DELETE", `/api/trips/${trip.id}/publication`)).error).toBeTruthy();
    expect((await inPage(other, "PUT", `/api/trips/${trip.id}/publication`, { description: "hijack" })).error).toBeTruthy();
    expect((await inPage(owner, "GET", `/api/trips/${trip.id}`)).members.length).toBe(1);
  }, 30_000);

  it("exports an unpublished trip for its members only, notes included", async () => {
    const owner = await browser.newPage();
    await owner.viewport(1280, 900);
    await signUpIn(owner, baseUrl, uniqueName("ex"));
    const trip = await inPage(owner, "POST", "/api/trips", newTrip("Print me"));
    const { activityId, trip: added } = await inPage(owner, ...addStop(trip.id, trip.days[0].id, "Ferry to Manly", 600));
    const a = added.days[0].activities.find((x: any) => x.id === activityId);
    await inPage(owner, "PATCH", `/api/trips/${trip.id}/activities/${activityId}`, { notes: "Wharf 3, buy an Opal card first.", baseVersion: a.version });

    // from the editor, with nothing published
    await owner.goto(new URL(`/trips/${trip.id}`, baseUrl).href);
    await owner.waitFor(`document.querySelector('[data-export="print"]')`, 8000);
    await owner.eval(`document.querySelector('[data-export="print"]').click()`);
    await owner.waitFor(`location.pathname.endsWith('/print') && document.querySelector('.tp-title')?.textContent === 'Print me'`, 8000);
    const doc = await owner.eval<string>(`document.querySelector('.tp-doc').textContent`);
    expect(doc).toContain("Ferry to Manly");
    expect(doc).toContain("Wharf 3, buy an Opal card first."); // the members' own copy keeps notes
    expect(await owner.eval(`document.querySelectorAll('[data-print="go"]').length`)).toBe(1);
    expect((await inPage(owner, "GET", `/api/trips/${trip.id}/publication`)).publication ?? null).toBeNull();

    // an image: a PNG of the document, made in the browser
    await owner.eval(`(() => { window.__png = null; const o = HTMLAnchorElement.prototype.click; HTMLAnchorElement.prototype.click = function () { if (this.download) { fetch(this.href).then(r => r.blob()).then(b => window.__png = { type: b.type, size: b.size, name: this.download }); return; } return o.call(this); }; })()`);
    await owner.eval(`document.querySelector('[data-export="image"]').click()`);
    await owner.waitFor(`window.__png`, 10_000);
    const png = await owner.eval<{ type: string; size: number; name: string }>(`window.__png`);
    expect(png).toMatchObject({ type: "image/png", name: "print-me.png" });
    expect(png.size).toBeGreaterThan(5000);

    // anyone else gets the same answer as a missing trip
    const other = await browser.newPage();
    await signUpIn(other, baseUrl, uniqueName("ey"));
    await other.goto(new URL(`/trips/${trip.id}/print`, baseUrl).href);
    await other.waitFor(`/doesn't exist, or you don't have access/.test(document.querySelector('main')?.textContent ?? '')`, 8000);
    expect(await other.eval<string>(`document.body.textContent`)).not.toContain("Opal card");
    expect((await inPage(other, "POST", `/api/trips/${trip.id}/export-link`, {})).error).toBe("Trip not found.");

    // a read-only link: made by a member, opened signed out, the same plan, nothing to change
    await owner.eval(`document.querySelector('[data-export-link="make"]').click()`);
    await owner.waitFor(`/\\/export\\//.test(document.querySelector('.tp-link input')?.value ?? '')`, 8000);
    const link = await owner.eval<string>(`document.querySelector('.tp-link input').value`);
    const reader = await browser.newPage();
    await reader.viewport(390, 844, true);
    await reader.goto(link);
    await reader.waitFor(`document.querySelector('.tp-title')?.textContent === 'Print me'`, 8000);
    expect(await reader.eval<string>(`document.querySelector('.tp-doc').textContent`)).toContain("Wharf 3, buy an Opal card first.");
    expect(await reader.eval(`document.querySelectorAll('main input, main textarea, [contenteditable], [data-export-link], a[href^="/trips/"]').length`)).toBe(0);
    expect(await reader.eval(`document.querySelectorAll('[data-print="go"], [data-export="image"]').length`)).toBe(2);
    expect(await reader.eval(`document.documentElement.scrollWidth <= innerWidth`)).toBe(true);
    // the plan changes: the link shows it as it stands now
    await inPage(owner, ...addStop(trip.id, trip.days[0].id, "Manly Corso", 720));
    await reader.goto(link);
    await reader.waitFor(`document.querySelector('.tp-doc')?.textContent.includes('Manly Corso')`, 8000);
    // the trip itself stays closed to them, and switching the link off ends it
    expect((await inPage(reader, "GET", `/api/trips/${trip.id}`)).error).toBeTruthy();
    await owner.eval(`document.querySelector('[data-export-link="revoke"]').click()`);
    await owner.waitFor(`!document.querySelector('[data-export-link="revoke"]')`, 8000);
    await reader.goto(link);
    await reader.waitFor(`/isn't available/.test(document.querySelector('main')?.textContent ?? '')`, 8000);
  }, 40_000);

  it("shows the account as stored, edits it, and lists created, shared and published journeys", async () => {
    const page = await browser.newPage();
    await page.viewport(1280, 900);
    const name = uniqueName("pf");
    const me = await signUpIn(page, baseUrl, name);
    const mine = await inPage(page, "POST", "/api/trips", newTrip("My own trip"));
    await inPage(page, ...addStop(mine.id, mine.days[0].id, "Museum", 600));
    await inPage(page, "PUT", `/api/trips/${mine.id}/publication`, { description: "A museum day.", visibility: "listed" });
    // someone else's trip, shared with this account by invitation
    const friend = await browser.newPage();
    await signUpIn(friend, baseUrl, uniqueName("pg"));
    const theirs = await inPage(friend, "POST", "/api/trips", newTrip("Friend's trip"));
    const inv = await inPage(friend, "POST", `/api/trips/${theirs.id}/invitations`, { userId: me.id });
    await inPage(page, "POST", `/api/invitations/${inv.invitation?.id ?? inv.id}/accept`, {});

    // the header's avatar and name lead to the profile
    await page.goto(new URL("/", baseUrl).href);
    await page.waitFor(`document.querySelector('.topbar .me-link')`);
    await page.eval(`document.querySelector('.topbar .me-link').click()`);
    await page.waitFor(`location.pathname === '/profile' && document.querySelector('.pf-name')`);
    expect(await page.eval<string>(`document.querySelector('.pf-name').textContent`)).toBe(name);
    expect(await page.eval<string>(`document.querySelector('.pf-handle').textContent`)).toContain(`@${name}`);
    expect(await page.eval<string>(`document.querySelector('.pf-bio').textContent`)).toBe("No bio yet.");

    // edit: display name and bio, saved to the account and shown in the bar
    await page.eval(`document.querySelector('[data-profile="edit"]').click()`);
    await page.eval(`(() => { const f = document.querySelector('.pf-edit'); f.displayName.value = ${JSON.stringify(`${name} T`)}; f.bio.value = 'Slow mornings, long walks.'; f.requestSubmit(); })()`);
    await page.waitFor(`document.querySelector('.pf-name')?.textContent === ${JSON.stringify(`${name} T`)} && document.querySelector('.topbar .me-name')?.textContent === ${JSON.stringify(`${name} T`)}`, 6000);
    const stored = await inPage(page, "GET", "/api/me/profile");
    expect(stored.profile).toMatchObject({ displayName: `${name} T`, bio: "Slow mornings, long walks.", username: name });
    expect(stored.profile.email).toBeUndefined();
    // a display name someone else has is refused
    const clash = await inPage(page, "PATCH", "/api/me/profile", { displayName: (await inPage(friend, "GET", "/api/me/profile")).profile.displayName });
    expect(clash.error).toMatch(/already taken/);

    // three lists, one record each
    const tab = async (k: string) => {
      await page.eval(`document.querySelector('[data-tab="${k}"]').click()`);
      return page.eval<string>(`document.querySelector('.pf-list').textContent`);
    };
    expect(await tab("created")).toContain("My own trip");
    expect(await page.eval<string>(`document.querySelector('.pf-list .pf-state').textContent`)).toMatch(/Published · listed/);
    expect(await tab("shared")).toContain("Friend's trip");
    const published = await tab("published");
    expect(published).toContain("My own trip");
    expect(published).not.toContain("Friend's trip");

    // signing out and back in keeps it all
    await page.eval(`fetch('/api/auth/logout', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })`);
    expect((await inPage(page, "GET", "/api/me/profile")).error).toBeTruthy();
    await page.eval(`fetch('/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: ${JSON.stringify(name)}, password: 'correct horse battery' }) })`);
    expect((await inPage(page, "GET", "/api/me/profile")).profile.bio).toBe("Slow mornings, long walks.");
  }, 40_000);
});
