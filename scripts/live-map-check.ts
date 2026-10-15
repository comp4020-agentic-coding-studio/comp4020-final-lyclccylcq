// "My spot" on the real Google map, end to end. spec/ runs without a Google
// key (the schematic), so this is the separate live check, like
// `pnpm check:google`: it needs a running app whose GOOGLE_MAPS_BROWSER_KEY
// works for this origin, and Chrome.
//
//   APP_URL=http://localhost:8080 pnpm check:map
//
// Two accounts in two browser contexts share a trip. Alice's camera is read
// from what the app itself shares with Bob (her live view), so nothing in
// the app is instrumented for this. It signs up two throwaway accounts on
// APP_URL: point it at a local copy, not production.
import { chromePath, inPage, launch, type Page, signUpIn, sleep } from "../spec/browser.ts";

const base = process.env.APP_URL ?? "http://localhost:8080";
if (!chromePath) throw new Error("Chrome wasn't found (set CHROME_PATH).");
let failed = 0;
const step = (ok: boolean, label: string, detail = "") => {
  if (!ok) failed++;
  console.log(`${ok ? "✓" : "✗"} ${label}${detail ? ` (${detail})` : ""}`);
};
const near = (p: { lat: number; lng: number } | null, q: { lat: number; lng: number } | null, tol = 0.002) =>
  Boolean(p && q && Math.abs(p.lat - q.lat) < tol && Math.abs(p.lng - q.lng) < tol);
const savedSpot = `JSON.parse(sessionStorage.getItem(Object.keys(sessionStorage).find(k => k.startsWith('wayline.mySpot'))) ?? 'null')`;
const closePanel = `document.querySelector('.search-panel button[aria-label^="Close"]')?.click()`;
const peer = `document.querySelector('.peer-edge, .peer-marker')`;

async function journey(name: string, width: number, height: number, mobile: boolean) {
  console.log(`\n${name} ${width}×${height}`);
  const browser = (await launch())!;
  try {
    const a = await browser.newPage();
    const b = await browser.newPage();
    await a.viewport(width, height, mobile);
    await b.viewport(1920, 1080);
    const tag = Date.now().toString(36).slice(-6);
    await signUpIn(a, base, `mapcheck_a${tag}`);
    await signUpIn(b, base, `mapcheck_b${tag}`);
    const trip = await inPage(a, "POST", "/api/trips", { title: "Map check", destination: "Sydney", startDate: "2026-12-01", endDate: "2026-12-02", timezone: "Australia/Sydney" });
    const { token } = await inPage(a, "POST", `/api/trips/${trip.id}/invite`, {});
    await inPage(b, "POST", `/api/invites/${token}/accept`, {});
    const ready = `document.querySelector('.conn-live') && document.querySelector('.map-canvas .gm-style')`;
    await b.goto(new URL(`/trips/${trip.id}`, base).href);
    await b.waitFor(ready, 20_000);
    await b.eval(`(() => { const es = new EventSource('/api/trips/${trip.id}/events'); es.addEventListener('view', e => (window.__aview = JSON.parse(e.data))); })()`);
    await a.goto(new URL(`/trips/${trip.id}`, base).href);
    await a.waitFor(ready, 20_000).catch(() => {});
    if (!(await a.eval<boolean>(`Boolean(document.querySelector('.map-canvas .gm-style'))`))) {
      step(false, "the real Google map loaded", "got the schematic: check GOOGLE_MAPS_BROWSER_KEY and its referrers");
      return;
    }
    if (mobile) await a.eval(`[...document.querySelectorAll('.mobile-tabs button')].find(b => b.textContent.includes('Map')).click()`);
    await a.waitFor(`document.querySelector('[data-map=return]')`, 15_000);
    await sleep(2500);
    const camera = async () => {
      await sleep(1300);
      return b.eval<{ lat: number; lng: number; zoom: number } | null>(`window.__aview ?? null`);
    };
    const box = await a.eval<{ x: number; y: number; w: number; h: number }>(`(() => { const c = document.querySelector('.map-canvas').getBoundingClientRect(); return { x: c.x, y: c.y, w: c.width, h: c.height }; })()`);
    const pick = async (fx: number, fy: number) => {
      await a.tapAt(box.x + box.w * fx, box.y + box.h * fy);
      await sleep(900);
      return a.eval<{ lat: number; lng: number; zoom: number } | null>(savedSpot);
    };
    const returnReachable = `(() => { const r = document.querySelector('[data-map=return]').getBoundingClientRect(); return document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)?.closest('[data-map=return]') !== null; })()`;

    step(!(await a.eval<boolean>(`Boolean(document.querySelector('.view-note'))`)), "no view-sharing banner over the map");
    step(await a.eval<boolean>(`document.querySelector('[data-map=return]').disabled`), "Return is disabled before any spot is picked");

    const A = await pick(0.62, 0.62);
    step(Boolean(A), "1. a map click saves my spot", A ? `${A.lat.toFixed(5)}, ${A.lng.toFixed(5)} z${A.zoom}` : "nothing saved");
    step(await a.eval<boolean>(`document.querySelector('.my-spot-label')?.textContent === 'My spot'`), "2. the My spot marker appears");

    await a.eval(closePanel);
    await a.waitFor(peer, 8000).catch(() => {});
    step(await a.eval<boolean>(`Boolean(${peer})`), "a collaborator's marker or edge arrow is visible");
    await a.eval(`${peer}.click()`);
    const atBob = await camera();
    step(!near(atBob, A), "3-4. after closing the panel, jumping to the collaborator's view moves the camera away");
    step(JSON.stringify(await a.eval(savedSpot)) === JSON.stringify(A), "   ...and leaves my spot unchanged");

    await inPage(b, "POST", `/api/trips/${trip.id}/activities`, { clientId: `map-check-${tag}`, dayId: trip.days[0].id, title: "Remote add", kind: "custom", startMin: 600, durationMin: 60 });
    await sleep(1500);
    step(await a.eval<boolean>(`Boolean(document.querySelector('.my-spot')?.isConnected)`), "5. the marker survives a remote itinerary update");

    step(await a.eval<boolean>(returnReachable), "Return to my spot is reachable (nothing covers it)");
    const stopsBefore = (await inPage(a, "GET", `/api/trips/${trip.id}`)).days[0].activities.length;
    await a.tap("[data-map=return]");
    const back = await camera();
    step(near(back, A), "6-7. Return brings the camera back to A", back ? `${back.lat.toFixed(5)}, ${back.lng.toFixed(5)} z${back.zoom}` : "no view");
    step(await a.eval<boolean>(`document.querySelector('.my-spot').classList.contains('is-pulsing')`), "   ...and highlights the marker");
    step((await inPage(a, "GET", `/api/trips/${trip.id}`)).days[0].activities.length === stopsBefore, "   ...without adding anything to the plan");

    const B = await pick(0.38, 0.4);
    await a.eval(closePanel);
    await sleep(300);
    await a.eval(`${peer}?.click()`);
    await sleep(800);
    await a.tap("[data-map=return]");
    const back2 = await camera();
    step(Boolean(B) && !near(A, B, 0.0001) && near(back2, B), "8. after picking B, Return goes to B");
  } finally {
    browser.close();
  }
}

await journey("desktop", 1920, 1080, false);
await journey("phone", 390, 844, true);
console.log(failed ? `\n${failed} step(s) failed.` : "\nAll steps passed on the real Google map.");
process.exitCode = failed ? 1 : 0;
