// The homepage hero: the view through one large window, travelling on its
// own through five destinations (journey.js has the plan and the playback
// state machine; this file only draws it). It's decoration over a page that
// works without it: the heading and both buttons are ordinary controls, and
// the photos are credited on the window and on /credits.
//
// Each scene is one real photograph and its only motion is a slow camera
// drift within it, never past its edges: nothing is drawn or composited
// over the photos. Every change of place is the same short tunnel, so two
// photos never dissolve into each other.
//
// The hero is an ordinary block: the page scrolls past it as usual, and
// nothing here listens to wheel, touch or scroll. Playback advances one
// clock in a requestAnimationFrame loop, which runs only while the hero is
// on screen in a visible tab, and never with reduced motion (or Save-Data),
// where the scene is still until someone picks another.
import { band, BAND_W, CREDITS, createPlayback, exploreFor, fitWindow, PHONE_VIEW, placePhoto, SCENES } from "/journey.js";
import { h } from "/ui.js";

const IMG = "/img/train";

// The stations' places on the line, in % of its box: a route with a bend
// at every stop, alternating so the names above and below never collide.
const LINE = [[6, 72], [28, 30], [50, 72], [72, 30], [94, 72]];


// on a metered or "save data" connection, keep the hero still (fewer photos)
const saveData = () => Boolean(navigator.connection?.saveData) || /(^|-)2g$/.test(navigator.connection?.effectiveType ?? "");

// One download per photo, decoded once, shared by every <img> that shows it
// (a second visit to the homepage reuses it).
const loads = new Map();
function load(src) {
  if (!loads.has(src))
    loads.set(
      src,
      new Promise((resolve) => {
        const img = new Image();
        img.decoding = "async";
        img.onload = () => (img.decode ? img.decode().catch(() => {}) : Promise.resolve()).then(() => resolve(true));
        img.onerror = () => {
          loads.delete(src);
          resolve(false);
        };
        img.src = src;
      }),
    );
  return loads.get(src);
}

// start(): the existing "Start planning" flow. onSearch(place): show a
// place on the homepage's map, for a destination with no curated trip.
export function journeyHero({ start, onSearch }) {
  const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)");
  // Keep the value from change events, rather than polling .matches in
  // every animation frame (which can consume a pending query change).
  let reduce = reducedMotion.matches;
  // --- the picture, back to front: one photo per scene (an <img> decoded
  // once and moved by transform), the tunnel, and the glass's edge.
  const sceneEls = SCENES.map((s, i) => {
    const img = h("img", { class: "jh-photo", alt: "", decoding: "async", draggable: "false", fetchpriority: i === 0 ? "high" : "auto" });
    const el = h("div", { class: `jh-scene jh-scene-${s.id}`, "aria-hidden": "true" }, img);
    return { el, img, wanted: false, ready: false, failed: false, s };
  });
  // the tunnel wall: a dark band sliding across the glass, its lamps
  // streaking past (in their own clipped box, so they never stream onto
  // the scenery)
  const tunnel = h("div", { class: "jh-tunnel", "aria-hidden": "true" }, h("div", { class: "jh-band" }, h("div", { class: "jh-band-in" }, h("div", { class: "jh-lamps" }))));
  // the glass: a hairline edge and a barely-there sheen
  const glass = h("div", { class: "jh-glass", "aria-hidden": "true" });
  const picture = h("div", { class: "jh-picture", role: "img", "aria-label": SCENES[0].alt }, ...sceneEls.map((e) => e.el), tunnel, glass);

  // --- the interface: Wayline's own type and buttons over the view
  const place = h("p", { class: "jh-place" });
  const sub = h("p", { class: "jh-sub" });
  const count = h("span", { class: "jh-count", "aria-hidden": "true" });
  const explore = h("a", { class: "btn btn-lg jh-btn-light", href: SCENES[0].explore ?? "/#explore-map" }, "Explore This Destination");
  explore.addEventListener("click", (e) => {
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
    const go = exploreFor(SCENES[shown]);
    if (go.href) return; // an ordinary in-app link (data-link)
    e.preventDefault();
    onSearch(go.search);
  });
  const stops = SCENES.map((s, i) =>
    h("button", { type: "button", class: "jh-stop", onclick: () => pick(i) }, h("span", { class: "jh-stop-n", "aria-hidden": "true" }, String(i + 1).padStart(2, "0")), h("span", {}, s.name)),
  );
  const live = h("p", { class: "sr-only", "aria-live": "polite" });
  const pause = h("button", { type: "button", class: "jh-pause", onclick: () => {
    paused = !paused;
    pause.textContent = paused ? "Play scenery" : "Pause scenery";
    pause.setAttribute("aria-pressed", String(paused));
    if (paused) halt();
    else kick();
  }, "aria-pressed": "false" }, "Pause scenery");
  const credit = h("p", { class: "jh-credit" });
  // the line: the five destinations as stations on one route, drawn up to
  // the one on view (an SVG path, its stations ordinary buttons over it)
  const svg = (tag, attrs) => {
    const n = document.createElementNS("http://www.w3.org/2000/svg", tag);
    for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
    return n;
  };
  const pts = LINE.map(([x, y]) => `${x},${y}`).join(" ");
  const track = svg("polyline", { class: "jh-track", points: pts, "vector-effect": "non-scaling-stroke" });
  const drawn = svg("polyline", { class: "jh-drawn", points: "", "vector-effect": "non-scaling-stroke" });
  const map = svg("svg", { class: "jh-line-svg", viewBox: "0 0 100 100", preserveAspectRatio: "none", "aria-hidden": "true" });
  map.append(track, drawn);
  stops.forEach((b, i) => {
    b.style.left = `${LINE[i][0]}%`;
    b.style.top = `${LINE[i][1]}%`;
    b.classList.add(LINE[i][1] < 50 ? "jh-stop-up" : "jh-stop-down");
  });
  const ui = h("div", { class: "jh-ui" }, credit, pause, live);
  const el = h("div", { class: "jh" }, picture, ui);
  const root = h(
    "section",
    { class: "hx", id: "jh", "aria-label": "Wayline" },
    h(
      "div",
      { class: "hx-copy" },
      h(
        "div",
        { class: "jh-copy" },
        h("p", { class: "hx-kicker" }, h("span", { class: "eyebrow-n" }, "00"), "Collaborative trip planner"),
        h("h1", { class: "jh-title" }, "Every journey begins somewhere."),
        h("p", { class: "jh-lede" }, "Plan a trip together on one map and one timeline, with real travel times between every stop."),
        h("div", { class: "jh-actions" }, h("button", { type: "button", class: "btn btn-primary btn-lg", onclick: start }, "Start Planning"), explore),
      ),
      h(
        "div",
        { class: "jh-bar" },
        h("div", { class: "jh-dest" }, h("p", { class: "jh-kicker" }, count, " · Now passing"), h("div", { class: "jh-place-row" }, place, sub)),
        h("div", { class: "jh-line" }, map, h("nav", { class: "jh-stops", "aria-label": "Choose a destination" }, stops)),
      ),
    ),
    el,
  );

  // --- state ---
  const playback = createPlayback();
  let shown = -1; // the destination named and linked
  let fit = null;
  let raf = 0;
  let last = 0;
  let visible = true;
  let speed = 1; // for tests: a whole cycle in seconds
  let frames = 0;
  let paused = false;
  let destroyed = false;
  let pickVersion = 0;
  const still = () => reduce || saveData();

  // Photos load when they're showing or next, never all at once.
  function want(i, retry = false) {
    const e = sceneEls[i];
    if (e.wanted && !(retry && e.failed)) return e.loading;
    e.wanted = true;
    e.failed = false;
    const src = `${IMG}/${e.s.id}.webp`;
    e.loading = load(src).then((ok) => {
      if (destroyed) return false;
      if (!ok) return void (e.failed = true);
      e.img.src = src;
      e.ready = true;
      e.el.classList.add("jh-ready");
      draw();
      kick();
      return true;
    });
    return e.loading;
  }

  // --- layout ---
  function resize() {
    const r = el.getBoundingClientRect();
    if (!r.width || !r.height) return;
    fit = fitWindow(r.width, r.height);
    el.classList.toggle("jh-portrait", fit.portrait);
    const g = fit.glass;
    for (const [k, v] of [["frame", fit.frame], ["radius", fit.radius], ["gx", g.x], ["gy", g.y], ["gw", g.w], ["gh", g.h]]) el.style.setProperty(`--jh-${k}`, `${v}px`);
    draw();
  }

  // --- drawing: transforms and opacity only ---
  function draw() {
    if (!fit || destroyed) return;
    const st = playback.state();
    let layers = still() ? [{ scene: st.label, u: 0, opacity: 1 }] : playback.layers();
    want(st.label);
    if (!still()) want((st.label + 1) % SCENES.length);
    // Keep the last successful view if a download fails. Its label and
    // credit stay with that photograph until another scene can be shown.
    const named = sceneEls[st.label].ready ? st.label : shown;
    layers = layers.filter((l) => sceneEls[l.scene].ready);
    if (!layers.length && sceneEls[shown]?.ready) layers = [{ scene: shown, u: 0, opacity: 1 }];
    if (named !== shown) label(named);
    const on = new Map(layers.map((l, z) => [l.scene, { ...l, z }]));
    sceneEls.forEach((e, i) => {
      const l = on.get(i);
      // a photo that hasn't arrived yet stays hidden: the one below shows
      const opacity = l && e.ready ? l.opacity : 0;
      e.el.style.opacity = String(opacity);
      e.el.style.visibility = opacity > 0 ? "visible" : "hidden";
      e.el.style.zIndex = String(l ? l.z : 0);
      if (!opacity) return;
      const r = placePhoto(e.s, fit.glass, l.u, fit.portrait, fit.portrait ? PHONE_VIEW : 1);
      e.img.style.width = `${r.w}px`;
      e.img.style.height = `${r.h}px`;
      e.img.style.transform = `translate3d(${r.x}px,${r.y}px,0)`;
    });
    // the tunnel slides across the glass and off again
    const inTunnel = st.kind === "tunnel" && !still();
    tunnel.style.visibility = inTunnel ? "visible" : "hidden";
    let dark = 0;
    if (inTunnel) {
      const g = fit.glass;
      const b = band(st.t);
      const bandEl = tunnel.firstChild;
      bandEl.style.width = `${b.width * g.w}px`;
      bandEl.style.transform = `translate3d(${g.x + b.left * g.w}px,0,0)`;
      // lamps stream past faster than the wall itself, as they're nearer
      bandEl.firstChild.firstChild.style.transform = `translate3d(${-(st.t * BAND_W * g.w * 0.8) % 420}px,0,0)`;
      dark = b.covered;
    }
    const night = SCENES[layers.at(-1)?.scene ?? shown].night;
    el.classList.toggle("jh-night", (night && dark < 0.5) || dark > 0.5);
    el.style.setProperty("--jh-dark", String(Math.max(dark * 0.85, night ? 0.6 : 0)));
  }

  function label(i) {
    shown = i;
    const s = SCENES[i];
    place.textContent = s.name.toUpperCase();
    sub.textContent = s.subtitle;
    count.textContent = `${String(i + 1).padStart(2, "0")} / ${String(SCENES.length).padStart(2, "0")}`;
    picture.setAttribute("aria-label", s.alt);
    const c = CREDITS.find((x) => x.scene === s.id);
    credit.replaceChildren(`${s.place}. Photo: `, h("a", { href: c.page, rel: "noopener", target: "_blank" }, c.author), ", ", h("a", { href: c.licenseUrl, rel: "noopener license", target: "_blank" }, c.license));
    stops.forEach((b, k) => {
      if (k === i) b.setAttribute("aria-current", "true");
      else b.removeAttribute("aria-current");
      b.classList.toggle("jh-stop-past", k < i);
    });
    drawn.setAttribute("points", LINE.slice(0, i + 1).map(([x, y]) => `${x},${y}`).join(" "));
    const go = exploreFor(s);
    explore.href = go.href ?? "/#explore-map";
    // an in-app link goes through the router; a map search is handled here
    if (go.href) explore.setAttribute("data-link", "");
    else explore.removeAttribute("data-link");
  }

  // A destination button: a tunnel to that scene (a cut when paused or
  // still), its hold restarted.
  async function pick(i) {
    const version = ++pickVersion;
    const ready = await want(i, true);
    if (destroyed || version !== pickVersion) return;
    if (!ready) {
      live.textContent = `The photo of ${SCENES[i].name} is unavailable. Please choose another destination.`;
      return;
    }
    playback.select(i, { instant: still() || paused });
    live.textContent = `${SCENES[i].name}, ${SCENES[i].subtitle}`;
    draw();
    kick();
  }

  // --- the loop: one, and only while it can be seen ---
  const canRun = () => !destroyed && !paused && visible && !document.hidden && !still() && el.isConnected;
  function frameLoop(now) {
    raf = 0;
    if (!canRun()) return void (last = 0);
    const dt = last ? Math.min(0.1, (now - last) / 1000) : 0;
    last = now;
    // a photo that failed to load doesn't hold the journey up: its scene shows the one before
    playback.tick(dt * speed, (i) => sceneEls[i].ready || sceneEls[i].failed);
    frames++;
    draw();
    if (canRun()) raf = requestAnimationFrame(frameLoop);
    else last = 0;
  }
  function kick() {
    if (!raf && canRun()) {
      last = 0;
      raf = requestAnimationFrame(frameLoop);
    }
  }
  function halt() {
    cancelAnimationFrame(raf);
    raf = 0;
    last = 0;
  }

  const io = new IntersectionObserver(([e]) => {
    visible = e.isIntersecting;
    if (visible) kick();
    else halt();
  });
  io.observe(el);
  const onVisibility = () => (document.hidden ? halt() : kick());
  const onMotion = () => {
    reduce = reducedMotion.matches;
    if (still()) halt();
    pause.hidden = still();
    draw();
    kick();
  };
  let resizeTimer = 0;
  const ro = new ResizeObserver(() => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(resize, fit ? 80 : 0);
  });
  ro.observe(el);
  document.addEventListener("visibilitychange", onVisibility);
  reducedMotion.addEventListener("change", onMotion);
  navigator.connection?.addEventListener("change", onMotion);

  // for tests and evaluation: what's on screen, without reaching into closures
  window.__journey = {
    state: () => ({ ...playback.state(), shown, running: raf !== 0, visible, paused, frames, still: still(), loaded: sceneEls.map((e) => e.ready), requested: sceneEls.map((e) => e.wanted), glass: fit?.glass, frame: fit?.frame,
      tunnel: tunnel.style.visibility === "visible" ? { band: tunnel.firstChild.getBoundingClientRect().toJSON() } : null,
      layers: [...sceneEls].filter((e) => e.el.style.visibility === "visible").map((e) => e.s.id),
      photo: (i) => { const r = sceneEls[i].img.getBoundingClientRect(); const o = el.getBoundingClientRect(); return { x: r.x - o.x, y: r.y - o.y, w: r.width, h: r.height }; } }),
    speed: (n) => void (speed = n),
  };

  label(0);
  want(0);
  pause.hidden = still();

  return {
    el: root,
    destroy() {
      destroyed = true;
      halt();
      clearTimeout(resizeTimer);
      io.disconnect();
      ro.disconnect();
      document.removeEventListener("visibilitychange", onVisibility);
      reducedMotion.removeEventListener("change", onMotion);
      navigator.connection?.removeEventListener("change", onMotion);
      delete window.__journey;
    },
  };
}
