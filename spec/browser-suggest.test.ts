import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { chromePath, launch, type Page } from "./browser.ts";
import { signUp, startApp } from "./helpers.ts";

// A restaurant suggestion opens its Google place in the editor's own place
// card, the same one a map click opens: no second click, nothing added. Runs a
// private app against a stand-in for Google Places and Routes, which counts
// detail requests. (No browser Maps key, so the editor draws its schematic:
// this checks the assistant, the place card and the requests, not Google's tiles.)

vi.setConfig({ testTimeout: 60_000, hookTimeout: 45_000 });

type Seen = { path: string };
const seen: Seen[] = [];
let google: Server;
let app: Awaited<ReturnType<typeof startApp>>;
let browser: Awaited<ReturnType<typeof launch>> | null = null;

const FOOD = [
  { id: "ChIJ_dinner_one_aaaaaa", name: "Dinner One", rating: 4.6, n: 1500 },
  { id: "ChIJ_dinner_two_bbbbbb", name: "Dinner Two", rating: 4.3, n: 900 },
  { id: "ChIJ_dinner_three_cccc", name: "Dinner Three", rating: 4.1, n: 300 },
];

beforeAll(async () => {
  google = createServer(async (req, res) => {
    let raw = "";
    for await (const c of req) raw += c;
    const url = new URL(req.url ?? "/", "http://x");
    seen.push({ path: url.pathname });
    res.writeHead(200, { "content-type": "application/json" });
    const body = raw ? JSON.parse(raw) : {};
    if (url.pathname.endsWith(":searchNearby")) {
      const c = body.locationRestriction.circle.center;
      return res.end(JSON.stringify({ places: FOOD.map((f, i) => ({ id: f.id, displayName: { text: f.name }, location: { latitude: c.latitude + (i + 1) * 0.0008, longitude: c.longitude }, primaryTypeDisplayName: { text: "Japanese Restaurant" }, types: ["restaurant"], rating: f.rating, userRatingCount: f.n })) }));
    }
    if (url.pathname.endsWith("computeRoutes")) return res.end(JSON.stringify({ routes: [{ duration: "600s", distanceMeters: 900 }] }));
    const m = url.pathname.match(/\/v1\/places\/(ChIJ_[A-Za-z_]+)$/);
    if (m) {
      const f = FOOD.find((x) => x.id === m[1]);
      return res.end(JSON.stringify({ id: m[1], displayName: { text: f?.name ?? "Place" }, formattedAddress: `${f?.name} Street, Tokyo`, location: { latitude: 35.66, longitude: 139.70 }, primaryTypeDisplayName: { text: "Japanese Restaurant" }, types: ["restaurant"], rating: f?.rating, userRatingCount: f?.n, regularOpeningHours: { weekdayDescriptions: ["Monday: 5:00 – 11:00 PM"] }, editorialSummary: { text: `${f?.name} serves ramen.` }, photos: [] }));
    }
    res.end("{}");
  });
  await new Promise<void>((r) => google.listen(0, "127.0.0.1", () => r()));
  const g = `http://127.0.0.1:${(google.address() as AddressInfo).port}`;
  app = await startApp({ GOOGLE_MAPS_SERVER_KEY: "mock-google-key", GOOGLE_PLACES_BASE_URL: g, GOOGLE_ROUTES_BASE_URL: g });
  if (chromePath) browser = await launch();
});

afterAll(async () => {
  await browser?.close();
  await app.stop();
  google.close();
});

// The Tokyo shape: lunch at 12:40, dinner missing between Shibuya and the night walk.
async function tokyoTrip() {
  const c = await signUp(app.url);
  await c.send("PUT", "/api/me/preferences", { food: { cuisines: ["japanese"] }, travel: {} });
  const trip = (await c.send("POST", "/api/trips", { title: "Tokyo", destination: "Tokyo", startDate: "2026-10-25", endDate: "2026-10-25", timezone: "Asia/Tokyo" })).data;
  const at = (lat: number, lng: number, n: number) => ({ placeId: `ChIJ_stop_${n}_xxxxxxxx`, source: "google", lat, lng });
  const stops = [["Senso-ji", 540, 90, 35.7148, 139.7967, "attraction"], ["Ramen lunch", 760, 60, 35.7101, 139.8107, "food"], ["Shibuya", 1020, 45, 35.6595, 139.7005, "attraction"], ["Shinjuku walk", 1200, 51, 35.6852, 139.7101, "attraction"]] as const;
  for (const [i, [title, start, dur, lat, lng, kind]] of stops.entries()) {
    await c.send("POST", `/api/trips/${trip.id}/activities`, { clientId: `sg-${i}-${title.replace(/\W/g, "")}`, dayId: trip.days[0].id, title, kind, startMin: start, durationMin: dur, place: at(lat, lng, i) });
  }
  return { c, trip };
}

async function openAssistantEat(page: Page, tripId: string, phone: boolean) {
  await page.goto(new URL(`/trips/${tripId}`, app.url).href);
  await page.waitFor(`document.querySelectorAll('.timeline .stop').length === 4`, 20000);
  if (phone) await page.eval(`[...document.querySelectorAll('.mobile-tabs button')].find(b => b.textContent.includes('Assistant')).click()`);
  else await page.eval(`[...document.querySelectorAll('.trip-bar button')].find(b => b.textContent.includes('Assistant')).click()`);
  await page.waitFor(`document.querySelector('[data-plan-action=eat]')`, 20000);
  await page.eval(`document.querySelector('[data-plan-action=eat]').click()`);
  await page.waitFor(`document.querySelectorAll('.pa-card').length === 3`, 20000);
}

const detailRequests = (id: string) => seen.filter((s) => s.path.endsWith(`/v1/places/${id}`)).length;

describe.skipIf(!chromePath)("a restaurant suggestion opens its place on the map", () => {
  it("opens the editor's place card from the card itself, switches between suggestions, and changes nothing", async () => {
    const { c, trip } = await tokyoTrip();
    const page = await browser!.newPage();
    await page.viewport(1920, 1080);
    await page.goto(new URL("/login", app.url).href);
    await page.eval(`document.cookie = ${JSON.stringify(c.cookie + "; path=/")}`);
    await openAssistantEat(page, trip.id, false);
    // no separate details dialog any more
    expect(await page.eval<number>(`[...document.querySelectorAll('.pa-card button')].filter(b => b.textContent === 'Details').length`)).toBe(0);

    const before = detailRequests(FOOD[0].id);
    // a click on the card itself (not a button) opens the place card
    await page.eval(`document.querySelector('.pa-card').click()`);
    await page.waitFor(`document.querySelector('.place-card h3, .place-card h2')?.textContent.includes('Dinner One')`, 20000);
    await page.waitFor(`document.querySelector('.place-card')?.textContent.includes('Dinner One Street')`, 20000); // Google's details arrived
    const card = await page.eval<string>(`document.querySelector('.place-card').textContent`);
    expect(card).toMatch(/4\.6/);
    expect(card).toMatch(/1,500|1500/);
    expect(await page.eval<number>(`document.querySelectorAll('.place-card .add-to-trip').length`)).toBe(1);
    expect(detailRequests(FOOD[0].id)).toBe(before + 1);
    // the assistant stays open beside it, with the opened card marked
    expect(await page.eval<number>(`document.querySelectorAll('.workspace.with-copilot .pa-card.open').length`)).toBe(1);

    // clicking the same card again makes no new request
    await page.eval(`document.querySelector('.pa-card').click()`);
    await new Promise((r) => setTimeout(r, 400));
    expect(detailRequests(FOOD[0].id)).toBe(before + 1);

    // another suggestion replaces it
    await page.eval(`document.querySelectorAll('.pa-card')[1].click()`);
    await page.waitFor(`document.querySelector('.place-card')?.textContent.includes('Dinner Two Street')`, 20000);
    expect(await page.eval(`document.querySelectorAll('.pa-card.open').length`)).toBe(1);

    // Preview inside the card doesn't open the place; it previews instead
    await page.eval(`[...document.querySelectorAll('.pa-card')[2].querySelectorAll('button')].find(b => b.textContent === 'Preview').click()`);
    await page.waitFor(`document.querySelector('.stop-proposed')`, 20000);
    expect(await page.eval<string>(`document.querySelector('.place-card')?.textContent ?? ''`)).not.toContain('Dinner Three');

    // nothing was added by any of this
    expect((await c.get(`/api/trips/${trip.id}`)).data.days[0].activities).toHaveLength(4);

    // Add to Itinerary on the place card still goes through the scheduling card
    await page.eval(`document.querySelectorAll('.pa-card')[0].click()`);
    // the button is disabled until Google's details arrive
    await page.waitFor(`document.querySelector('.place-card .add-to-trip:not(:disabled)')`, 20000);
    await page.eval(`document.querySelector('.place-card .add-to-trip').click()`);
    await page.waitFor(`document.querySelector('dialog[open].schedule-card')`, 20000);
    expect((await c.get(`/api/trips/${trip.id}`)).data.days[0].activities).toHaveLength(4); // not until Confirm
  });

  it("on a phone, switches to the map tab and opens the place there", async () => {
    const { c, trip } = await tokyoTrip();
    const page = await browser!.newPage();
    await page.viewport(390, 844, true);
    await page.goto(new URL("/login", app.url).href);
    await page.eval(`document.cookie = ${JSON.stringify(c.cookie + "; path=/")}`);
    await openAssistantEat(page, trip.id, true);
    await page.eval(`document.querySelectorAll('.pa-card')[1].click()`);
    await page.waitFor(`document.querySelector('.workspace').dataset.tab === 'map'`, 20000);
    await page.waitFor(`document.querySelector('.place-card')?.textContent.includes('Dinner Two Street')`, 20000);
    const r = await page.eval<any>(`(() => { const b = document.querySelector('.place-card').getBoundingClientRect(); return { visible: b.width > 0 && b.height > 0, overflow: document.documentElement.scrollWidth > innerWidth }; })()`);
    expect(r).toEqual({ visible: true, overflow: false });
    expect((await c.get(`/api/trips/${trip.id}`)).data.days[0].activities).toHaveLength(4);
  });
});
