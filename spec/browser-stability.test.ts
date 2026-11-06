import { inflateSync } from "node:zlib";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { chromePath, inPage, launch, signUpIn, sleep } from "./browser.ts";
import { uniqueName } from "./helpers.ts";

// The November 2026 recheck's four findings, each driven in real Chrome:
// two people changing one stop's place at once, the fixes form under the
// keyboard, the exported image of a wrapped title, and invitation cards
// when the page's answers arrive out of order.
const baseUrl = inject("baseUrl");
let browser: NonNullable<Awaited<ReturnType<typeof launch>>>;
beforeAll(async () => {
  if (chromePath) browser = (await launch())!;
}, 30_000); // starting Chrome alongside the other browser files on a two-core CI runner
afterAll(() => browser?.close());

type P = Parameters<typeof inPage>[0];
const newTrip = (p: P, title: string) => inPage(p, "POST", "/api/trips", { title, destination: "Sydney", startDate: "2026-12-01", endDate: "2026-12-01", timezone: "Australia/Sydney" });
const stop = (p: P, t: any, title: string, startMin: number | null, durationMin = 60, place?: Record<string, unknown>) =>
  inPage(p, "POST", `/api/trips/${t.id}/activities`, { clientId: `${title}-${Math.random()}`, dayId: t.days[0].id, title, kind: "attraction", startMin, durationMin, ...(place ? { place } : {}) });
const open = async (p: P, t: any) => {
  await p.goto(new URL(`/trips/${t.id}`, baseUrl).href);
  await p.waitFor(`document.querySelector('.conn-live')`, 8000);
};
const activity = async (p: P, tripId: string, id: string) => (await inPage(p, "GET", `/api/trips/${tripId}`)).days.flatMap((d: any) => d.activities).find((a: any) => a.id === id);

describe.skipIf(!chromePath)("two people change one stop's place at once", () => {
  it("keeps the version the change began from: the late one is refused, then goes ahead only once confirmed again", async () => {
    const owner = await browser.newPage();
    const guest = await browser.newPage();
    await owner.viewport(1440, 900);
    await guest.viewport(1440, 900);
    await signUpIn(owner, baseUrl, uniqueName("repA"));
    const g = await signUpIn(guest, baseUrl, uniqueName("repB"));
    const t = await newTrip(owner, "Same stop");
    const id = (await stop(owner, t, "Bondi Beach", 600, 60, { placeId: "demo:bondi-beach", source: "demo", lat: -33.8915, lng: 151.2767 })).activityId;
    const inv = await inPage(owner, "POST", `/api/trips/${t.id}/invitations`, { userId: g.id });
    await inPage(guest, "POST", `/api/invitations/${inv.invitation.id}/accept`);
    await open(owner, t);
    await open(guest, t);
    const v1 = (await activity(owner, t.id, id)).version;
    // both begin changing Bondi Beach's place; each picks a candidate
    const pick = async (p: P, query: string, name: string) => {
      await p.waitFor(`document.querySelector('[data-change-place="${id}"]')`, 5000);
      await p.click(`[data-change-place="${id}"]`);
      await p.waitFor(`/New place for Bondi Beach/.test(document.querySelector('.start-panel')?.textContent ?? '')`);
      await p.eval(`document.querySelector('.search input').value = ${JSON.stringify(query)}; document.querySelector('.search').requestSubmit()`);
      await p.waitFor(`[...document.querySelectorAll('.results .result')].some(b => b.textContent.includes(${JSON.stringify(name)}))`, 5000);
      await p.eval(`[...document.querySelectorAll('.results .result')].find(b => b.textContent.includes(${JSON.stringify(name)})).click()`);
      await p.waitFor(`[...document.querySelectorAll('.place-actions button')].some(b => b.textContent.startsWith('Use for'))`, 5000);
    };
    await pick(owner, "opera", "Sydney Opera House");
    await pick(guest, "zoo", "Taronga Zoo Sydney");
    // the guest saves first
    await guest.eval(`[...document.querySelectorAll('.place-actions button')].find(b => b.textContent.startsWith('Use for')).click()`);
    await guest.waitFor(`!document.querySelector('.start-panel') && !document.querySelector('.place-actions')`, 5000);
    const saved = await activity(owner, t.id, id);
    expect(saved.place.placeId).toBe("demo:taronga-zoo");
    expect(saved.version).toBeGreaterThan(v1);
    // the owner's page has the guest's change, and says the stop changed
    // under them; it doesn't quietly take the new version as its own
    await owner.waitFor(`document.querySelector('[data-replace-stale]')`, 5000);
    expect(await owner.eval(`document.querySelector('[data-replace-stale]').textContent`)).toMatch(/changed/i);
    // pressing the old "Use for" sends the version the change began from:
    // the server refuses it and nothing is written
    const sent: any[] = [];
    await owner.eval(`window.__puts = []; const f = window.fetch; window.fetch = (u, o) => { if (o?.method === 'PUT' && String(u).endsWith('/place')) window.__puts.push(JSON.parse(o.body)); return f(u, o); }`);
    await owner.eval(`[...document.querySelectorAll('.place-actions button')].find(b => b.textContent.startsWith('Use for')).click()`);
    await owner.waitFor(`window.__puts.length === 1`, 5000);
    sent.push(...(await owner.eval<any[]>(`window.__puts`)));
    expect(sent[0].baseVersion).toBe(v1);
    await owner.waitFor(`/changed|version/i.test(document.querySelector('.toast')?.textContent ?? '') || document.querySelector('[data-replace-confirm]')`, 5000);
    const after409 = await activity(owner, t.id, id);
    expect(after409.place.placeId).toBe("demo:taronga-zoo");
    expect(after409.version).toBe(saved.version);
    // still choosing: an explicit confirmation against what's there now
    await owner.waitFor(`document.querySelector('[data-replace-confirm]')`, 5000);
    expect(await owner.eval(`document.querySelector('[data-replace-confirm]').textContent`)).toMatch(/Taronga Zoo/);
    await owner.click("[data-replace-confirm]");
    await owner.waitFor(`window.__puts.length === 2`, 5000);
    expect((await owner.eval<any[]>(`window.__puts`))[1].baseVersion).toBe(saved.version);
    await owner.waitFor(`!document.querySelector('.start-panel')`, 5000);
    const final = await activity(owner, t.id, id);
    expect(final.place.placeId).toBe("demo:opera-house");
    expect(final.title).toBe("Sydney Opera House");
    expect(final.version).toBe(saved.version + 1);
    // and the guest sees it
    await guest.waitFor(`[...document.querySelectorAll('.stop h3')].some(h => h.textContent === 'Sydney Opera House')`, 5000);
  }, 60_000);

  it("still leaves the change if the stop is removed while the other person is choosing", async () => {
    const page = await browser.newPage();
    await page.viewport(1440, 900);
    await signUpIn(page, baseUrl, uniqueName("repgone"));
    const t = await newTrip(page, "Gone");
    const id = (await stop(page, t, "Bondi Beach", 600, 60)).activityId;
    await open(page, t);
    await page.click(`[data-change-place="${id}"]`);
    await page.waitFor(`/New place for Bondi Beach/.test(document.querySelector('.start-panel')?.textContent ?? '')`);
    await inPage(page, "DELETE", `/api/trips/${t.id}/activities/${id}`);
    await page.waitFor(`!document.querySelector('.start-panel') && /there's no place to change/.test(document.body.innerText)`, 5000);
  }, 30_000);
});

describe.skipIf(!chromePath)("the fixes form under the keyboard", () => {
  it("keeps focus on the radio the arrows chose, so Tab, Shift+Tab and Enter carry on from there", async () => {
    const page = await browser.newPage();
    await page.viewport(1440, 900);
    await signUpIn(page, baseUrl, uniqueName("fixkey"));
    const trip = await newTrip(page, "Keys");
    for (const [title, startMin, durationMin] of [["Zoo", 540, 180], ["Lunch", 705, 60], ["Museum", 760, 90], ["Dinner", 840, 60]] as const) await stop(page, trip, title, startMin, durationMin);
    await open(page, trip);
    await page.eval(`[...document.querySelectorAll('.timeline button')].find(b => b.textContent === 'See options').click()`);
    await page.waitFor(`document.querySelectorAll('[data-fixes] fieldset').length === 3`, 5000);
    const issueIds = await page.eval<string[]>(`[...document.querySelectorAll('[data-fixes] fieldset')].map(f => f.dataset.issue)`);
    // what has focus: which problem's fieldset, which option, whether it's chosen
    const where = `(() => { const a = document.activeElement; const f = a?.closest?.('fieldset[data-issue]'); return { tag: a?.tagName, issue: f?.dataset.issue ?? null, value: a?.value ?? null, checked: a?.checked ?? null, apply: a?.dataset?.fixesApply ?? null }; })()`;
    const radios = (n: number) => `[...document.querySelectorAll('[data-fixes] fieldset')[${n}].querySelectorAll('input[type=radio]')]`;
    const enabled = (n: number) => page.eval<string[]>(`${radios(n)}.filter(i => !i.disabled).map(i => i.value)`);
    // the second problem's chosen radio has focus
    await page.eval(`${radios(1)}.find(i => i.checked).focus()`);
    const start = await page.eval<any>(where);
    expect(start).toMatchObject({ tag: "INPUT", issue: issueIds[1], checked: true });
    const opts1 = await enabled(1);
    const at = opts1.indexOf(start.value);
    // ArrowDown: the next option is chosen and keeps the focus
    await page.key("ArrowDown");
    const down = await page.eval<any>(where);
    const expected = opts1[(at + 1) % opts1.length];
    expect(down).toMatchObject({ tag: "INPUT", issue: issueIds[1], value: expected, checked: true });
    expect(await page.eval(`${radios(1)}.find(i => i.checked).value`)).toBe(expected);
    // the preview followed the choice
    expect(await page.eval(`document.querySelector('[data-fixes-apply]').dataset.fixesApply`)).toBe(expected === "keep" ? "2" : "3");
    // ArrowUp: back to where it was, still focused
    await page.key("ArrowUp");
    expect(await page.eval<any>(where)).toMatchObject({ tag: "INPUT", issue: issueIds[1], value: start.value, checked: true });
    // Tab goes on to the next problem's chosen radio, not back to the top of the panel
    await page.key("Tab");
    expect(await page.eval<any>(where)).toMatchObject({ tag: "INPUT", issue: issueIds[2], checked: true });
    // Shift+Tab returns to the second problem
    await page.key("Shift+Tab");
    expect(await page.eval<any>(where)).toMatchObject({ tag: "INPUT", issue: issueIds[1], value: start.value, checked: true });
    // after the last problem, Tab reaches the apply button, and Enter applies
    await page.key("Tab");
    await page.key("Tab");
    expect(await page.eval<any>(where)).toMatchObject({ tag: "BUTTON", apply: "3" });
    await page.key("Enter");
    await page.waitFor(`!document.querySelector('[data-fixes]')`, 5000);
    expect((await inPage(page, "GET", `/api/trips/${trip.id}`)).days[0].analysis.issues).toHaveLength(0);
  }, 40_000);

  it("skips unavailable choices on a phone, and keeps the focused choice through a collaborator's change", async () => {
    const page = await browser.newPage();
    await page.viewport(390, 844, true);
    await signUpIn(page, baseUrl, uniqueName("fixkey2"));
    const trip = await newTrip(page, "Keys phone");
    for (const [title, startMin, durationMin] of [["Zoo", 540, 180], ["Lunch", 705, 60], ["Museum", 760, 90], ["Dinner", 840, 60]] as const) await stop(page, trip, title, startMin, durationMin);
    await open(page, trip);
    await page.eval(`[...document.querySelectorAll('.timeline button')].find(b => b.textContent === 'See options').click()`);
    await page.waitFor(`document.querySelectorAll('[data-fixes] fieldset').length === 3`, 5000);
    const set = (n: number) => `[...document.querySelectorAll('[data-fixes] fieldset')[${n}].querySelectorAll('input[type=radio]')]`;
    // the starting choices leave some options unavailable (they'd change a
    // stop another choice already changes); the arrows never land on those
    const disabled = await page.eval<string[]>(`${set(0)}.filter(i => i.disabled).map(i => i.value)`);
    expect(disabled.length).toBeGreaterThan(0);
    await page.eval(`${set(0)}.find(i => i.checked).focus()`);
    const seen = new Set<string>();
    for (let i = 0; i < 4; i++) {
      await page.key("ArrowDown");
      const now = await page.eval<any>(`({ tag: document.activeElement.tagName, value: document.activeElement.value, checked: document.activeElement.checked, disabled: document.activeElement.disabled, inFirst: document.querySelectorAll('[data-fixes] fieldset')[0].contains(document.activeElement) })`);
      expect(now).toMatchObject({ tag: "INPUT", checked: true, disabled: false, inFirst: true });
      seen.add(now.value);
      // the choice and what it makes unavailable are both up to date
      expect(await page.eval(`${set(0)}.filter(i => i.checked).length`)).toBe(1);
    }
    expect(seen.size).toBeGreaterThan(1);
    // a collaborator's change re-renders the panel while it has focus: focus stays on the same choice
    const focused = await page.eval<string>(`document.activeElement.value`);
    const note = (await inPage(page, "GET", `/api/trips/${trip.id}`)).days[0].activities.find((a: any) => a.title === "Dinner");
    await inPage(page, "PATCH", `/api/trips/${trip.id}/activities/${note.id}`, { baseVersion: note.version, notes: "Booked" });
    await page.waitFor(`(document.querySelector('[data-fixes]')?.dataset.fixes ?? '') !== ''`, 5000);
    await sleep(800);
    const after = await page.eval<any>(`({ tag: document.activeElement.tagName, issue: document.activeElement.closest?.('fieldset')?.dataset.issue ?? null, value: document.activeElement.value })`);
    expect(after.tag).toBe("INPUT");
    expect(after.value.split(":")[0]).toBe(focused.split(":")[0]);
  }, 40_000);
});

// Reads a PNG (8-bit RGB or RGBA, non-interlaced, as canvas.toBlob writes)
// into rows of pixels, so a test can look at what was actually drawn.
function decodePng(buf: Buffer) {
  let pos = 8;
  let w = 0;
  let h = 0;
  let channels = 4;
  const idat: Buffer[] = [];
  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos);
    const type = buf.toString("ascii", pos + 4, pos + 8);
    const data = buf.subarray(pos + 8, pos + 8 + len);
    if (type === "IHDR") {
      w = data.readUInt32BE(0);
      h = data.readUInt32BE(4);
      channels = data[9] === 6 ? 4 : 3;
    } else if (type === "IDAT") idat.push(data);
    pos += 12 + len;
  }
  const raw = inflateSync(Buffer.concat(idat));
  const stride = w * channels;
  const out = Buffer.alloc(h * stride);
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)];
    for (let x = 0; x < stride; x++) {
      const v = raw[y * (stride + 1) + 1 + x];
      const a = x >= channels ? out[y * stride + x - channels] : 0;
      const b = y ? out[(y - 1) * stride + x] : 0;
      const c = x >= channels && y ? out[(y - 1) * stride + x - channels] : 0;
      const p = a + b - c;
      const pr = Math.abs(p - a) <= Math.abs(p - b) && Math.abs(p - a) <= Math.abs(p - c) ? a : Math.abs(p - b) <= Math.abs(p - c) ? b : c;
      out[y * stride + x] = (v + [0, a, b, (a + b) >> 1, pr][f]) & 255;
    }
  }
  return { w, h, dark: (x: number, y: number) => { const i = y * stride + x * channels; return out[i] + out[i + 1] + out[i + 2] < 300; } };
}

// The image the export page makes, read back as a PNG, beside where the
// page itself put each line of the title.
async function exportImage(p: P) {
  await p.eval(`window.__png = null; HTMLAnchorElement.prototype.click = function () { const name = this.download; fetch(this.href).then(r => r.arrayBuffer()).then(b => { const u = new Uint8Array(b); let s = ''; for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode(...u.subarray(i, i + 0x8000)); window.__pngName = name; window.__png = btoa(s); }); }`);
  await p.click("[data-export=image]");
  await p.waitFor(`window.__png`, 15000);
  const png = decodePng(Buffer.from(await p.eval<string>(`window.__png`), "base64"));
  const layout = await p.eval<any>(`(() => {
    const doc = document.querySelector('.tp-doc').getBoundingClientRect();
    const t = document.querySelector('.tp-title');
    const range = document.createRange(); range.selectNodeContents(t);
    const lines = [...range.getClientRects()].map(r => ({ x: r.left - doc.left, y: r.top - doc.top, w: r.width, h: r.height }));
    return { doc: { w: doc.width, h: doc.height }, lines, scale: 0 };
  })()`);
  return { png, layout, name: await p.eval<string>(`window.__pngName`) };
}

// Ink inside a box of the image (in page pixels, scaled to the image's).
function inkIn(png: ReturnType<typeof decodePng>, k: number, box: { x: number; y: number; w: number; h: number }) {
  let n = 0;
  for (let y = Math.max(0, Math.floor(box.y * k)); y < Math.min(png.h, Math.ceil((box.y + box.h) * k)); y++)
    for (let x = Math.max(0, Math.floor(box.x * k)); x < Math.min(png.w, Math.ceil((box.x + box.w) * k)); x++) if (png.dark(x, y)) n++;
  return n;
}

// Each line of the title, where the page put it, has ink in the image, about
// as dense as the other lines (a line drawn off to the side, or not at all,
// leaves its box nearly empty).
function expectEveryLineInked(png: ReturnType<typeof decodePng>, k: number, lines: { x: number; y: number; w: number; h: number }[]) {
  const density = lines.map((l) => inkIn(png, k, l) / (l.w * l.h * k * k));
  const most = Math.max(...density);
  expect(most).toBeGreaterThan(0.02);
  for (const d of density) expect(d).toBeGreaterThan(most * 0.4);
  // and each line starts where the page starts it (no shifted or indented line)
  for (const l of lines) {
    let first = Infinity;
    for (let y = Math.floor(l.y * k); y < Math.min(png.h, Math.ceil((l.y + l.h) * k)); y++)
      for (let x = 0; x < png.w; x++) if (png.dark(x, y)) { first = Math.min(first, x); break; }
    expect(Math.abs(first / k - l.x)).toBeLessThan(6);
  }
}

describe.skipIf(!chromePath)("the exported image of a long title", () => {
  for (const vp of [{ w: 390, h: 844, m: true }, { w: 1920, h: 1080, m: false }]) {
    it(`draws every line the page wraps the title into (${vp.w}×${vp.h})`, async () => {
      const page = await browser.newPage();
      await page.viewport(vp.w, vp.h, vp.m);
      await signUpIn(page, baseUrl, uniqueName("pngt"));
      const long = "A long weekend on the harbour, the beaches and every lookout";
      const trip = await newTrip(page, long);
      await stop(page, trip, "Opera House", 600, 60);
      await page.goto(new URL(`/trips/${trip.id}/print`, baseUrl).href);
      await page.waitFor(`document.querySelector('.tp-doc .tp-title') && document.fonts.status === 'loaded'`, 10000);
      const { png, layout } = await exportImage(page);
      expect(layout.lines.length).toBeGreaterThan(1);
      const k = png.w / layout.doc.w;
      expect(png.h / layout.doc.h).toBeCloseTo(k, 1);
      // each line the page shows has ink at its place in the image, and the
      // image's ink stays within the title's own width (nothing drawn beyond it)
      expectEveryLineInked(png, k, layout.lines);
      const widest = Math.max(...layout.lines.map((l: any) => l.x + l.w));
      const band = { x: widest + 4, y: layout.lines[0].y, w: layout.doc.w - widest - 4, h: layout.lines.at(-1).y + layout.lines.at(-1).h - layout.lines[0].y };
      if (band.w > 4) expect(inkIn(png, k, band)).toBe(0);
      // the image keeps the stop below the title
      const stopBox = await page.eval<any>(`(() => { const d = document.querySelector('.tp-doc').getBoundingClientRect(); const r = document.querySelector('.tp-stop').getBoundingClientRect(); return { x: r.left - d.left, y: r.top - d.top, w: r.width, h: r.height }; })()`);
      expect(inkIn(png, k, stopBox)).toBeGreaterThan(50);
    }, 40_000);
  }

  it("draws the curated Sydney Harbour Highlights title on two lines at 390×844, without an account", async () => {
    const page = await browser.newPage();
    await page.viewport(390, 844, true);
    await page.goto(new URL("/itineraries/tpl-sydney-harbour-highlights/export", baseUrl).href);
    await page.waitFor(`document.querySelector('.tp-doc .tp-title') && document.fonts.status === 'loaded'`, 10000);
    const { png, layout, name } = await exportImage(page);
    expect(name).toBe("sydney-harbour-highlights.png");
    expect(layout.lines.length).toBe(2);
    const k = png.w / layout.doc.w;
    expectEveryLineInked(png, k, layout.lines);
  }, 30_000);

  it("draws a wrapped Chinese title on every line too", async (test) => {
    const page = await browser.newPage();
    await page.viewport(390, 844, true);
    await signUpIn(page, baseUrl, uniqueName("pngzh"));
    // A machine with no Chinese font (CI's Ubuntu image) draws these
    // characters as nothing, on the page and in the image alike, so there's
    // no line to compare. Skipped there, said in the output, never passed.
    const cjk = await page.eval<boolean>(`(() => { const c = document.createElement('canvas'); c.width = 200; c.height = 60; const g = c.getContext('2d'); g.font = '40px serif'; g.fillText('悉尼', 10, 45); const d = g.getImageData(0, 0, 200, 60).data; let n = 0; for (let i = 3; i < d.length; i += 4) if (d[i] > 128) n++; return n > 50; })()`);
    if (!cjk) return test.skip("this browser has no font for Chinese characters");
    const trip = await newTrip(page, "悉尼海港与海滩周末慢行：从歌剧院到邦迪再到库吉的每一个观景点与咖啡馆");
    await stop(page, trip, "歌剧院", 600, 60);
    await page.goto(new URL(`/trips/${trip.id}/print`, baseUrl).href);
    await page.waitFor(`document.querySelector('.tp-doc .tp-title') && document.fonts.status === 'loaded'`, 10000);
    const { png, layout } = await exportImage(page);
    expect(layout.lines.length).toBeGreaterThan(1);
    const k = png.w / layout.doc.w;
    expectEveryLineInked(png, k, layout.lines);
  }, 30_000);
});

// Holds the page's GET /api/invitations answers until the test releases
// them, so their order can be chosen. Each request waits under a number
// (0, 1, 2, … in the order they were sent); release(n) lets that one through.
// Every request is answered by the server at once (so its content is the
// state when it was sent); only handing the answer to the page waits.
// __titles(n) says what answer n holds; __releaseWhere(fn) lets through
// every held answer whose titles match.
const holdInvitations = `
  window.__inv = { n: 0, waiting: new Map(), hold: sessionStorage.getItem('inv-hold') !== 'off' };
  const realFetch = window.fetch;
  window.fetch = (u, o) => {
    if (String(u).endsWith('/api/invitations') && (!o || !o.method || o.method === 'GET') && window.__inv.hold) {
      const n = window.__inv.n++;
      return realFetch(u, o).then(async (res) => {
        const body = await res.clone().json();
        const titles = body.invitations.map((i) => i.trip.title).sort().join('+');
        return new Promise((go) => window.__inv.waiting.set(n, { titles, go: () => go(res) }));
      });
    }
    return realFetch(u, o);
  };
  window.__release = (n) => { const w = window.__inv.waiting.get(n); window.__inv.waiting.delete(n); w?.go(); };
  window.__held = () => [...window.__inv.waiting].map(([n, w]) => [n, w.titles]);
  window.__releaseWhere = (titles) => { for (const [n, w] of [...window.__inv.waiting]) if (w.titles === titles) window.__release(n); };
`;

describe.skipIf(!chromePath)("invitation cards when answers arrive out of order", () => {
  const setup = async () => {
    const owner = await browser.newPage();
    const guest = await browser.newPage();
    await guest.viewport(390, 844, true);
    await signUpIn(owner, baseUrl, uniqueName("io"));
    const g = await signUpIn(guest, baseUrl, uniqueName("ig"));
    await guest.initScript(holdInvitations);
    return { owner, guest, g };
  };
  const cards = (p: P) => p.eval<string[]>(`[...document.querySelectorAll('dialog[open][data-invitation-card] h2')].map(x => x.textContent).sort()`);
  const pending = async (p: P) => (await inPage(p, "GET", "/api/invitations")).invitations.map((i: any) => i.trip.title).sort();
  // the page's opening requests (the watcher's baseline, the top bar's count), let through
  const settle = async (p: P) => {
    await p.waitFor(`window.__inv.waiting.size >= 2`, 10000);
    await p.eval(`window.__releaseWhere('')`);
    await sleep(400);
  };
  const heldWith = (p: P, titles: string) => p.waitFor(`window.__held().some(([, x]) => x === ${JSON.stringify(titles)})`, 5000);

  it("an older answer doesn't close a card a newer one opened", async () => {
    const { owner, guest, g } = await setup();
    await guest.goto(new URL("/", baseUrl).href);
    await settle(guest);
    const a = await newTrip(owner, "Trip A");
    const b = await newTrip(owner, "Trip B");
    await inPage(owner, "POST", `/api/trips/${a.id}/invitations`, { userId: g.id });
    await heldWith(guest, "Trip A"); // answered while only A was waiting
    await inPage(owner, "POST", `/api/trips/${b.id}/invitations`, { userId: g.id });
    await heldWith(guest, "Trip A+Trip B");
    // A+B reaches the page first: two cards
    await guest.eval(`window.__releaseWhere('Trip A+Trip B')`);
    await guest.waitFor(`document.querySelectorAll('dialog[open][data-invitation-card]').length === 2`, 5000);
    // then the older answer, A only: B's card stays
    await guest.eval(`window.__releaseWhere('Trip A')`);
    await sleep(800);
    expect(await cards(guest)).toEqual(["Trip A", "Trip B"]);
    await guest.eval(`window.__inv.hold = false`);
    expect(await pending(guest)).toEqual(["Trip A", "Trip B"]);
  }, 40_000);

  it("a slow first answer doesn't swallow an invitation sent while it was on its way", async () => {
    const { owner, guest, g } = await setup();
    const old = await newTrip(owner, "Already waiting");
    await inPage(owner, "POST", `/api/trips/${old.id}/invitations`, { userId: g.id });
    await guest.goto(new URL("/", baseUrl).href);
    // the page's first answers (only the one already waiting) are held back
    await guest.waitFor(`window.__held().filter(([, x]) => x === 'Already waiting').length >= 2`, 10000);
    const fresh = await newTrip(owner, "Sent meanwhile");
    await inPage(owner, "POST", `/api/trips/${fresh.id}/invitations`, { userId: g.id });
    await heldWith(guest, "Already waiting+Sent meanwhile");
    // the newer answer reaches the page first, then the slow first ones
    await guest.eval(`window.__releaseWhere('Already waiting+Sent meanwhile')`);
    await sleep(400);
    await guest.eval(`window.__releaseWhere('Already waiting')`);
    await sleep(800);
    // only the new one pops up; the one already waiting stays in My Trips
    expect(await cards(guest)).toEqual(["Sent meanwhile"]);
    await guest.eval(`window.__inv.hold = false`);
    expect(await pending(guest)).toEqual(["Already waiting", "Sent meanwhile"]);
  }, 40_000);

  it("a cancelled invitation's card goes, one accepted in another tab goes from this tab, and Later keeps it in My Trips", async () => {
    const { owner, guest, g } = await setup();
    await guest.goto(new URL("/", baseUrl).href);
    await settle(guest);
    await guest.eval(`window.__inv.hold = false; for (const [n] of window.__held()) window.__release(n)`);
    const c = await newTrip(owner, "To cancel");
    const d = await newTrip(owner, "To accept");
    const sc = await inPage(owner, "POST", `/api/trips/${c.id}/invitations`, { userId: g.id });
    const sd = await inPage(owner, "POST", `/api/trips/${d.id}/invitations`, { userId: g.id });
    await guest.waitFor(`document.querySelectorAll('dialog[open][data-invitation-card]').length === 2`, 5000);
    await inPage(owner, "DELETE", `/api/trips/${c.id}/invitations/${sc.invitation.id}`);
    await guest.waitFor(`document.querySelectorAll('dialog[open][data-invitation-card]').length === 1`, 5000);
    expect(await cards(guest)).toEqual(["To accept"]);
    // accepted from another tab (the same account): this tab's card closes
    await inPage(guest, "POST", `/api/invitations/${sd.invitation.id}/accept`);
    await guest.waitFor(`document.querySelectorAll('dialog[open][data-invitation-card]').length === 0`, 5000);
    expect(await pending(guest)).toEqual([]);
    // Later still leaves an invitation in My Trips
    const e = await newTrip(owner, "For later");
    await inPage(owner, "POST", `/api/trips/${e.id}/invitations`, { userId: g.id });
    await guest.waitFor(`document.querySelector('dialog[open][data-invitation-card]')`, 5000);
    await guest.eval(`sessionStorage.setItem('inv-hold', 'off')`);
    await guest.click("dialog[open][data-invitation-card] [data-invite-card=later]");
    await guest.waitFor(`!document.querySelector('dialog[open][data-invitation-card]')`, 5000);
    await guest.goto(new URL("/trips", baseUrl).href);
    await guest.waitFor(`[...document.querySelectorAll('[data-invitation] h3')].some(h => h.textContent === 'For later')`, 8000);
  }, 40_000);

  it("signing out closes the cards, and an answer still on its way opens none", async () => {
    const { owner, guest, g } = await setup();
    await guest.goto(new URL("/", baseUrl).href);
    await settle(guest);
    const f = await newTrip(owner, "Before signing out");
    await inPage(owner, "POST", `/api/trips/${f.id}/invitations`, { userId: g.id });
    await heldWith(guest, "Before signing out");
    await guest.eval(`window.__releaseWhere('Before signing out')`);
    await guest.waitFor(`document.querySelector('dialog[open][data-invitation-card]')`, 5000);
    // a second one is answered but not yet delivered when this person signs out
    const h2 = await newTrip(owner, "After signing out");
    await inPage(owner, "POST", `/api/trips/${h2.id}/invitations`, { userId: g.id });
    await heldWith(guest, "After signing out+Before signing out");
    await inPage(guest, "POST", "/api/auth/logout");
    await guest.waitFor(`!document.querySelector('dialog[open][data-invitation-card]')`, 8000);
    await guest.eval(`window.__releaseWhere('After signing out+Before signing out')`);
    await sleep(800);
    expect(await cards(guest)).toEqual([]);
  }, 40_000);
});
