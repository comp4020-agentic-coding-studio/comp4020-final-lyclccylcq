import { mkdirSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, inject, it, vi } from "vitest";
import { chromePath, inPage, launch, type Page, signUpIn, sleep, toneWav } from "./browser.ts";
import { uniqueName } from "./helpers.ts";

// Voice calls in two real, separate browsers (ADR 0004). Each browser's
// fake microphone plays its own tone (440 Hz and 660 Hz); a call only
// passes if each side measures the *other* side's frequency in the audio it
// received over WebRTC. A "Connected" label alone isn't evidence. Both
// browsers are on this machine, so this proves the signalling, negotiation
// and media path, not NAT traversal or TURN (see ADR 0004).
const baseUrl = inject("baseUrl");
vi.setConfig({ testTimeout: 60_000, hookTimeout: 30_000 });
let alice: Awaited<ReturnType<typeof launch>>;
let bob: Awaited<ReturnType<typeof launch>>;
let denied: Awaited<ReturnType<typeof launch>>;
const SHOTS = process.env.CALL_SCREENSHOTS; // a directory to save screenshots to, when set

beforeAll(async () => {
  [alice, bob, denied] = await Promise.all([launch({ media: { wav: toneWav(440) } }), launch({ media: { wav: toneWav(660) } }), launch({ media: "deny" })]);
  if (SHOTS) mkdirSync(SHOTS, { recursive: true });
});
afterAll(() => {
  alice?.close();
  bob?.close();
  denied?.close();
});

// The strongest frequency in what this page is receiving from the call.
const receivedHz = `(async () => {
  const el = document.querySelector('audio.call-audio');
  if (!el || !el.srcObject) return null;
  const ctx = window.__callCtx ??= new AudioContext();
  await ctx.resume();
  const src = ctx.createMediaStreamSource(el.srcObject);
  const an = ctx.createAnalyser();
  an.fftSize = 8192;
  src.connect(an);
  await new Promise(r => setTimeout(r, 600));
  const bins = new Float32Array(an.frequencyBinCount);
  an.getFloatFrequencyData(bins);
  src.disconnect();
  let best = 0;
  for (let i = 1; i < bins.length; i++) if (bins[i] > bins[best]) best = i;
  return { hz: Math.round(best * ctx.sampleRate / an.fftSize), db: Math.round(bins[best]) };
})()`;
const phase = `(document.querySelector('.call')?.dataset.phase ?? null)`;
const callText = `document.querySelector('.call')?.textContent ?? ''`;

async function sharedTrip(owner: Page, guest: Page) {
  const trip = await inPage(owner, "POST", "/api/trips", { title: "Call trip", destination: "Sydney", startDate: "2026-12-01", endDate: "2026-12-02", timezone: "Australia/Sydney" });
  for (const [title, startMin] of [["Zoo", 540], ["Lunch", 600]] as const) {
    await inPage(owner, "POST", `/api/trips/${trip.id}/activities`, { clientId: `${title}-${Math.random()}`, dayId: trip.days[0].id, title, kind: "attraction", startMin, durationMin: 120 });
  }
  const { token } = await inPage(owner, "POST", `/api/trips/${trip.id}/invite`, {});
  await inPage(guest, "POST", `/api/invites/${token}/accept`, {});
  return trip;
}

async function open(page: Page, tripId: string, w = 1920, h = 1080, mobile = false) {
  await page.viewport(w, h, mobile);
  await page.goto(new URL(`/trips/${tripId}?calldebug`, baseUrl).href);
  await page.waitFor(`document.querySelector('.timeline .stop') && document.querySelector('.conn-live')`, 10_000);
}

async function connect(a: Page, b: Page) {
  await a.waitFor(`document.querySelector('[data-call=start]')`, 8000);
  await a.click("[data-call=start]");
  await b.waitFor(`document.querySelector('[data-call=accept]')`, 8000);
  expect(await b.eval<string>(callText)).toMatch(/is calling/);
  expect(await a.eval<string>(phase)).toBe("outgoing");
  await b.click("[data-call=accept]");
  await a.waitFor(`${phase} === 'connected'`, 15_000);
  await b.waitFor(`${phase} === 'connected'`, 15_000);
}

const hearsTone = async (p: Page, hz: number) => {
  for (let i = 0; i < 10; i++) {
    const r = await p.eval<{ hz: number; db: number } | null>(receivedHz);
    if (r && Math.abs(r.hz - hz) <= 15 && r.db > -70) return r;
    await sleep(300);
  }
  return p.eval<{ hz: number; db: number } | null>(receivedHz);
};

describe.skipIf(!chromePath)("voice calls in two real browsers", () => {
  it("connects, carries each person's audio to the other, mutes, and hangs up", async () => {
    const a = await alice!.newPage();
    const b = await bob!.newPage();
    await signUpIn(a, baseUrl, uniqueName("ca"));
    await signUpIn(b, baseUrl, uniqueName("cb"));
    const trip = await sharedTrip(a, b);
    await open(a, trip.id);
    await open(b, trip.id);
    await connect(a, b);

    // Bob receives Alice's 440 Hz and Alice receives Bob's 660 Hz.
    const atBob = await hearsTone(b, 440);
    const atAlice = await hearsTone(a, 660);
    expect(Math.abs((atBob?.hz ?? 0) - 440)).toBeLessThanOrEqual(15);
    expect(Math.abs((atAlice?.hz ?? 0) - 660)).toBeLessThanOrEqual(15);
    expect(await a.eval<string>(callText)).toMatch(/You and/);
    expect(await a.eval<string>(callText)).not.toMatch(/false|undefined|null/);
    if (SHOTS) await a.screenshot(`${SHOTS}/call-desktop-connected.png`);

    // Editing, switching panels and reading the copilot don't disturb the call.
    const before = await inPage(a, "GET", `/api/trips/${trip.id}`);
    await inPage(a, "POST", `/api/trips/${trip.id}/activities`, { clientId: `Museum-${Math.random()}`, dayId: trip.days[0].id, title: "Museum", kind: "attraction", startMin: 900, durationMin: 60 });
    await b.waitFor(`[...document.querySelectorAll('.timeline .stop h3')].some(e => e.textContent === 'Museum')`, 4000);
    await a.eval(`[...document.querySelectorAll('.trip-bar button')].find(b => b.textContent.includes('Copilot')).click()`); // open the copilot pane
    await a.waitFor(`document.querySelector('.workspace.with-copilot')`, 2000);
    await sleep(300);
    // the copilot's rule-based proposals are compact cards (a class clash once made each a screen tall)
    expect(await a.eval<number>(`Math.max(0, ...[...document.querySelectorAll('.pane-copilot .proposal')].map(e => e.getBoundingClientRect().height))`)).toBeLessThan(400);
    expect(await a.eval<string>(`document.querySelector('[data-testid=copilot-day]').textContent`)).toMatch(/Day 1/);
    expect(await a.eval<string>(phase)).toBe("connected");
    expect(await b.eval<string>(phase)).toBe("connected");
    expect((await inPage(a, "GET", `/api/trips/${trip.id}`)).rev).toBe(before.rev + 1); // only the add counted

    // Mute stops Alice's audio reaching Bob, and Bob sees she's muted.
    await a.click("[data-call=mute]");
    await b.waitFor(`/muted/.test(${callText})`, 4000);
    await sleep(800);
    const muted = await b.eval<{ hz: number; db: number } | null>(receivedHz);
    expect(muted === null || muted.db < -90 || Math.abs(muted.hz - 440) > 15).toBe(true);
    await a.click("[data-call=mute]");
    expect(Math.abs(((await hearsTone(b, 440))?.hz ?? 0) - 440)).toBeLessThanOrEqual(15);

    // Hang up: both sides end, the microphone is released.
    await a.click("[data-call=hangup]");
    await b.waitFor(`${phase} === 'ended'`, 5000);
    expect(await b.eval<string>(callText)).toMatch(/call ended/i);
    expect(await a.eval<boolean>(`!document.querySelector('audio.call-audio')`)).toBe(true);
    expect((await inPage(a, "GET", `/api/trips/${trip.id}/call`)).call).toBeNull();
  });

  it("declining ends the invitation for the caller", async () => {
    const a = await alice!.newPage();
    const b = await bob!.newPage();
    await signUpIn(a, baseUrl, uniqueName("da"));
    await signUpIn(b, baseUrl, uniqueName("db"));
    const trip = await sharedTrip(a, b);
    await open(a, trip.id);
    await open(b, trip.id);
    await a.waitFor(`document.querySelector('[data-call=start]')`, 8000);
    await a.click("[data-call=start]");
    await b.waitFor(`document.querySelector('[data-call=decline]')`, 8000);
    await b.click("[data-call=decline]");
    await a.waitFor(`${phase} === 'ended' && /declined/.test(${callText})`, 5000);
    expect(await a.eval<boolean>(`Boolean(document.querySelector('[data-call=start]'))`)).toBe(true); // can call again
  });

  it("explains a blocked microphone and doesn't start a call", async () => {
    const a = await denied!.newPage();
    const b = await bob!.newPage();
    await signUpIn(a, baseUrl, uniqueName("ma"));
    await signUpIn(b, baseUrl, uniqueName("mb"));
    const trip = await sharedTrip(a, b);
    await a.microphone(new URL(baseUrl).origin, "denied");
    await open(a, trip.id);
    await open(b, trip.id);
    await a.waitFor(`document.querySelector('[data-call=start]')`, 8000);
    await a.click("[data-call=start]");
    await a.waitFor(`/Microphone access was blocked/.test(${callText})`, 5000);
    await sleep(300);
    expect(await b.eval<boolean>(`!document.querySelector('[data-call=accept]')`)).toBe(true); // nobody was rung
    expect((await inPage(a, "GET", `/api/trips/${trip.id}/call`)).call).toBeNull();
  });

  it("offers 'Turn on sound' when the browser blocks playback, and plays after it", async () => {
    const a = await alice!.newPage();
    const b = await bob!.newPage();
    await signUpIn(a, baseUrl, uniqueName("pa"));
    await signUpIn(b, baseUrl, uniqueName("pb"));
    const trip = await sharedTrip(a, b);
    await open(a, trip.id);
    await open(b, trip.id);
    // make this page's first play() fail the way an autoplay block does
    await b.eval(`(() => { const real = HTMLMediaElement.prototype.play; let n = 0; HTMLMediaElement.prototype.play = function () { return n++ === 0 ? Promise.reject(new DOMException('blocked', 'NotAllowedError')) : real.call(this); }; })()`);
    await connect(a, b);
    await b.waitFor(`document.querySelector('[data-call=sound]')`, 5000);
    await b.click("[data-call=sound]");
    await b.waitFor(`!document.querySelector('[data-call=sound]')`, 5000);
    expect(Math.abs(((await hearsTone(b, 440))?.hz ?? 0) - 440)).toBeLessThanOrEqual(15);
    await a.click("[data-call=hangup]");
  });

  it("keeps controls usable on a phone without covering the map or timeline, and survives tab switches", async () => {
    const a = await alice!.newPage();
    const b = await bob!.newPage();
    await signUpIn(a, baseUrl, uniqueName("fa"));
    await signUpIn(b, baseUrl, uniqueName("fb"));
    const trip = await sharedTrip(a, b);
    await open(a, trip.id, 390, 844, true);
    await open(b, trip.id);
    await connect(a, b);
    const r = await a.eval<{ call: DOMRect; bar: DOMRect; ws: DOMRect; hang: DOMRect; vw: number }>(
      `(() => ({ call: document.querySelector('.call').getBoundingClientRect().toJSON(), bar: document.querySelector('.trip-bar').getBoundingClientRect().toJSON(), ws: document.querySelector('.workspace').getBoundingClientRect().toJSON(), hang: document.querySelector('[data-call=hangup]').getBoundingClientRect().toJSON(), vw: innerWidth }))()`,
    );
    expect(r.call.bottom).toBeLessThanOrEqual(r.bar.bottom + 1); // inside the bar, not over the workspace
    expect(r.ws.top).toBeGreaterThanOrEqual(r.bar.bottom - 1);
    expect(r.ws.height).toBeGreaterThan(500); // map/timeline keep most of the screen
    expect(r.hang.right).toBeLessThanOrEqual(r.vw);
    expect(r.hang.height).toBeGreaterThanOrEqual(28);
    expect(await a.eval<number>(`document.documentElement.scrollWidth`)).toBeLessThanOrEqual(390);
    if (SHOTS) await a.screenshot(`${SHOTS}/call-phone-connected.png`);
    for (const t of ["Map", "Copilot", "Plan"]) {
      await a.eval(`[...document.querySelectorAll('.mobile-tabs button')].find(b => b.textContent.includes(${JSON.stringify(t)})).click()`);
      await sleep(150);
      expect(await a.eval<string>(phase)).toBe("connected");
    }
    expect(Math.abs(((await hearsTone(a, 660))?.hz ?? 0) - 660)).toBeLessThanOrEqual(15);
    // leaving the editor ends the call for the other person
    await a.eval(`document.querySelector('a[aria-label="Back to your trips"]').click()`);
    await b.waitFor(`${phase} === 'ended'`, 8000);
  });
});

describe.skipIf(!chromePath)("call recovery and tabs in real browsers", () => {
  it("recovers from a dropped connection with an ICE restart, and ends with Call again when it can't", async () => {
    const a = await alice!.newPage();
    const b = await bob!.newPage();
    await signUpIn(a, baseUrl, uniqueName("ra"));
    await signUpIn(b, baseUrl, uniqueName("rb"));
    const trip = await sharedTrip(a, b);
    await a.viewport(1920, 1080);
    await a.goto(new URL(`/trips/${trip.id}?calldebug&recoverms=3000`, baseUrl).href);
    await a.waitFor(`document.querySelector('.conn-live')`, 10_000);
    await open(b, trip.id);
    await connect(a, b);

    // a drop the network can recover from: the caller restarts ICE and it reconnects
    await a.eval(`window.__wlVoice._simulateDrop()`);
    expect(await a.eval<string>(phase)).toBe("reconnecting");
    expect(await a.eval<string>(callText)).toMatch(/Reconnecting/);
    await a.waitFor(`${phase} === 'connected'`, 8000);
    expect(Math.abs(((await hearsTone(b, 440))?.hz ?? 0) - 440)).toBeLessThanOrEqual(15);

    // a drop it can't: bounded wait, then a clear end and a way to call again, for both
    await a.eval(`window.__wlVoice._breakMedia()`);
    await a.waitFor(`${phase} === 'ended'`, 8000);
    expect(await a.eval<string>(callText)).toMatch(/couldn't be recovered/);
    expect(await a.eval<string>(callText)).toMatch(/Call again/);
    await b.waitFor(`${phase} === 'ended'`, 5000);
    expect(await a.eval<boolean>(`!document.querySelector('audio.call-audio')`)).toBe(true);
  });

  it("one account in two tabs: both ring, one answers, the other shows the call elsewhere with no second microphone", async () => {
    const a = await alice!.newPage();
    const b1 = await bob!.newPage();
    await signUpIn(a, baseUrl, uniqueName("ta"));
    await signUpIn(b1, baseUrl, uniqueName("tb"));
    const trip = await sharedTrip(a, b1);
    // Bob's second tab: a separate page signed in to the same account
    const b2 = await bob!.newPage();
    await b2.goto(new URL("/readme/", baseUrl).href);
    const bobName = await b1.eval<string>(`fetch('/api/auth/me').then(r => r.json()).then(d => d.user.username)`);
    await b2.eval(`fetch("/api/auth/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: ${JSON.stringify(bobName)}, password: "correct horse battery" }) })`);
    await open(a, trip.id);
    await open(b1, trip.id);
    await open(b2, trip.id);
    expect(await a.eval<string>(`document.querySelector('.presence-label').textContent`)).toMatch(/2 people/); // one person, not three

    await a.click("[data-call=start]");
    await b1.waitFor(`document.querySelector('[data-call=accept]')`, 8000);
    await b2.waitFor(`document.querySelector('[data-call=accept]')`, 8000);
    await b1.click("[data-call=accept]");
    await a.waitFor(`${phase} === 'connected'`, 15_000);
    await b2.waitFor(`/another tab/.test(${callText})`, 5000);
    expect(await b2.eval<boolean>(`!document.querySelector('[data-call=mute]') && !document.querySelector('audio.call-audio')`)).toBe(true);
    expect(await b2.eval<unknown>(`window.__wlVoice._debug().tracks`)).toBeNull(); // no microphone opened here
    await a.click("[data-call=hangup]");
    await b2.waitFor(`!/another tab/.test(${callText})`, 5000);
  });
});

describe.skipIf(!chromePath)("forced relay without TURN", () => {
  it("says no relay is configured instead of connecting directly or hanging", async () => {
    const a = await alice!.newPage();
    const b = await bob!.newPage();
    await signUpIn(a, baseUrl, uniqueName("na"));
    await signUpIn(b, baseUrl, uniqueName("nb"));
    const trip = await sharedTrip(a, b);
    await a.viewport(1920, 1080);
    await a.goto(new URL(`/trips/${trip.id}?calldebug&relay=1`, baseUrl).href);
    await a.waitFor(`document.querySelector('.conn-live')`, 10_000);
    await open(b, trip.id);
    await a.click("[data-call=start]");
    await b.waitFor(`document.querySelector('[data-call=accept]')`, 8000);
    await b.click("[data-call=accept]");
    await a.waitFor(`/no TURN relay is configured/.test(${callText})`, 10_000);
    await b.waitFor(`${phase} === 'ended'`, 5000);
    expect(await a.eval<boolean>(`!document.querySelector('audio.call-audio')`)).toBe(true);
  });

  it("shows the selected route and media counters in debug mode", async () => {
    const a = await alice!.newPage();
    const b = await bob!.newPage();
    await signUpIn(a, baseUrl, uniqueName("ga"));
    await signUpIn(b, baseUrl, uniqueName("gb"));
    const trip = await sharedTrip(a, b);
    await open(a, trip.id);
    await open(b, trip.id);
    await connect(a, b);
    await a.waitFor(`/host↔host · in [1-9]\\d* KB/.test(document.querySelector('[data-call=diag]')?.textContent ?? '')`, 8000);
    expect(await a.eval<string>(`document.querySelector('[data-call=diag]').textContent`)).toMatch(/no TURN/);
    await a.click("[data-call=hangup]");
  });
});
