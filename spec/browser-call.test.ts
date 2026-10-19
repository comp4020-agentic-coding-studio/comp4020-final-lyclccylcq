import { mkdirSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, inject, it, vi } from "vitest";
import { chromePath, inPage, launch, type Page, signUpIn, sleep, toneWav } from "./browser.ts";
import { uniqueName } from "./helpers.ts";

// Voice calls in two real, separate browsers (ADR 0004). Each browser's
// fake microphone plays its own tone (440 Hz and 660 Hz); a call only
// passes if each side measures the *other* side's frequency in the stream
// its call window plays. A "Connected" label alone isn't evidence, and
// neither are packet counters. Separately, the <audio> element itself must
// be playing that stream: unpaused, unmuted, with its clock advancing.
// Chrome's autoplay rules are left on (spec/browser.ts), so a call whose
// sound never starts fails here. Both browsers are on this machine, so this
// proves signalling, negotiation, media and playback, not NAT traversal,
// TURN, or that a person heard speech (see ADR 0004).
const baseUrl = inject("baseUrl");
vi.setConfig({ testTimeout: 60_000, hookTimeout: 45_000 });
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

// The strongest frequency in the stream this page's call window plays.
const receivedHz = `(async () => {
  const el = document.querySelector('audio.call-audio');
  if (!el || !el.srcObject || !el.srcObject.getAudioTracks().length) return null;
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
// The element really playing: not paused or muted, audible volume, and its
// clock moving over half a second.
const elementPlays = `(async () => {
  const el = document.querySelector('audio.call-audio');
  if (!el || !el.isConnected || !el.srcObject) return { ok: false, why: 'no element or stream' };
  const t0 = el.currentTime;
  await new Promise(r => setTimeout(r, 500));
  const r = { paused: el.paused, muted: el.muted, volume: el.volume, readyState: el.readyState, advanced: +(el.currentTime - t0).toFixed(2), tracks: el.srcObject.getAudioTracks().length };
  return { ...r, ok: !r.paused && !r.muted && r.volume > 0 && r.readyState >= 2 && r.advanced > 0.2 && r.tracks > 0 };
})()`;
const phase = `(document.querySelector('.call-card')?.dataset.phase ?? null)`;
const cardText = `(document.querySelector('.call-card')?.innerText ?? '')`;
const mic = `window.__wlVoice._debug().tracks`;

async function sharedTrip(owner: Page, guest: Page) {
  const trip = await inPage(owner, "POST", "/api/trips", { title: "Call trip", destination: "Sydney", startDate: "2026-12-01", endDate: "2026-12-02", timezone: "Australia/Sydney" });
  for (const [title, startMin] of [["Zoo", 540], ["Lunch", 600]] as const) {
    await inPage(owner, "POST", `/api/trips/${trip.id}/activities`, { clientId: `${title}-${Math.random()}`, dayId: trip.days[0].id, title, kind: "attraction", startMin, durationMin: 120 });
  }
  const { token } = await inPage(owner, "POST", `/api/trips/${trip.id}/invite`, {});
  const asked = await inPage(guest, "POST", `/api/invites/${token}/request`, {});
  await inPage(owner, "POST", `/api/trips/${trip.id}/requests/${asked.requestId}/approve`, {});
  return trip;
}

async function open(page: Page, tripId: string, w = 1920, h = 1080, mobile = false, query = "calldebug") {
  await page.viewport(w, h, mobile);
  await page.goto(new URL(`/trips/${tripId}?${query}`, baseUrl).href);
  await page.waitFor(`document.querySelector('.conn-live')`, 10_000);
}

// Real clicks on Call and Accept: they're the gestures playback relies on.
async function connect(a: Page, b: Page) {
  await a.waitFor(`document.querySelector('[data-call=start]')`, 8000);
  await a.tap("[data-call=start]");
  await b.waitFor(`document.querySelector('[data-call=accept]')`, 8000);
  expect(await b.eval<string>(cardText)).toMatch(/Incoming/);
  expect(await a.eval<string>(phase)).toBe("outgoing");
  await b.tap("[data-call=accept]");
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
const expectTone = async (p: Page, hz: number) => expect(Math.abs(((await hearsTone(p, hz))?.hz ?? 0) - hz)).toBeLessThanOrEqual(15);
const expectPlaying = async (p: Page) => {
  let r: any;
  for (let i = 0; i < 6; i++) {
    r = await p.eval(elementPlays);
    if (r.ok) break;
    await sleep(300);
  }
  expect(r, JSON.stringify(r)).toMatchObject({ ok: true });
};

describe.skipIf(!chromePath)("voice calls in two real browsers", () => {
  it("connects, carries and plays each person's audio, and keeps it through edits, panels, mute and minimize", async () => {
    const a = await alice!.newPage();
    const b = await bob!.newPage();
    await signUpIn(a, baseUrl, uniqueName("ca"));
    await signUpIn(b, baseUrl, uniqueName("cb"));
    const trip = await sharedTrip(a, b);
    await open(a, trip.id);
    await open(b, trip.id);
    await connect(a, b);

    // Bob receives and plays Alice's 440 Hz; Alice receives and plays Bob's 660 Hz.
    await expectTone(b, 440);
    await expectTone(a, 660);
    await expectPlaying(a);
    await expectPlaying(b);
    // the window shows who, the state and a running timer
    const text = await a.eval<string>(cardText);
    expect(text).toMatch(/Connected · 0:\d\d/);
    expect(text).not.toMatch(/false|undefined|null|NaN/);
    // the level meters are measured, not animated: they read the tone
    await a.waitFor(`Number(document.querySelector('[data-call=level-peer]').dataset.level) > 0.003`, 4000);
    if (SHOTS) await a.screenshot(`${SHOTS}/call-desktop-connected.png`);

    // An edit arrives as a snapshot; the planning assistant opens; nothing touches the call.
    const before = await inPage(a, "GET", `/api/trips/${trip.id}`);
    const audioId = await a.eval<string>(`(window.__audioEl = document.querySelector('audio.call-audio'), 'ok')`);
    expect(audioId).toBe("ok");
    await inPage(b, "POST", `/api/trips/${trip.id}/activities`, { clientId: `Museum-${Math.random()}`, dayId: trip.days[0].id, title: "Museum", kind: "attraction", startMin: 900, durationMin: 60 });
    await a.waitFor(`[...document.querySelectorAll('.timeline .stop h3')].some(e => e.textContent === 'Museum')`, 4000);
    await a.eval(`[...document.querySelectorAll('.trip-bar button')].find(b => b.textContent.includes('Assistant')).click()`);
    await a.waitFor(`document.querySelector('.workspace.with-copilot')`, 2000);
    await sleep(300);
    expect(await a.eval<number>(`Math.max(0, ...[...document.querySelectorAll('.pane-copilot .proposal')].map(e => e.getBoundingClientRect().height))`)).toBeLessThan(400);
    expect(await a.eval<string>(`document.querySelector('[data-testid=copilot-day]').textContent`)).toMatch(/Day 1/);
    expect(await a.eval<boolean>(`document.querySelector('audio.call-audio') === window.__audioEl`)).toBe(true); // the same element, never recreated
    expect(await a.eval<string>(phase)).toBe("connected");
    await expectPlaying(a);
    await expectTone(a, 660);
    expect((await inPage(a, "GET", `/api/trips/${trip.id}`)).rev).toBe(before.rev + 1); // only the add counted

    // Mute: Alice's track is disabled, Bob is told and gets silence; unmute brings her back.
    await a.tap("[data-call=mute]");
    expect(await a.eval<any>(mic)).toEqual([{ enabled: false, state: "live" }]);
    await b.waitFor(`/muted their microphone/.test(${cardText})`, 4000);
    await sleep(800);
    const muted = await b.eval<{ hz: number; db: number } | null>(receivedHz);
    expect(muted === null || muted.db < -90 || Math.abs(muted.hz - 440) > 15).toBe(true);
    await expectPlaying(b); // silence is still playing, not a broken element
    await a.tap("[data-call=mute]");
    expect(await a.eval<any>(mic)).toEqual([{ enabled: true, state: "live" }]);
    await expectTone(b, 440);

    // Minimize keeps the call and a compact bar with mute and hang up; an
    // update doesn't restore it; Restore brings the full window back.
    await a.tap("[data-call=minimize]");
    await a.waitFor(`document.querySelector('.call-card.is-mini')`, 2000);
    expect(await a.eval<boolean>(`Boolean(document.querySelector('.call-card [data-call=mute]') && document.querySelector('.call-card [data-call=hangup]'))`)).toBe(true);
    await inPage(b, "POST", `/api/trips/${trip.id}/activities`, { clientId: `Bar-${Math.random()}`, dayId: trip.days[0].id, title: "Bar", kind: "food", startMin: 1200, durationMin: 60 });
    await a.waitFor(`[...document.querySelectorAll('.timeline .stop h3')].some(e => e.textContent === 'Bar')`, 4000);
    expect(await a.eval<boolean>(`Boolean(document.querySelector('.call-card.is-mini'))`)).toBe(true);
    await expectPlaying(a);
    await expectTone(a, 660);
    if (SHOTS) await a.screenshot(`${SHOTS}/call-desktop-minimized.png`);
    await a.tap("[data-call=restore]");
    await a.waitFor(`!document.querySelector('.call-card.is-mini') && document.querySelector('.call-card [data-call=minimize]')`, 2000);

    // Hang up: both sides end, the microphone is stopped, the element emptied.
    await a.tap("[data-call=hangup]");
    await b.waitFor(`${phase} === 'ended'`, 5000);
    expect(await b.eval<string>(cardText)).toMatch(/call ended/i);
    expect(await a.eval<unknown>(mic)).toBeNull();
    expect(await a.eval<any>(`window.__wlVoice._debug().audio`)).toMatchObject({ paused: true, hasStream: false, remoteTracks: [] });
    expect(await a.eval<boolean>(`[...document.querySelectorAll('audio')].length === 1`)).toBe(true); // no leftover elements
    expect((await inPage(a, "GET", `/api/trips/${trip.id}/call`)).call).toBeNull();
  });

  it("holds an offer that arrives before this tab's connection is ready (a slow ICE fetch), and still connects with sound", async () => {
    const a = await alice!.newPage();
    const b = await bob!.newPage();
    await signUpIn(a, baseUrl, uniqueName("sa"));
    await signUpIn(b, baseUrl, uniqueName("sb"));
    const trip = await sharedTrip(a, b);
    await open(a, trip.id);
    await open(b, trip.id);
    // the callee's ICE servers come back late, so the caller's offer beats its peer connection
    await b.eval(`(() => { const f = window.fetch; window.fetch = async (u, o) => { if (String(u).endsWith('/call/ice')) await new Promise(r => setTimeout(r, 1500)); return f(u, o); }; })()`);
    await connect(a, b);
    await expectTone(b, 440);
    await expectTone(a, 660);
    await expectPlaying(b);
    await a.tap("[data-call=hangup]");
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
    await a.tap("[data-call=start]");
    await a.waitFor(`${phase} === 'outgoing' && /Calling/.test(${cardText})`, 4000); // the window opens at once
    await b.waitFor(`document.querySelector('[data-call=decline]')`, 8000);
    // an incoming call is announced, without taking focus from what Bob was doing
    expect(await b.eval<string>(`document.querySelector('.call-card').getAttribute('aria-label')`)).toBe("Voice call");
    expect(await b.eval<boolean>(`!document.querySelector('.call-card').contains(document.activeElement)`)).toBe(true);
    await b.tap("[data-call=decline]");
    await a.waitFor(`${phase} === 'ended' && /declined/.test(${cardText})`, 5000);
    expect(await a.eval<boolean>(`Boolean(document.querySelector('[data-call=start]'))`)).toBe(true); // can call again
    expect(await a.eval<unknown>(mic)).toBeNull();
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
    await a.tap("[data-call=start]");
    await a.waitFor(`/Microphone access was blocked/.test(${cardText})`, 5000);
    await sleep(300);
    expect(await b.eval<boolean>(`!document.querySelector('[data-call=accept]')`)).toBe(true); // nobody was rung
    expect((await inPage(a, "GET", `/api/trips/${trip.id}/call`)).call).toBeNull();
  });

  it("when the browser refuses to play, says so in the window, and a real click on Turn on sound starts playback", async () => {
    const a = await alice!.newPage();
    const b = await bob!.newPage();
    await signUpIn(a, baseUrl, uniqueName("pa"));
    await signUpIn(b, baseUrl, uniqueName("pb"));
    const trip = await sharedTrip(a, b);
    await open(a, trip.id);
    await open(b, trip.id);
    // Headless Chrome allows playback while the microphone is in use, so the
    // refusal is simulated: play() fails unless a real gesture is active,
    // and Bob answers with a synthetic click, which isn't one.
    await b.eval(`(() => {
      const real = HTMLMediaElement.prototype.play;
      HTMLMediaElement.prototype.play = function () {
        return navigator.userActivation.isActive ? real.call(this) : Promise.reject(new DOMException('blocked', 'NotAllowedError'));
      };
    })()`);
    await a.waitFor(`document.querySelector('[data-call=start]')`, 8000);
    await a.tap("[data-call=start]");
    await b.waitFor(`document.querySelector('[data-call=accept]')`, 8000);
    await b.click("[data-call=accept]"); // synthetic: no user activation
    await a.waitFor(`${phase} === 'connected'`, 15_000);
    await b.waitFor(`document.querySelector('[data-call=sound]')`, 6000);
    expect(await b.eval<string>(cardText)).toMatch(/blocked the sound/);
    expect((await b.eval<any>(elementPlays)).ok).toBe(false); // honest: not playing yet
    if (SHOTS) await b.screenshot(`${SHOTS}/call-desktop-blocked.png`);
    await b.tap("[data-call=sound]"); // a real click calls play() directly
    await b.waitFor(`!document.querySelector('[data-call=sound]')`, 5000);
    await expectPlaying(b);
    await expectTone(b, 440);
    await a.tap("[data-call=hangup]");
  });

  it("on a phone: a bottom call panel above the tabs, reachable controls, no overflow, and sound through tab switches", async () => {
    const a = await alice!.newPage();
    const b = await bob!.newPage();
    await signUpIn(a, baseUrl, uniqueName("fa"));
    await signUpIn(b, baseUrl, uniqueName("fb"));
    const trip = await sharedTrip(a, b);
    await open(a, trip.id, 390, 844, true);
    await open(b, trip.id);
    await connect(a, b);
    const r = await a.eval<{ card: DOMRect; tabs: DOMRect; hang: DOMRect; mute: DOMRect; vw: number; sw: number }>(
      `(() => ({ card: document.querySelector('.call-card').getBoundingClientRect().toJSON(), tabs: document.querySelector('.mobile-tabs').getBoundingClientRect().toJSON(), hang: document.querySelector('[data-call=hangup]').getBoundingClientRect().toJSON(), mute: document.querySelector('[data-call=mute]').getBoundingClientRect().toJSON(), vw: innerWidth, sw: document.documentElement.scrollWidth }))()`,
    );
    expect(r.card.bottom).toBeLessThanOrEqual(r.tabs.top + 1); // above the Map/Plan/Assistant tabs
    expect(r.card.left).toBeGreaterThanOrEqual(0);
    expect(r.card.right).toBeLessThanOrEqual(r.vw);
    expect(r.hang.height).toBeGreaterThanOrEqual(44);
    expect(r.mute.height).toBeGreaterThanOrEqual(44);
    expect(r.sw).toBeLessThanOrEqual(390);
    if (SHOTS) await a.screenshot(`${SHOTS}/call-phone-connected.png`);
    for (const t of ["Map", "Assistant", "Plan"]) {
      await a.eval(`[...document.querySelectorAll('.mobile-tabs button')].find(b => b.textContent.includes(${JSON.stringify(t)})).click()`);
      await sleep(150);
      expect(await a.eval<string>(phase)).toBe("connected");
    }
    await expectPlaying(a);
    await expectTone(a, 660);
    // minimized on a phone: one compact bar, still above the tabs
    await a.tap("[data-call=minimize]");
    const m = await a.eval<{ card: DOMRect; tabs: DOMRect }>(`(() => ({ card: document.querySelector('.call-card').getBoundingClientRect().toJSON(), tabs: document.querySelector('.mobile-tabs').getBoundingClientRect().toJSON() }))()`);
    expect(m.card.height).toBeLessThan(80);
    expect(m.card.bottom).toBeLessThanOrEqual(m.tabs.top + 1);
    if (SHOTS) await a.screenshot(`${SHOTS}/call-phone-minimized.png`);
    // leaving the editor ends the call for the other person and stops the microphone
    await a.eval(`document.querySelector('a[aria-label="Back to your trips"]').click()`);
    await b.waitFor(`${phase} === 'ended'`, 8000);
    expect(await a.eval<number>(`document.querySelectorAll('.call-card, audio.call-audio').length`)).toBe(0);
  });
});

describe.skipIf(!chromePath)("call recovery and tabs in real browsers", () => {
  it("recovers from a dropped connection with an ICE restart, and ends with Call again when it can't", async () => {
    const a = await alice!.newPage();
    const b = await bob!.newPage();
    await signUpIn(a, baseUrl, uniqueName("ra"));
    await signUpIn(b, baseUrl, uniqueName("rb"));
    const trip = await sharedTrip(a, b);
    await open(a, trip.id, 1920, 1080, false, "calldebug&recoverms=3000");
    await open(b, trip.id);
    await connect(a, b);

    // a drop the network can recover from: the caller restarts ICE and it reconnects
    await a.eval(`window.__wlVoice._simulateDrop()`);
    expect(await a.eval<string>(phase)).toBe("reconnecting");
    expect(await a.eval<string>(cardText)).toMatch(/Reconnecting/);
    await a.waitFor(`${phase} === 'connected'`, 8000);
    await expectTone(b, 440);

    // a drop it can't: bounded wait, then a clear end and a way to call again, for both
    await a.eval(`window.__wlVoice._breakMedia()`);
    await a.waitFor(`${phase} === 'ended'`, 8000);
    expect(await a.eval<string>(cardText)).toMatch(/couldn't be recovered/);
    expect(await a.eval<string>(cardText)).toMatch(/Call again/);
    await b.waitFor(`${phase} === 'ended'`, 5000);
    expect(await a.eval<unknown>(mic)).toBeNull();
  });

  // On one machine media never really breaks, so the caller's connection is
  // made to read as failed until an ICE restart is actually re-negotiated
  // (an answer to a new offer); recovery must come from that, not luck.
  const brokenUntilRestart = `(() => {
    const pc = window.__wlVoice._pc(); window.__fixed = false; window.__offers = 0;
    const conn = Object.getOwnPropertyDescriptor(RTCPeerConnection.prototype, 'connectionState');
    const ice = Object.getOwnPropertyDescriptor(RTCPeerConnection.prototype, 'iceConnectionState');
    // fixed only by an answer that arrives while the page is online again
    pc.addEventListener('signalingstatechange', () => { if (pc.signalingState === 'have-local-offer') window.__offers++; if (pc.signalingState === 'stable' && pc.remoteDescription?.type === 'answer' && window.__offers > 0 && window.__back) window.__fixed = true; });
    Object.defineProperty(pc, 'connectionState', { configurable: true, get: () => window.__fixed ? conn.get.call(pc) : 'failed' });
    Object.defineProperty(pc, 'iceConnectionState', { configurable: true, get: () => window.__fixed ? ice.get.call(pc) : 'failed' });
  })()`;

  for (const who of ["caller", "callee"] as const) {
    it(`keeps retrying through a network outage on the ${who}'s side and reconnects when it's back`, async () => {
      const a = await alice!.newPage();
      const b = await bob!.newPage();
      await signUpIn(a, baseUrl, uniqueName("oa"));
      await signUpIn(b, baseUrl, uniqueName("ob"));
      const trip = await sharedTrip(a, b);
      await open(a, trip.id);
      await open(b, trip.id);
      await connect(a, b);
      const victim = who === "caller" ? a : b;
      await a.eval(brokenUntilRestart);
      await victim.offline(true); // its signalling and event stream are gone; every offer or request sent now is lost
      await a.eval(`window.__wlVoice._simulateDrop()`);
      await sleep(8000); // longer than the old single-attempt window, and well past the first retries
      expect(await a.eval<string>(phase)).toBe("reconnecting");
      expect(await b.eval<string>(phase)).not.toBe("ended");
      if (who === "caller") expect(await a.eval<number>(`window.__offers`)).toBeGreaterThan(1); // retried, not one attempt
      await victim.offline(false);
      await a.eval(`window.__back = true`);
      await a.waitFor(`window.__fixed && ${phase} === 'connected'`, 8000);
      await b.waitFor(`${phase} === 'connected'`, 8000);
      await expectTone(b, 440);
      await expectTone(a, 660);
      await a.tap("[data-call=hangup]");
    });
  }

  it("rides out a short blip without saying Reconnecting", async () => {
    const a = await alice!.newPage();
    const b = await bob!.newPage();
    await signUpIn(a, baseUrl, uniqueName("ba"));
    await signUpIn(b, baseUrl, uniqueName("bb"));
    const trip = await sharedTrip(a, b);
    await open(a, trip.id);
    await open(b, trip.id);
    await connect(a, b);
    // "disconnected" for a second, then back: ICE often repairs this itself
    await a.eval(`(() => {
      const pc = window.__wlVoice._pc();
      const conn = Object.getOwnPropertyDescriptor(RTCPeerConnection.prototype, 'connectionState');
      let blip = true;
      Object.defineProperty(pc, 'connectionState', { configurable: true, get: () => blip ? 'disconnected' : conn.get.call(pc) });
      pc.onconnectionstatechange();
      setTimeout(() => { blip = false; pc.onconnectionstatechange(); }, 1000);
    })()`);
    const seen = new Set<string>();
    for (let i = 0; i < 20; i++) {
      seen.add(await a.eval<string>(phase));
      await sleep(100);
    }
    expect([...seen]).toEqual(["connected"]);
    await a.tap("[data-call=hangup]");
  });

  it("one account in two tabs: both ring, one answers, the other shows the call elsewhere with no second microphone", async () => {
    const a = await alice!.newPage();
    const b1 = await bob!.newPage();
    await signUpIn(a, baseUrl, uniqueName("ta"));
    await signUpIn(b1, baseUrl, uniqueName("tb"));
    const trip = await sharedTrip(a, b1);
    const b2 = await bob!.newPage();
    await b2.goto(new URL("/readme/", baseUrl).href);
    const bobName = await b1.eval<string>(`fetch('/api/auth/me').then(r => r.json()).then(d => d.user.username)`);
    await b2.eval(`fetch("/api/auth/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: ${JSON.stringify(bobName)}, password: "correct horse battery" }) })`);
    await open(a, trip.id);
    await open(b1, trip.id);
    await open(b2, trip.id);
    expect(await a.eval<string>(`document.querySelector('.presence-label').textContent`)).toMatch(/2 people/);

    await a.tap("[data-call=start]");
    await b1.waitFor(`document.querySelector('[data-call=accept]')`, 8000);
    await b2.waitFor(`document.querySelector('[data-call=accept]')`, 8000);
    await b1.tap("[data-call=accept]");
    await a.waitFor(`${phase} === 'connected'`, 15_000);
    const bar = `document.querySelector('.trip-bar .call')?.textContent ?? ''`;
    await b2.waitFor(`/another tab/.test(${bar})`, 5000);
    expect(await b2.eval<boolean>(`document.querySelector('.call-card').hidden && !document.querySelector('[data-call=mute]')`)).toBe(true);
    expect(await b2.eval<unknown>(mic)).toBeNull(); // no microphone opened here
    await a.tap("[data-call=hangup]");
    await b2.waitFor(`!/another tab/.test(${bar})`, 5000);
  });
});

// These need a server without TURN, as `pnpm check` runs it (CLAUDE.md).
describe.skipIf(!chromePath)("forced relay without TURN", () => {
  it("says no relay is configured instead of connecting directly or hanging", async () => {
    const a = await alice!.newPage();
    const b = await bob!.newPage();
    await signUpIn(a, baseUrl, uniqueName("na"));
    await signUpIn(b, baseUrl, uniqueName("nb"));
    const trip = await sharedTrip(a, b);
    await open(a, trip.id, 1920, 1080, false, "calldebug&relay=1");
    await open(b, trip.id);
    await a.tap("[data-call=start]");
    await b.waitFor(`document.querySelector('[data-call=accept]')`, 8000);
    await b.tap("[data-call=accept]");
    await a.waitFor(`/no TURN relay is configured/.test(${cardText})`, 10_000);
    await b.waitFor(`${phase} === 'ended'`, 5000);
    expect(await a.eval<unknown>(mic)).toBeNull();
  });

  it("keeps connection details behind debug mode: route, counters and codec", async () => {
    const a = await alice!.newPage();
    const b = await bob!.newPage();
    await signUpIn(a, baseUrl, uniqueName("ga"));
    await signUpIn(b, baseUrl, uniqueName("gb"));
    const trip = await sharedTrip(a, b);
    await open(a, trip.id);
    await open(b, trip.id, 1920, 1080, false, "nodebug");
    await connect(a, b);
    await a.waitFor(`/host↔host · in [1-9]\\d* KB.*opus/.test(document.querySelector('[data-call=diag]')?.textContent ?? '')`, 8000);
    expect(await a.eval<string>(`document.querySelector('[data-call=diag]').textContent`)).toMatch(/no TURN/);
    expect(await a.eval<boolean>(`!document.querySelector('.call-debug').open`)).toBe(true); // collapsed
    expect(await b.eval<boolean>(`!document.querySelector('.call-debug')`)).toBe(true); // ordinary users don't see it
    await a.tap("[data-call=hangup]");
  });
});
