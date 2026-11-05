import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { chromePath, inPage, launch, signUpIn } from "./browser.ts";
import { startApp, uniqueName } from "./helpers.ts";

// A new stop's suggested arrival counts the travel from the stop before it,
// from Google's route (November 2026): the previous stop's end plus the
// duration Google returns, labelled approximate, and nothing estimated when
// there's no answer. MOCKED Google Maps Platform: a private copy of the app
// talks to a local stand-in whose route durations differ by mode, so the
// mode used shows. Not evidence the live integration works.

const KEY = "mock-server-key-never-in-responses";
const seenRoutes: any[] = [];
// seconds per mode; DRIVE answers no route
const DURATION: Record<string, number> = { WALK: 1500, TRANSIT: 840 };
let mock: ReturnType<typeof createServer>;
let app: Awaited<ReturnType<typeof startApp>>;
let browser: Awaited<ReturnType<typeof launch>>;

beforeAll(async () => {
  mock = createServer(async (req, res) => {
    let raw = "";
    for await (const c of req) raw += c;
    const body = raw ? JSON.parse(raw) : {};
    const url = new URL(req.url ?? "/", "http://x");
    const send = (data: unknown) => {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify(data));
    };
    if (url.pathname === "/v1/places:searchText") {
      return send({ places: [{ id: "ChIJ_mock_art_gallery_nsw", displayName: { text: "Art Gallery of NSW" }, formattedAddress: "Art Gallery Rd", location: { latitude: -33.8688, longitude: 151.2173 }, primaryTypeDisplayName: { text: "Art gallery" }, types: ["art_gallery", "museum"] }] });
    }
    if (url.pathname.startsWith("/v1/places/")) {
      return send({ id: url.pathname.split("/").pop(), displayName: { text: "Art Gallery of NSW" }, formattedAddress: "Art Gallery Rd", location: { latitude: -33.8688, longitude: 151.2173 }, types: ["art_gallery"] });
    }
    if (url.pathname === "/directions/v2:computeRoutes") {
      seenRoutes.push(body);
      const sec = DURATION[body.travelMode];
      if (!sec) return send({});
      return send({ routes: [{ duration: `${sec}s`, distanceMeters: 1800, polyline: { encodedPolyline: "_p~iF~ps|U_ulLnnqC_mqNvxq`@" } }] });
    }
    if (url.pathname === "/maps/api/geocode/json") return send({ status: "OK", results: [] });
    res.writeHead(404);
    res.end("{}");
  });
  await new Promise<void>((r) => mock.listen(0, "127.0.0.1", r));
  const m = `http://127.0.0.1:${(mock.address() as AddressInfo).port}`;
  app = await startApp({ GOOGLE_MAPS_SERVER_KEY: KEY, GOOGLE_PLACES_BASE_URL: m, GOOGLE_ROUTES_BASE_URL: m, GOOGLE_GEOCODE_BASE_URL: m });
  if (chromePath) browser = await launch();
}, 60_000);

afterAll(async () => {
  browser?.close();
  await app?.stop();
  mock?.close();
});

describe.skipIf(!chromePath)("a new stop's suggested arrival", () => {
  const openCard = async (tripTransport: string | null) => {
    const page = await browser!.newPage();
    await page.viewport(1440, 900);
    await signUpIn(page, app.url, uniqueName("trv"));
    const trip = await inPage(page, "POST", "/api/trips", { title: "Travel trip", destination: "Sydney", startDate: "2026-12-01", endDate: "2026-12-01", timezone: "Australia/Sydney" });
    // the stop before: a Google place, 09:00 for 2 h (ends 11:00)
    await inPage(page, "POST", `/api/trips/${trip.id}/activities`, { clientId: `zoo-${Math.random()}`, dayId: trip.days[0].id, title: "Taronga Zoo", kind: "attraction", startMin: 540, durationMin: 120, place: { placeId: "ChIJ_mock_taronga_zoo_x", source: "google", lat: -33.8435, lng: 151.2413 } });
    if (tripTransport) await inPage(page, "PUT", `/api/trips/${trip.id}/preferences`, { transport: tripTransport });
    await page.goto(new URL(`/trips/${trip.id}`, app.url).href);
    await page.waitFor(`document.querySelector('.conn-live')`, 8000);
    await page.eval(`document.querySelector('.search input').value = 'gallery'; document.querySelector('.search').requestSubmit()`);
    await page.waitFor(`document.querySelector('.result')`, 8000);
    await page.click(".result");
    await page.waitFor(`document.querySelector('.place-card .add-to-trip')`, 8000);
    await page.click(".place-card .add-to-trip");
    await page.waitFor(`document.querySelector('dialog[open].schedule-card')`);
    return { page, trip };
  };
  const hint = `document.querySelector('dialog[open] .schedule-hint')`;

  it("adds Google's travel time from the stop before, by the quickest of walking and transit, and says it's approximate", async () => {
    seenRoutes.length = 0;
    const { page, trip } = await openCard(null);
    await page.waitFor(`${hint}.dataset.travel === 'ok'`, 8000);
    // 11:00 + 14 min by transit (quicker than the 25 min walk) = 11:14, rounded up to 11:15
    expect(await page.eval(`document.querySelector('dialog[open].schedule-card form').start.value`)).toBe("11:15");
    const text = await page.eval<string>(`${hint}.textContent`);
    expect(text).toContain("Taronga Zoo ends at 11:00");
    expect(text).toContain("14 min by public transport");
    expect(text).toMatch(/Approximate/);
    // what was asked: from the stop before to this place, departing when it ends, one request per mode
    const transit = seenRoutes.find((b) => b.travelMode === "TRANSIT");
    expect(transit.origin).toEqual({ placeId: "ChIJ_mock_taronga_zoo_x" });
    expect(transit.destination).toEqual({ placeId: "ChIJ_mock_art_gallery_nsw" });
    expect(transit.departureTime).toBe("2026-12-01T00:00:00.000Z"); // 11:00 in Sydney (AEDT, UTC+11)
    expect(new Set(seenRoutes.map((b) => b.travelMode))).toEqual(new Set(["WALK", "TRANSIT", "DRIVE"]));
    // the suggestion is what's saved, unless changed
    await page.eval(`document.querySelector('dialog[open].schedule-card form').requestSubmit()`);
    await page.waitFor(`!document.querySelector('dialog[open]')`, 5000);
    const day = (await inPage(page, "GET", `/api/trips/${trip.id}`)).days[0];
    expect(day.activities.map((a: any) => [a.title, a.startMin])).toEqual([["Taronga Zoo", 540], ["Art Gallery of NSW", 675]]);
  });

  it("uses the trip's own transport choice, and never replaces a time the person typed", async () => {
    const { page } = await openCard("walk");
    await page.waitFor(`${hint}.dataset.travel === 'ok'`, 8000);
    // walking 25 min: 11:25
    expect(await page.eval(`document.querySelector('dialog[open].schedule-card form').start.value`)).toBe("11:25");
    expect(await page.eval<string>(`${hint}.textContent`)).toContain("25 min on foot");
    // another day and back: looked up again; a typed time then stays
    await page.eval(`(() => { const s = document.querySelector('dialog[open].schedule-card form').start; s.value = '12:30'; s.dispatchEvent(new Event('input')); })()`);
    await new Promise((r) => setTimeout(r, 400));
    expect(await page.eval(`document.querySelector('dialog[open].schedule-card form').start.value`)).toBe("12:30");
  });

  it("says plainly when there's no travel time to add, and estimates none", async () => {
    const page = await browser!.newPage();
    await page.viewport(1440, 900);
    await signUpIn(page, app.url, uniqueName("trv"));
    const trip = await inPage(page, "POST", "/api/trips", { title: "No route trip", destination: "Sydney", startDate: "2026-12-01", endDate: "2026-12-01", timezone: "Australia/Sydney" });
    // the stop before has no place on the map: nothing to route from
    await inPage(page, "POST", `/api/trips/${trip.id}/activities`, { clientId: `x-${Math.random()}`, dayId: trip.days[0].id, title: "Breakfast", kind: "food", startMin: 480, durationMin: 60 });
    await page.goto(new URL(`/trips/${trip.id}`, app.url).href);
    await page.waitFor(`document.querySelector('.conn-live')`, 8000);
    await page.eval(`document.querySelector('.search input').value = 'gallery'; document.querySelector('.search').requestSubmit()`);
    await page.waitFor(`document.querySelector('.result')`, 8000);
    await page.click(".result");
    await page.waitFor(`document.querySelector('.place-card .add-to-trip')`, 8000);
    await page.click(".place-card .add-to-trip");
    await page.waitFor(`document.querySelector('dialog[open].schedule-card .schedule-hint')?.dataset.travel === 'unroutable'`, 8000);
    expect(await page.eval(`document.querySelector('dialog[open].schedule-card form').start.value`)).toBe("09:00"); // when Breakfast ends
    expect(await page.eval<string>(`document.querySelector('dialog[open] .schedule-hint').textContent`)).toMatch(/Travel time isn't included: one of the two places can't be routed/);
  });
});
