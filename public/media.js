import { coverImg, PHOTOS, photoFor } from "/photos.js";
import { h } from "/ui.js";

// The homepage's moving pictures: the cinematic hero and the photo stream.
// Every clip and photo is freely licensed, self-hosted, and credited here and
// on /credits (docs/media.md). Both are decoration over a page that works
// without them: the hero shows its poster when video can't or shouldn't play,
// and the stream is a plain scrolling row of links underneath its motion.

// Hero clips: ~6 s each, muted, H.264 + VP9, with a poster. Filled in from the
// licensed sources recorded in docs/media.md; empty means a still hero.
export const HERO_CLIPS = [
  {"city": "Sydney", "country": "Australia", "mp4": "/video/hero-sydney.mp4", "webm": "/video/hero-sydney.webm", "poster": "/video/hero-sydney.jpg", "seconds": 6, "author": "Tim Astor", "license": "CC BY 3.0", "licenseUrl": "https://creativecommons.org/licenses/by/3.0", "page": "https://commons.wikimedia.org/wiki/File:Sydney_Opera_House_drone.webm"},
  {"city": "London", "country": "United Kingdom", "mp4": "/video/hero-london.mp4", "webm": "/video/hero-london.webm", "poster": "/video/hero-london.jpg", "seconds": 6, "author": "the Dronalist", "license": "CC BY 3.0", "licenseUrl": "https://creativecommons.org/licenses/by/3.0", "page": "https://commons.wikimedia.org/wiki/File:Aerial_footage_of_London,_United_Kingdom_featuring_London_Tower,_Downtown_London,_London_Bridge,_River_Thames.webm"},
  {"city": "Venice", "country": "Italy", "mp4": "/video/hero-venice.mp4", "webm": "/video/hero-venice.webm", "poster": "/video/hero-venice.jpg", "seconds": 6, "author": "Triplec85", "license": "CC BY-SA 4.0", "licenseUrl": "https://creativecommons.org/licenses/by-sa/4.0", "page": "https://commons.wikimedia.org/wiki/File:2018-09-25_Santa_Maria_della_Salute_(Venice)_Grand_Canal.webm"},
  {"city": "New York", "country": "United States", "mp4": "/video/hero-new-york.mp4", "webm": "/video/hero-new-york.webm", "poster": "/video/hero-new-york.jpg", "seconds": 6, "author": "David Schwab", "license": "CC BY 3.0", "licenseUrl": "https://creativecommons.org/licenses/by/3.0", "page": "https://commons.wikimedia.org/wiki/File:Time-lapse_of_New_York_City_skyline_July_2023.webm"},
  {"city": "Landwasser Viaduct", "country": "Switzerland", "mp4": "/video/hero-landwasser.mp4", "webm": "/video/hero-landwasser.webm", "poster": "/video/hero-landwasser.jpg", "seconds": 6, "author": "FkMohr (recorded by Supakon Mohr)", "license": "CC BY-SA 3.0 DE", "licenseUrl": "https://creativecommons.org/licenses/by-sa/3.0/de/deed.en", "page": "https://commons.wikimedia.org/wiki/File:1137-Landwasser.webm"},
  {"city": "Paris", "country": "France", "mp4": "/video/hero-paris.mp4", "webm": "/video/hero-paris.webm", "poster": "/video/hero-paris.jpg", "seconds": 6, "author": "Yann Caradec", "license": "CC BY-SA 2.0", "licenseUrl": "https://creativecommons.org/licenses/by-sa/2.0", "page": "https://commons.wikimedia.org/wiki/File:Timelapse_Tour_Eiffel_%C3%A0_Paris.webm"},
  {"city": "Shanghai", "country": "China", "mp4": "/video/hero-shanghai.mp4", "webm": "/video/hero-shanghai.webm", "poster": "/video/hero-shanghai.jpg", "seconds": 6, "author": "Yigang Yu", "license": "CC0", "licenseUrl": "https://creativecommons.org/publicdomain/zero/1.0/deed.en", "page": "https://commons.wikimedia.org/wiki/File:Shanghai_Bund,_Lujiazui_Skyline_Timelapse.webm"},
];


const reducedMotion = () => matchMedia("(prefers-reduced-motion: reduce)").matches;
// on a metered or "save data" connection, keep the hero still
const saveData = () => Boolean(navigator.connection?.saveData) || /(^|-)2g$/.test(navigator.connection?.effectiveType ?? "");

// A still image for the hero: the first clip's poster, else a destination photo.
function heroStill(fallbackKey) {
  const clip = HERO_CLIPS[0];
  if (clip) return { src: clip.poster, alt: `${clip.city}, ${clip.country}`, credit: clip };
  const p = photoFor(fallbackKey);
  return p ? { src: p.src, alt: p.alt, credit: p } : null;
}

// The cinematic hero. One <video> plays at a time; the next clip is loaded
// only when it's about to be needed, then crossfaded in. The heading never
// changes, only a small destination label does.
export function videoHero({ title, tagline, actions, fallbackKey }) {
  const still = heroStill(fallbackKey);
  const stage = h("div", { class: "vh-stage", "aria-hidden": "true" });
  const label = h("p", { class: "vh-label", "aria-live": "off" });
  const credit = h("p", { class: "vh-credit" });
  const showCredit = (c) => fill(credit, c ? creditLine(c) : null);

  if (still) {
    stage.append(h("img", { class: "vh-poster", src: still.src, alt: "", fetchpriority: "high", decoding: "async" }));
    showCredit(still.credit);
    if (HERO_CLIPS[0]) label.textContent = `${HERO_CLIPS[0].city}, ${HERO_CLIPS[0].country}`;
  }

  const el = h(
    "section",
    { class: "vh", "aria-label": "Wayline" },
    stage,
    h("div", { class: "vh-shade", "aria-hidden": "true" }),
    h("div", { class: "vh-content" }, h("h1", { class: "vh-title" }, title), h("p", { class: "vh-tagline" }, tagline), h("div", { class: "vh-actions" }, actions)),
    h("div", { class: "vh-foot" }, label, credit),
  );

  let i = 0;
  let timer = null;
  let stopped = false;
  const canPlay = () => HERO_CLIPS.length > 0 && !reducedMotion() && !saveData();

  // a muted, inline, poster-backed <video>; preload none until it's next
  const makeVideo = (clip) => {
    const v = h("video", { class: "vh-video", muted: true, playsinline: true, preload: "none", poster: clip.poster, "aria-hidden": "true", tabindex: "-1", disablepictureinpicture: true });
    v.muted = true; // the attribute alone isn't enough for every browser's autoplay rule
    v.append(h("source", { src: clip.webm, type: "video/webm" }), h("source", { src: clip.mp4, type: "video/mp4" }));
    return v;
  };

  function show(index) {
    if (stopped || !canPlay()) return;
    const clip = HERO_CLIPS[index];
    const v = makeVideo(clip);
    v.preload = "auto";
    stage.append(v);
    const begin = () => {
      v.classList.add("on");
      label.textContent = `${clip.city}, ${clip.country}`;
      showCredit(clip);
      // fade the previous layer out, then drop it so only one video decodes
      for (const old of [...stage.children]) if (old !== v) setTimeout(() => old.remove(), 1200);
      clearTimeout(timer);
      timer = setTimeout(() => show((index + 1) % HERO_CLIPS.length), Math.max(4000, (clip.seconds ?? 6) * 1000 - 600));
    };
    v.addEventListener("playing", begin, { once: true });
    // a clip that can't play leaves the current picture up and tries the next later
    v.addEventListener("error", () => { v.remove(); clearTimeout(timer); timer = setTimeout(() => show((index + 1) % HERO_CLIPS.length), 3000); }, { once: true });
    v.play().catch(() => v.remove()); // autoplay refused: the poster stays
    i = index;
  }

  // start after first paint, and only while the hero is on screen
  const io = new IntersectionObserver((entries) => {
    const visible = entries.some((e) => e.isIntersecting);
    if (visible && canPlay() && !timer) {
      timer = -1; // scheduled; show() replaces it with the rotation timer
      const go = () => show(i);
      if ("requestIdleCallback" in window) requestIdleCallback(go, { timeout: 1500 });
      else setTimeout(go, 300);
    }
    if (!visible) {
      clearTimeout(timer);
      timer = null;
      for (const v of stage.querySelectorAll("video")) v.pause();
    }
  });
  io.observe(el);
  const motion = matchMedia("(prefers-reduced-motion: reduce)");
  const onMotion = () => {
    if (!motion.matches) return;
    clearTimeout(timer);
    timer = null;
    for (const v of stage.querySelectorAll("video")) v.remove();
  };
  motion.addEventListener("change", onMotion);

  return {
    el,
    destroy() {
      stopped = true;
      clearTimeout(timer);
      io.disconnect();
      motion.removeEventListener("change", onMotion);
      for (const v of stage.querySelectorAll("video")) v.remove();
    },
  };
}

const fill = (node, child) => node.replaceChildren(...(child ? [child] : []));

function creditLine(c) {
  return h(
    "span",
    {},
    c.mp4 ? "Video: " : "Photo: ",
    h("a", { href: c.page, target: "_blank", rel: "noopener" }, c.author ?? "Wikimedia Commons"),
    ", ",
    h("a", { href: c.licenseUrl, target: "_blank", rel: "noopener license" }, c.license),
  );
}

// --- the photo stream ----------------------------------------------------------

// A loose editorial rhythm of sizes, repeated; each photo still links to its
// real destination. "w" is a width class, not pixels.
const RHYTHM = ["xl", "s", "m", "l", "s", "m"];

// Destination photos (dest-*) and itinerary covers (tpl-*), each pointing at
// a place you can open. A photo with no matching destination isn't shown.
export function streamItems(destinations, itineraries, area = null) {
  const byId = new Map(destinations.map((d) => [d.id, d]));
  const out = [];
  for (const [key, photo] of Object.entries(PHOTOS)) {
    let dest = null;
    let href = null;
    if (key.startsWith("dest-")) {
      dest = byId.get(key.slice(5)) ?? null;
      href = dest ? `#city-${dest.id}` : null;
    } else if (key.startsWith("tpl-")) {
      const it = itineraries.find((t) => t.id === key);
      dest = it?.destinationId ? (byId.get(it.destinationId) ?? null) : null;
      href = it ? `/itineraries/${it.id}` : null;
    }
    if (!dest || !href) continue;
    if (area && dest.area !== area) continue;
    out.push({ key, photo, dest, href });
  }
  // one city at a time, round-robin, so the row never runs through a city's
  // photos together; each city's own photo first
  const byCity = new Map();
  for (const it of out.sort((a, b) => Number(b.key.startsWith("dest-")) - Number(a.key.startsWith("dest-")))) byCity.set(it.dest.id, [...(byCity.get(it.dest.id) ?? []), it]);
  const queues = [...byCity.values()];
  const mixed = [];
  while (queues.some((q) => q.length)) for (const q of queues) if (q.length) mixed.push(q.shift());
  return mixed;
}

export function photoStream(items, { onCity, navigate }) {
  const track = h("div", { class: "ps-track" });
  const scroller = h("div", { class: "ps-scroller", role: "list", "aria-label": "Travel photos" }, track);
  const tile = (it, n) =>
    h(
      "a",
      {
        class: `ps-tile ps-${RHYTHM[n % RHYTHM.length]}`,
        role: "listitem",
        href: it.href.startsWith("#") ? `/${it.href}` : it.href,
        "aria-label": `${it.dest.name}: ${it.photo.alt}`,
        onclick: (e) => {
          if (e.metaKey || e.ctrlKey || e.shiftKey) return;
          e.preventDefault();
          if (it.href.startsWith("#city-")) onCity(it.dest);
          else navigate(it.href);
        },
      },
      coverImg(it.photo, { decorative: true }),
      h("span", { class: "ps-cap" }, h("b", {}, it.dest.name), h("small", {}, it.dest.country)),
      // plain text: the tile is already a link (the linked credit is on /credits)
      h("span", { class: "cover-credit" }, `Photo: ${it.photo.author ?? "Wikimedia Commons"}, ${it.photo.license}`),
    );
  const render = (list) => {
    // the row twice, so the slow loop is seamless; the copy is hidden from readers
    const once = list.map(tile);
    const twice = list.map((it, n) => {
      const t = tile(it, n);
      t.setAttribute("aria-hidden", "true");
      t.tabIndex = -1;
      return t;
    });
    track.replaceChildren(...once, ...(list.length > 3 ? twice : []));
    track.style.setProperty("--ps-count", String(list.length));
  };
  render(items);
  return { el: scroller, render };
}
