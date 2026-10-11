#!/usr/bin/env node
// LIVE Google Maps Platform check. Unlike spec/ (which mocks Google), this
// sends real requests through a running Wayline (APP_URL, default
// http://localhost:8080) to Google, so it spends a little quota and needs
// the app started with real keys. It prints results, never key values.
//
//   pnpm dev            # with GOOGLE_MAPS_* in .env
//   pnpm check:google
import { chromePath, launch, sleep } from "../spec/browser.ts";

const base = process.env.APP_URL ?? "http://localhost:8080";
let failures = 0;
const ok = (label: string, detail = "") => console.log(`✓ ${label}${detail ? `  ${detail}` : ""}`);
const bad = (label: string, detail = "") => {
  failures++;
  console.log(`✗ ${label}${detail ? `  ${detail}` : ""}`);
};

async function get(path: string): Promise<{ status: number; data: any }> {
  const r = await fetch(new URL(path, base));
  return { status: r.status, data: await r.json().catch(() => null) };
}
async function post(path: string, body: unknown): Promise<{ status: number; data: any }> {
  const r = await fetch(new URL(path, base), { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  return { status: r.status, data: await r.json().catch(() => null) };
}

const config = (await get("/api/config")).data;
console.log(`App at ${base}: places=${config?.places}, routes=${config?.routes}, browser key ${config?.mapsBrowserKey ? "set" : "missing"}, map id ${config?.mapId}`);
if (config?.places !== "google") {
  console.log("\nGOOGLE_MAPS_SERVER_KEY isn't set in the running app, so nothing live can be checked. Put it in .env and restart pnpm dev.");
  process.exit(1);
}

// 1. destinations
const session = `live${Date.now()}`;
const destinations: Record<string, { lat: number; lng: number }> = {};
for (const q of ["Canberra", "Sydney", "Tokyo", "Hong Kong"]) {
  const ac = await get(`/api/places/autocomplete?q=${encodeURIComponent(q)}&kind=city&session=${session}${q.length}`);
  const first = ac.data?.suggestions?.[0];
  if (ac.status !== 200 || !first) {
    bad(`destination search "${q}"`, ac.data?.error ?? "no suggestions");
    continue;
  }
  const d = await get(`/api/places/${encodeURIComponent(first.placeId)}?view=basic&session=${session}${q.length}`);
  if (d.status === 200 && Number.isFinite(d.data.lat)) {
    destinations[q] = d.data;
    ok(`destination search "${q}"`, `→ ${first.main}${first.secondary ? `, ${first.secondary}` : ""} (${d.data.lat.toFixed(3)}, ${d.data.lng.toFixed(3)}) id ${first.placeId.slice(0, 8)}…`);
  } else bad(`destination details "${q}"`, d.data?.error);
}

// 2. text search for two real places
const find = async (q: string) => {
  const r = await get(`/api/places/search?q=${encodeURIComponent(q)}`);
  const p = r.data?.places?.[0];
  if (r.status === 200 && p?.source === "google") ok(`place search "${q}"`, `→ ${p.name} (${p.lat.toFixed(4)}, ${p.lng.toFixed(4)})`);
  else bad(`place search "${q}"`, r.data?.error ?? "no result");
  return p;
};
const zoo = await find("Taronga Zoo Sydney");
const opera = await find("Sydney Opera House");

// 3. nearby attractions and restaurants
const sydney = destinations.Sydney ?? { lat: -33.8688, lng: 151.2093 };
for (const type of ["tourist_attraction", "restaurant", "museum", "cafe"]) {
  const r = await get(`/api/places/nearby?lat=${sydney.lat}&lng=${sydney.lng}&radius=3000&type=${type}`);
  if (r.status === 200 && r.data.places.length) ok(`nearby ${type} around Sydney`, `${r.data.places.length} results, e.g. ${r.data.places.slice(0, 3).map((p: any) => p.name).join("; ")}`);
  else bad(`nearby ${type}`, r.data?.error ?? "no results");
}

// 4. details, rating, photo
if (opera) {
  const d = await get(`/api/places/${encodeURIComponent(opera.placeId)}`);
  if (d.status === 200) {
    ok("place details", `${d.data.name}: rating ${d.data.rating ?? "n/a"} (${d.data.ratingCount ?? 0}), hours ${d.data.openingHours ? "yes" : "none"}, photo ${d.data.photo ? "yes" : "none"}`);
    if (d.data.photo) {
      const ph = await get(`/api/places/photo?name=${encodeURIComponent(d.data.photo.name)}`);
      ph.status === 200 && /^https:/.test(ph.data.uri) ? ok("place photo URL") : bad("place photo", ph.data?.error);
    }
  } else bad("place details", d.data?.error);
}

// 5. reverse geocoding
const rg = await get("/api/geo/reverse?lat=-35.2809&lng=149.13");
rg.data?.source === "google" ? ok("reverse geocode Canberra", `→ ${rg.data.label}`) : bad("reverse geocode", `${rg.data?.label} (source ${rg.data?.source})`);

// 6. routes Taronga Zoo → Opera House
if (zoo && opera) {
  for (const mode of ["WALK", "DRIVE", "TRANSIT"]) {
    const r = await post("/api/routes", { origin: { placeId: zoo.placeId }, destination: { placeId: opera.placeId }, mode });
    const o = r.data;
    if (r.status === 200 && o.status === "ok") {
      const lines = (o.steps ?? []).filter((s: any) => s.kind === "transit").map((s: any) => `${s.vehicle ?? ""} ${s.line ?? ""} ${s.localDeparture ?? ""}→${s.localArrival ?? ""}`.trim());
      ok(`route ${mode} Taronga Zoo → Opera House`, `${Math.round(o.durationSec / 60)} min, ${(o.distanceM / 1000).toFixed(1)} km, polyline ${o.polyline ? `${o.polyline.length} chars` : "none"}${lines.length ? `, ${lines.join(" | ")}` : ""}`);
    } else if (r.status === 200) ok(`route ${mode}: Google returned no route`, o.message ?? "");
    else bad(`route ${mode}`, o?.error);
  }
}

// 7. curated itinerary verification
const tpl = await get("/api/itineraries/tpl-sydney-harbour-highlights");
const verified = tpl.data?.stops?.filter((s: any) => s.placeId).length ?? 0;
verified > 0 ? ok("curated stops matched to Google places", `${verified}/${tpl.data.stops.length} in Sydney Harbour Highlights`) : bad("curated stop verification", "none matched");

// 8. the browser key: a real Google map in a real browser
if (!config.mapsBrowserKey) bad("browser key", "GOOGLE_MAPS_BROWSER_KEY missing");
else if (!chromePath) console.log("! Chrome not found, browser key not checked");
else {
  const b = await launch();
  const page = await b!.newPage();
  await page.viewport(1440, 900);
  await page.geolocation(base, { lat: -33.8688, lng: 151.2093 });
  await page.goto(new URL("/", base).href);
  await page.eval(`window.__authFailed = false; window.addEventListener('wayline:maps-auth-failed', () => (window.__authFailed = true));`);
  await page.eval(`[...document.querySelectorAll('button')].find(b => b.textContent.includes('Use my location')).click()`);
  try {
    await page.waitFor(`window.google?.maps?.Map && document.querySelector('#explore-map .map-canvas')`, 15_000);
    await page.waitFor(`document.querySelectorAll('#explore-map .place-row').length > 0`, 15_000);
    await sleep(2500);
    const markers = await page.eval<number>(`document.querySelectorAll('#explore-map .pin-result').length`);
    const failed = await page.eval<boolean>(`window.__authFailed || Boolean(document.querySelector('#explore-map .schematic'))`);
    if (failed) bad("Google map in the browser", "the browser key was rejected (check its website restrictions and that Maps JavaScript API is enabled)");
    else ok("Google map renders in Chrome with the browser key", `${markers} place markers on the map`);
    await page.screenshot("/tmp/wayline-live-map.png");
    console.log("  screenshot: /tmp/wayline-live-map.png");
  } catch (err) {
    bad("Google map in the browser", err instanceof Error ? err.message : String(err));
  }
  b!.close();
}

console.log(failures ? `\n${failures} live check(s) failed.` : "\nAll live checks passed.");
process.exit(failures ? 1 : 0);
