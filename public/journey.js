// The homepage's journey hero: its plan and arithmetic, kept free of the DOM
// so it can be tested. Which scene or transition a moment of playback shows,
// how the window and each photo are laid out at a given size, and the
// playback state machine (one clock, paused and resumed, restarted by a
// destination button). The renderer (journey-hero.js) only draws what these
// say. Scrolling the page has nothing to do with any of it.

// Each scene is one real photograph (public/img/train/CREDITS.md), shown
// whole, as a single layer, never tiled: repeating a photo of a city would
// duplicate its landmarks, and cutting it into strips that move at
// different speeds tears whatever crosses the cut. Instead the photo pans
// within its own edges and is scaled so it always covers the glass with
// room to pan.
//   w, h    the photo's pixel size
//   focus   picture x (0..1) at the window's centre in the middle of the
//           scene's stretch: the landmark (`phoneFocus` on a narrow window)
//   pan     how far the view drifts across the scene's whole stretch, in
//           glass widths: the scene's only motion, a slow camera drift within
//           the photo, never past its edges
//   ay, gy  photo row `ay` (0..1, the horizon or the skyline's base) sits at
//           glass row `gy` (0..1); the photo grows if that would leave any
//           of the glass uncovered
//   tip     (optional) the photo row of the landmark's top, which must stay
//           inside the glass (checked in spec/journey.test.ts)
//   phoneZoom (optional) how much closer a phone's narrow window looks, for
//           a skyline that's a thin band across a wide panorama
// `explore` is the curated itinerary the hero's button opens; without one,
// `search` is where the homepage's map search goes instead.
export const SCENES = [
  {
    id: "switzerland",
    name: "Switzerland",
    subtitle: "Through the Alps",
    explore: null,
    search: { label: "Bernese Oberland, Switzerland", lat: 46.7296, lng: 7.9614 },
    night: false,
    photo: { w: 4400, h: 1564, focus: 0.5, pan: 0.34, ay: 0.58, gy: 0.52 },
    place: "Lake Brienz from Oberried, Bernese Oberland",
    alt: "Through a window: Lake Brienz in the Swiss Alps, a lakeside village below snow-capped peaks.",
  },
  {
    id: "london",
    name: "London",
    subtitle: "Across the Thames",
    explore: "/itineraries/london-royal-riverside",
    night: false,
    photo: { w: 4600, h: 1641, focus: 0.36, phoneFocus: 0.52, phoneZoom: 2, pan: 0.3, ay: 0.76, gy: 0.68 },
    place: "The Thames from Hungerford Bridge: the London Eye and Westminster",
    alt: "Through a window: the Thames, with the London Eye, Westminster Bridge and Big Ben.",
  },
  {
    id: "sydney",
    name: "Sydney",
    subtitle: "Around the harbour",
    explore: "/itineraries/sydney-harbour-highlights",
    night: false,
    // a very wide panorama (4.1:1): the view drifts from the city towers
    // towards the Opera House and the Harbour Bridge
    photo: { w: 5200, h: 1268, focus: 0.5, phoneFocus: 0.6, phoneZoom: 1.5, pan: 0.34, ay: 0.64, gy: 0.62, tip: 0.36 },
    place: "Sydney Harbour from Yurong Point: the city, the Opera House and the Harbour Bridge",
    alt: "Through a window: Sydney Harbour on a summer day, the city's towers, the Opera House and the Harbour Bridge across the water.",
  },
  {
    id: "maldives",
    name: "Maldives",
    subtitle: "Island in the lagoon",
    explore: null,
    search: { label: "Maldives", lat: 4.1755, lng: 73.5093 },
    night: false,
    // symmetrical round its jetty, so the view drifts only a little
    photo: { w: 4000, h: 1840, focus: 0.5, phoneZoom: 1.8, pan: 0.16, ay: 0.66, gy: 0.6, tip: 0.5 },
    place: "Thudufushi, Ari Atoll, from its jetty",
    alt: "Through a window: a small palm-covered island with white sand in a turquoise lagoon, a wooden jetty leading to it.",
  },
  {
    id: "shanghai",
    name: "Shanghai",
    subtitle: "Night on the Huangpu",
    explore: "/itineraries/shanghai-bund-gardens",
    night: true,
    // the Pearl Tower is 0.4 of the photo's width tall, so a wider drift
    // would scale it past the window's top: this view moves least
    photo: { w: 3840, h: 1920, focus: 0.5, phoneFocus: 0.33, pan: 0.1, ay: 0.86, gy: 0.93, tip: 0.06 },
    place: "Pudong from the Bund",
    alt: "Through a window at night: the Pudong skyline across the Huangpu, with the Oriental Pearl Tower and Shanghai Tower lit up.",
  },
];

// Every photograph in the hero, credited on the window while it shows and
// on /credits. Details in public/img/train/CREDITS.md.
export const CREDITS = [
  { scene: "switzerland", title: "Panorama of Brienzersee", author: "Nicojonesgodel", license: "CC BY-SA 4.0", licenseUrl: "https://creativecommons.org/licenses/by-sa/4.0", page: "https://commons.wikimedia.org/wiki/File:Panorama_of_Brienzersee.jpg" },
  { scene: "london", title: "Thames Panorama, London - May 2009", author: "Diliff", license: "CC BY-SA 3.0", licenseUrl: "https://creativecommons.org/licenses/by-sa/3.0", page: "https://commons.wikimedia.org/wiki/File:Thames_Panorama,_London_-_May_2009.jpg" },
  { scene: "sydney", title: "Sydney (AU), View from Yurong -- 2019 -- 3096-101", author: "Dietmar Rabich", license: "CC BY-SA 4.0", licenseUrl: "https://creativecommons.org/licenses/by-sa/4.0", page: "https://commons.wikimedia.org/wiki/File:Sydney_(AU),_View_from_Yurong_--_2019_--_3096-101.jpg" },
  { scene: "maldives", title: "Diamonds Thudufushi Beach and Water Villas, May 2017 -08", author: "Martin Falbisoner", license: "CC BY-SA 4.0", licenseUrl: "https://creativecommons.org/licenses/by-sa/4.0", page: "https://commons.wikimedia.org/wiki/File:Diamonds_Thudufushi_Beach_and_Water_Villas,_May_2017_-08.jpg" },
  { scene: "shanghai", title: "Pudong Shanghai November 2017 HDR panorama", author: "King of Hearts", license: "CC BY-SA 4.0", licenseUrl: "https://creativecommons.org/licenses/by-sa/4.0", page: "https://commons.wikimedia.org/wiki/File:Pudong_Shanghai_November_2017_HDR_panorama.jpg" },
];

// What joins scene i to the next (the last back to the first): always a
// short tunnel. The window is never shown two photos at once: a soft dark
// wall covers the glass, the scene changes while it's dark, and the view
// opens onto the next place. The journey is symbolic: no railway runs to
// the Maldives, and the window doesn't pretend one does.
export const TRANSITIONS = SCENES.map(() => ({ kind: "tunnel" }));

// Seconds: each destination holds, then the transition to the next.
export const TIMING = { hold: 8.4, move: 1.8 };
const STEP = TIMING.hold + TIMING.move;
export const CYCLE = STEP * SCENES.length;

export const clamp01 = (v) => Math.min(1, Math.max(0, Number.isFinite(v) ? v : 0));
// Adding a whole cycle to positive times loses precision at scene starts:
// a selected scene could round back into the previous transition.
const wrap = (t) => {
  const value = t % CYCLE;
  return value < 0 ? value + CYCLE : value;
};

// when scene i's hold begins, in playback seconds within one cycle
export function sceneStart(i) {
  if (!Number.isInteger(i) || i < 0 || i >= SCENES.length) throw new RangeError(`no scene ${i}`);
  return i * STEP;
}

// What playback time `clock` shows. The journey loops: after the last
// scene, its transition leads back to the first. `t` is how far through
// the segment (0..1); `label` is the destination to name: the one being
// left until halfway through a transition, then the one ahead.
export function stateAt(clock) {
  const c = wrap(Number.isFinite(clock) ? clock : 0);
  const scene = Math.min(SCENES.length - 1, Math.floor(c / STEP));
  const into = c - scene * STEP;
  if (into < TIMING.hold) return { kind: "scene", scene, next: scene, t: into / TIMING.hold, label: scene };
  const next = (scene + 1) % SCENES.length;
  const t = clamp01((into - TIMING.hold) / TIMING.move);
  return { kind: TRANSITIONS[scene].kind, scene, next, t, label: t < 0.5 ? scene : next };
}

// How far through its own stretch scene i's view is at `clock`: -1 at the
// start of the transition before it, 0 in the middle of its hold, 1 at the
// end of the transition after it. Always the same direction, so every
// scene drifts steadily one way while it can be seen.
export function sceneU(i, clock) {
  const mid = sceneStart(i) + TIMING.hold / 2;
  let d = wrap(clock) - mid;
  if (d > CYCLE / 2) d -= CYCLE;
  if (d < -CYCLE / 2) d += CYCLE;
  return Math.max(-1, Math.min(1, d / (TIMING.hold / 2 + TIMING.move)));
}

// The scene to draw at `clock`, with where its view is (sceneU): the one
// being left until the tunnel covers the glass, then the one ahead.
export function layersAt(clock) {
  const st = stateAt(clock);
  const i = st.kind === "scene" || st.t < 0.5 ? st.scene : st.next;
  return [{ scene: i, u: sceneU(i, clock), opacity: 1 }];
}

// The playback state machine: one clock, advanced only while playing.
// Everything the hero shows comes from here, so there are no competing
// timers. A destination button runs the same tunnel as the journey itself
// (a "jump") straight to that destination, then restarts its hold. A pick
// while a tunnel is already running retargets it if the scene ahead hasn't
// been seen yet (the window is still showing the last place, or is
// completely dark); otherwise it waits for that tunnel to finish, and only
// the latest such pick is kept. So rapid clicks never overlap tunnels or
// show a scene for a moment and then snatch it away.
export function createPlayback() {
  let clock = 0;
  let jump = null; // { from, c0, to, t }: a picked destination's tunnel
  let queued = null; // a pick waiting for the running tunnel to finish
  const unseen = (t) => t < 0.5 || band(t).covered === 1;
  const startQueued = () => {
    const st = stateAt(clock);
    if (queued !== null && st.kind === "scene" && queued !== st.scene) jump = { from: st.scene, c0: clock, to: queued, t: 0 };
    queued = null;
  };
  return {
    get clock() {
      return clock;
    },
    // Advances by dt seconds. `ready(i)`: whether scene i's photo can be
    // drawn; playback waits at the end of a hold rather than start a
    // tunnel into a scene that can't be shown yet.
    tick(dt, ready = () => true) {
      dt = Math.max(0, Math.min(0.1, Number.isFinite(dt) ? dt : 0));
      if (jump) {
        jump.t += dt / TIMING.move;
        if (jump.t >= 1) {
          clock = sceneStart(jump.to);
          jump = null;
          startQueued();
        }
        return;
      }
      const st = stateAt(clock);
      const end = sceneStart(st.scene) + TIMING.hold;
      const next = clock + dt;
      if (st.kind === "scene" && next >= end && !ready((st.scene + 1) % SCENES.length)) clock = end - 1e-6;
      else clock = wrap(next);
      if (queued !== null && stateAt(clock).kind === "scene") startQueued();
    },
    // A destination button: tunnel to scene i (or, `instant`, cut to it at
    // once: reduced motion, paused) and restart its hold from the beginning.
    select(i, { instant = false } = {}) {
      sceneStart(i); // throws for a scene that doesn't exist
      if (instant) {
        jump = null;
        queued = null;
        clock = sceneStart(i);
        return;
      }
      const st = this.state();
      if (st.kind === "tunnel") {
        if (!unseen(st.t)) return void (queued = i);
        if (jump) jump.to = i;
        else jump = { from: st.scene, c0: clock - st.t * TIMING.move, to: i, t: st.t };
        queued = null;
        return;
      }
      queued = null;
      if (st.scene !== i) jump = { from: st.scene, c0: clock, to: i, t: 0 };
    },
    // what to draw now
    layers() {
      if (!jump) return layersAt(clock);
      return jump.t < 0.5
        ? [{ scene: jump.from, u: sceneU(jump.from, jump.c0 + jump.t * TIMING.move), opacity: 1 }]
        : [{ scene: jump.to, u: sceneU(jump.to, sceneStart(jump.to) - TIMING.move * (1 - jump.t)), opacity: 1 }];
    },
    state() {
      if (jump) return { kind: "tunnel", scene: jump.from, next: jump.to, t: jump.t, label: jump.t < 0.5 ? jump.from : jump.to, clock, jumping: true, queued };
      return { ...stateAt(clock), clock, jumping: false, queued };
    },
  };
}

// Where scene `s`'s photo goes, in stage px, for a window whose glass is
// `glass` ({x, y, w, h}), when its view is at `u` (-1..1, sceneU). The
// photo is scaled to the smallest size that (a) puts row `ay` at row `gy`
// of the part of the glass the view is framed in (its top `viewShare`: on a
// phone the controls take the bottom of the window), (b) covers the whole
// glass top to bottom, and (c) is wide enough on both sides of `focus` for
// the whole pan, so no position in the stretch ever shows its edge.
export function placePhoto(s, glass, u, portrait = false, viewShare = 1) {
  const P = s.photo;
  const focus = portrait && P.phoneFocus !== undefined ? P.phoneFocus : P.focus;
  const anchor = P.gy * glass.h * viewShare; // the anchor row, below the glass's top
  const need = glass.w / 2 + (glass.w * P.pan) / 2; // screen px of photo wanted on each side of the focus
  const h = Math.max(
    glass.h * (portrait && P.phoneZoom ? P.phoneZoom : 1), // never shorter than the glass (closer in, on a phone, for a thin skyline)
    anchor / P.ay, // enough above the anchor row
    // and below it, unless the view is framed high (a phone): there the
    // photo slides up to cover the glass rather than growing
    viewShare < 1 ? 0 : (glass.h - anchor) / (1 - P.ay),
    (need / focus) * (P.h / P.w), // enough left of the focus
    (need / (1 - focus)) * (P.h / P.w), // and right of it
  );
  const w = h * (P.w / P.h);
  const moved = (clamp01((u + 1) / 2) - 0.5) * P.pan * glass.w;
  const x = glass.x + glass.w / 2 - focus * w - moved;
  const y = Math.max(glass.y + anchor - P.ay * h,
    P.tip === undefined ? -Infinity : glass.y + Math.min(8, glass.h * 0.01) - P.tip * h);
  // safety only: the sizing above already keeps the edges out of the glass
  return {
    x: Math.min(glass.x, Math.max(glass.x + glass.w - w, x)),
    y: Math.min(glass.y, Math.max(glass.y + glass.h - h, y)),
    w,
    h,
  };
}

// on a phone the scenery is framed in the window's top part, above the
// controls stacked over its bottom
export const PHONE_VIEW = 0.7;

// The window: the view fills the hero, inset by a thin, even margin of the
// page's own background (the same on all four sides) with softly rounded
// corners and a hairline edge (styles.css). No carriage and no heavy frame:
// the scenery is the subject, and the hero sits on the page like the rest
// of it. The glass takes 90% or more of the hero at every size, and never
// moves. Returns, in stage px, the margin (`frame`), the corner radius and
// where the clear glass is.
export const FRAME = { share: 0.006, min: 8, max: 14, phone: 8, radius: 0.016 };
export function fitWindow(stageW, stageH) {
  const W = Math.round(stageW);
  const H = Math.round(stageH);
  const portrait = W / H < 0.9;
  const f = portrait ? FRAME.phone : Math.round(Math.min(FRAME.max, Math.max(FRAME.min, Math.min(W, H * 1.6) * FRAME.share)));
  const glass = { x: f, y: f, w: W - 2 * f, h: H - 2 * f };
  const radius = Math.round(Math.min(18, Math.max(10, Math.min(glass.w, glass.h) * FRAME.radius)));
  return { portrait, frame: f, radius, glass };
}

// A tunnel is a dark band sliding across the glass from the right, the way
// the scenery drifts: its soft edge sweeps over the window, it's dark for under half a second,
// and daylight returns from the right. Returns the band's left edge and
// width in glass widths (0 = the glass's left edge) at t, and how much of
// the glass it covers (0..1). Fully covered from about t 0.37 to 0.63, so
// the scene swap at t 0.5 is never seen.
export const BAND_W = 1.7;
export function band(t) {
  const left = 1 - clamp01(t) * (BAND_W + 1);
  const covered = clamp01(Math.min(1, left + BAND_W) - Math.max(0, left));
  return { left, width: BAND_W, covered };
}

// What the hero's "Explore This Destination" does for scene s: open its
// curated itinerary, or search the homepage's map for the place.
export const exploreFor = (s) => (s.explore ? { href: s.explore } : { search: s.search });
