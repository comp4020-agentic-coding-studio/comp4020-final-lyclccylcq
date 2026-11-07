import { createPicks, findJourneys } from "/discover.js";
import { createExploreMap } from "/explore-map.js";
import { journeyHero } from "/journey-hero.js";
import { photoStream, streamItems } from "/media.js";
import { coverImg, photoFor } from "/photos.js";
import { placeDialog } from "/places.js";
import { t, tn } from "/i18n.js";
import { api, CATEGORY_LABEL, dur, fmtRange, h, icon, km, relTime, uid } from "/ui.js";

const CATEGORY_ICON = { "food-culture": "food", "nature-outdoors": "leaf", "city-highlights": "city" };
const CATEGORY_HUE = { "food-culture": 14, "nature-outdoors": 148, "city-highlights": 208 };
// Kept on this device only, coordinates rounded to ~1 km. The current location
// and the chosen travel destination are separate: picking Tokyo doesn't change
// where you are, and the destination wins while it's set.
const LOC_KEY = "wayline.location"; // { label, lat, lng, at }
const DEST_KEY = "wayline.destination"; // { label, lat, lng }
const GEO_KEY = "wayline.geo"; // "allowed" | "dismissed" | "denied"
const REFRESH_MS = 30 * 60_000;

const store = {
  get(k) {
    try {
      return JSON.parse(localStorage.getItem(k) ?? "null");
    } catch {
      return null;
    }
  },
  set(k, v) {
    try {
      v === null ? localStorage.removeItem(k) : localStorage.setItem(k, JSON.stringify(v));
    } catch {}
  },
};

const round = (n) => Math.round(n * 100) / 100;
const roughly = (p) => ({ ...p, lat: round(p.lat), lng: round(p.lng) });
const kmApart = (a, b) => {
  const rad = Math.PI / 180;
  const x = Math.sin(((b.lat - a.lat) * rad) / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(((b.lng - a.lng) * rad) / 2) ** 2;
  return 12742 * Math.asin(Math.sqrt(x));
};
const permissionState = () =>
  navigator.permissions?.query({ name: "geolocation" }).then((p) => p.state, () => null) ?? Promise.resolve(null);

export function itineraryCard(it, { navigate }, n = null) {
  const shared = it.source === "user";
  const primary = it.categories.find((c) => !["half-day", "one-day", "weekend"].includes(c)) ?? it.categories[0];
  const length = it.days > 1 ? t("{n} days", { n: it.days }) : t("About {time}", { time: dur(Math.round(it.durationMin / 30) * 30) });
  const open = () => navigate(`/itineraries/${it.id}`);
  const photo = photoFor(shared ? it.cover : it.id);
  return h(
    "article",
    { class: "it-card", dataset: { id: it.id } },
    n !== null && h("span", { class: "it-n", "aria-hidden": "true" }, String(n + 1).padStart(2, "0")),
    h(
      "div",
      { class: `it-cover cover-${primary}${photo ? " has-photo" : ""}`, style: `--hue:${(CATEGORY_HUE[primary] ?? 260) + (hue(it.title) % 28)}` },
      coverImg(photo),
      h("span", { class: "it-cover-glyph", "aria-hidden": "true" }, icon(CATEGORY_ICON[primary] ?? "spark")),
      h("span", { class: "it-cover-dest", "aria-hidden": "true" }, it.destination),
    ),
    h(
      "div",
      { class: "it-body" },
      h("p", { class: "it-tags" }, it.categories.map((c) => h("span", { class: "tag" }, CATEGORY_LABEL[c] ?? c))),
      h("h3", {}, h("a", { href: `/itineraries/${it.id}`, "data-link": true }, it.title)),
      h(
        "p",
        { class: "it-meta" },
        h("span", {}, it.destination),
        h("span", {}, length),
        h("span", {}, tn(it.stopCount, "{n} stop", "{n} stops")),
        typeof it.distanceKm === "number" && h("span", { class: "it-distance" }, it.distanceKm < 1 ? t("Right here") : t("{distance} away", { distance: km(it.distanceKm) })),
      ),
      h("p", { class: "it-desc" }, it.description),
      shared && h("p", { class: "it-rating small", "data-rating": it.rating.count }, it.rating.count ? tn(it.rating.count, "★ {avg} / 5 · {n} review", "★ {avg} / 5 · {n} reviews", { avg: it.rating.average.toFixed(1) }) : t("No ratings yet")),
      h("div", { class: "it-foot" }, h("span", { class: `it-source${shared ? " it-source-user" : ""}` }, shared ? t("Shared by {name}", { name: it.author }) : t("Curated by Wayline")), h("button", { class: "btn btn-outline btn-sm", type: "button", onclick: open }, t("Preview"))),
    ),
  );
}

const hue = (s) => [...s].reduce((a, c) => (a * 31 + c.charCodeAt(0)) % 360, 7);

// the band shows the trip's cover photo when there is one (credited on
// /credits), else its colour; a photo that fails to load leaves the colour
export function tripCard(it, { cls = "trip-card" } = {}) {
  const photo = photoFor(it.cover);
  return h(
    "a",
    { class: cls, href: `/trips/${it.id}`, "data-link": true, style: `--hue:${hue(it.destination)}` },
    h("div", { class: `trip-card-band${photo ? " has-photo" : ""}` }, coverImg(photo, { decorative: true }), h("span", { class: "trip-card-dest" }, it.destination)),
    h(
      "div",
      { class: "trip-card-body" },
      h("h3", {}, it.title),
      h("p", { class: "trip-card-dates" }, fmtRange(it.startDate, it.endDate)),
      it.basedOn && h("p", { class: "trip-card-origin small muted" }, t("Based on a trip by {name}", { name: it.basedOn })),
      h(
        "p",
        { class: "trip-card-meta" },
        h("span", {}, tn(it.people, "{n} traveller", "{n} travellers")),
        it.role !== "owner" && h("span", {}, t("Owner: {name}", { name: it.ownerName })),
        h("span", {}, t("Updated {when}", { when: relTime(it.updatedAt) })),
      ),
    ),
  );
}

export function renderHome(app, ctx) {
  const { me, config, navigate } = ctx;
  const S = {
    current: store.get(LOC_KEY), // where the visitor is
    dest: store.get(DEST_KEY), // where they chose to explore
    place: null, // what the page shows: the destination if set, else the current location
    category: "all",
    session: null,
    suggestions: [],
    active: -1,
    aborter: null,
    timer: null,
    area: sessionStorage.getItem?.("wayline.area") ?? "all", // region filter, kept for this tab
    country: null,
    showAll: false, // "All destinations": every itinerary, not just the featured
  };
  const geoChoice = () => store.get(GEO_KEY);
  const geoDenied = () => geoChoice() === "denied";
  const activePlace = () => (S.dest ? { ...S.dest, source: "destination" } : S.current ? { ...S.current, source: "location" } : null);

  // --- hero & search ---
  const input = h("input", {
    type: "search",
    id: "dest-search",
    placeholder: t("Search a city or destination"),
    autocomplete: "off",
    role: "combobox",
    "aria-expanded": "false",
    "aria-controls": "dest-list",
    "aria-autocomplete": "list",
    maxlength: 80,
  });
  const list = h("ul", { id: "dest-list", class: "suggest", role: "listbox", hidden: true });
  const geoBtn = h("button", { class: "btn btn-ghost geo-btn", type: "button", onclick: () => useMyLocation() }, icon("locate"), t("Use my location"));
  const status = h("p", { class: "hero-status", role: "status" });
  const placeChip = h("div", { class: "place-chip" });
  // first visit only: the browser's own prompt appears after "Use my location" is pressed
  const geoPrompt = h(
    "div",
    { class: "geo-prompt", role: "region", "aria-label": t("Use your location"), hidden: true },
    h("span", { class: "geo-prompt-icon", "aria-hidden": "true" }, icon("locate")),
    h(
      "div",
      { class: "geo-prompt-text" },
      h("strong", {}, t("See what's near you?")),
      h("p", {}, t("Your browser asks first. Wayline keeps only a rough copy (about 1 km), on this device.")),
    ),
    h(
      "div",
      { class: "geo-prompt-actions" },
      h("button", { class: "btn btn-primary btn-sm", type: "button", onclick: () => useMyLocation() }, t("Use my location")),
      h("button", { class: "btn btn-ghost btn-sm", type: "button", onclick: notNow }, t("Not now")),
    ),
  );

  // the journey hero: a window travelling through five destinations, and
  // two ways in, nothing to fill in. A destination without a curated trip
  // is shown on the map below instead.
  const hero = journeyHero({
    start: () => (me ? ctx.createTrip() : navigate("/login?next=/")),
    onSearch: (place) => {
      setDestination(place);
      explore.el.scrollIntoView({ behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
    },
  });

  // search a destination or use your location: where nearby ideas come from
  const finder = h(
    "div",
    { class: "finder" },
    h(
      "form",
      { class: "hero-search", role: "search", onsubmit: (e) => { e.preventDefault(); pick(S.active >= 0 ? S.active : 0); } },
      h("label", { for: "dest-search", class: "sr-only" }, t("Search a destination")),
      icon("search"),
      input,
      h("button", { class: "btn btn-primary", type: "submit" }, t("Explore")),
      list,
    ),
    geoPrompt,
    h("div", { class: "hero-actions" }, geoBtn, placeChip),
    status,
  );

  input.addEventListener("input", () => {
    clearTimeout(S.timer);
    const q = input.value.trim();
    if (q.length < 2) return closeList();
    S.session ??= uid();
    S.timer = setTimeout(() => suggest(q), 300); // debounce
  });
  input.addEventListener("keydown", (e) => {
    if (list.hidden) return;
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      S.active = (S.active + (e.key === "ArrowDown" ? 1 : -1) + S.suggestions.length) % S.suggestions.length;
      renderList();
    } else if (e.key === "Escape") closeList();
  });
  input.addEventListener("blur", () => setTimeout(closeList, 150));

  async function suggest(q) {
    S.aborter?.abort();
    S.aborter = new AbortController();
    try {
      const res = await fetch(`/api/places/autocomplete?q=${encodeURIComponent(q)}&kind=city&session=${S.session}`, { signal: S.aborter.signal });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      S.suggestions = data.suggestions;
      S.source = data.source;
      S.active = -1;
      renderList();
    } catch (err) {
      if (err.name === "AbortError") return;
      S.suggestions = [];
      list.hidden = false;
      list.replaceChildren(h("li", { class: "suggest-empty" }, err.message || t("Search isn't available right now.")));
    }
  }

  function renderList() {
    list.hidden = false;
    input.setAttribute("aria-expanded", "true");
    if (!S.suggestions.length) {
      list.replaceChildren(h("li", { class: "suggest-empty" }, S.source === "demo" ? t("Without Google configured, only Canberra, Sydney and Tokyo can be searched. The cities under Explore ready-made trips work too.") : t("No matching destinations.")));
      return;
    }
    list.replaceChildren(
      ...S.suggestions.map((s, i) =>
        h(
          "li",
          { role: "option", id: `dest-opt-${i}`, class: i === S.active ? "on" : "", "aria-selected": String(i === S.active), onmousedown: (e) => { e.preventDefault(); pick(i); } },
          h("strong", {}, s.main),
          s.secondary && h("span", {}, s.secondary),
        ),
      ),
      S.source === "demo" ? h("li", { class: "suggest-foot" }, t("Demo destinations (Google not configured)")) : h("li", { class: "suggest-foot attrib", translate: "no" }, "Google Maps"),
    );
    if (S.active >= 0) input.setAttribute("aria-activedescendant", `dest-opt-${S.active}`);
  }

  function closeList() {
    list.hidden = true;
    input.setAttribute("aria-expanded", "false");
    input.removeAttribute("aria-activedescendant");
  }

  async function pick(i) {
    const s = S.suggestions[i];
    if (!s) return;
    closeList();
    status.textContent = t("Loading {place}…", { place: s.main });
    try {
      const p = await api(`/api/places/${encodeURIComponent(s.placeId)}?view=basic${S.session ? `&session=${S.session}` : ""}`);
      S.session = null; // the session ends with the details call
      input.value = "";
      setDestination({ label: s.secondary ? `${s.main}, ${s.secondary.split(",").pop().trim()}` : s.main, lat: p.lat, lng: p.lng });
      status.textContent = "";
      // the map below the search moves there and lists its places
      explore.el.querySelector(".xm-grid").scrollIntoView({ behavior: "smooth", block: "nearest" });
    } catch (err) {
      status.textContent = err.message;
    }
  }

  // --- location ---
  async function useMyLocation() {
    if (geoDenied() && (await permissionState()) !== "granted") {
      status.textContent = t("Location access is off for Wayline in this browser. Search for a destination instead, or allow location in your browser settings and reload.");
      return;
    }
    locate();
  }

  function notNow() {
    store.set(GEO_KEY, "dismissed");
    renderPrompt();
  }

  // quiet: the once-per-visit refresh for someone who already said yes, while
  // the browser still grants permission, so no prompt can appear
  function locate({ quiet = false } = {}) {
    if (!navigator.geolocation) {
      if (!quiet) status.textContent = t("This browser can't share its location. Search for a destination instead.");
      return;
    }
    geoBtn.disabled = true;
    if (!quiet) status.textContent = t("Finding your location…");
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const here = { lat: pos.coords.latitude, lng: pos.coords.longitude };
        // still in the same area: keep the name instead of geocoding again
        let label = S.current && kmApart(S.current, here) < 2 ? S.current.label : null;
        if (!label) {
          try {
            label = (await api(`/api/geo/reverse?lat=${here.lat}&lng=${here.lng}`)).label;
          } catch {
            label = t("Your location");
          }
        }
        geoBtn.disabled = false;
        status.textContent = "";
        store.set(GEO_KEY, "allowed");
        setCurrent({ label, ...here }, { show: !quiet });
      },
      (err) => {
        geoBtn.disabled = false;
        if (err.code === 1) {
          store.set(GEO_KEY, "denied");
          S.current = null; // permission withdrawn: don't keep using an old position
          store.set(LOC_KEY, null);
          if (!quiet) status.textContent = t("Location permission was denied, so Wayline won't ask again. Search for a destination instead.");
          refresh();
        } else if (!quiet) {
          status.textContent = err.code === 3 ? t("Finding your location took too long. Try again, or search for a destination.") : t("Your location couldn't be determined. Search for a destination instead.");
        }
      },
      { enableHighAccuracy: false, timeout: 10_000, maximumAge: 10 * 60_000 },
    );
  }

  // show: pressing "Use my location" means "show me where I am", so it also
  // leaves the destination; a quiet refresh doesn't
  function setCurrent(c, { show }) {
    S.current = { ...c, at: Date.now() };
    store.set(LOC_KEY, roughly(S.current));
    if (show) {
      S.dest = null;
      store.set(DEST_KEY, null);
    }
    refresh();
  }

  function setDestination(d) {
    S.dest = d;
    store.set(DEST_KEY, roughly(d));
    refresh();
  }

  function clearDestination() {
    S.dest = null;
    store.set(DEST_KEY, null);
    refresh();
  }

  function forgetLocation() {
    S.current = null;
    store.set(LOC_KEY, null);
    store.set(GEO_KEY, "dismissed");
    refresh();
  }

  // recomputes what the page shows; reloads results only when that changed
  function refresh() {
    const next = activePlace();
    const prev = S.place;
    S.place = next;
    renderPrompt();
    renderPlaceChip();
    if (!prev && !next) return;
    if (prev && next && prev.lat === next.lat && prev.lng === next.lng && prev.source === next.source) return;
    explore.setOrigin(next);
    loadNear();
  }

  function renderPrompt() {
    geoPrompt.hidden = Boolean(geoChoice() || S.current || !navigator.geolocation);
    geoBtn.hidden = !geoPrompt.hidden || (geoDenied() && !S.place);
  }

  function renderPlaceChip() {
    if (!S.place) return placeChip.replaceChildren(geoDenied() ? h("span", { class: "muted small" }, t("Location is off. Search for a destination above.")) : "");
    const change = h("button", { class: "linklike small", type: "button", onclick: () => input.focus() }, t("Change"));
    if (S.place.source === "location") {
      return placeChip.replaceChildren(
        h("span", { class: "chip chip-place" }, icon("locate"), t("Current location: "), h("strong", {}, S.place.label)),
        change,
        h("button", { class: "linklike small", type: "button", onclick: forgetLocation }, t("Forget")),
      );
    }
    placeChip.replaceChildren(
      h("span", { class: "chip chip-place" }, icon("pin"), t("Exploring: "), h("strong", {}, S.place.label)),
      change,
      S.current
        ? h("button", { class: "linklike small", type: "button", onclick: clearDestination }, t("Back to {place}", { place: S.current.label }))
        : h("button", { class: "linklike small", type: "button", onclick: clearDestination }, t("Clear")),
    );
  }

  // --- near you ---
  // ranked by the chosen place; with none, the region browser below stands
  // in. After "Find journeys" on the map, the same section shows the plans
  // that match the visitor's picks, with why each is there.
  const nearTitle = h("h2", {});
  const nearSub = h("p", { class: "section-sub" });
  const chips = h("div", { class: "cat-chips", role: "group", "aria-label": t("Filter by category") });
  const nearGrid = h("div", { class: "it-grid", "aria-live": "polite" });
  const matchBox = h("div", { class: "dx-results", "aria-live": "polite" });
  const backToAll = h("button", { class: "linklike small", type: "button", onclick: () => { picks.setAsked(false); renderNearMode(); loadNear(); } }, t("Show every plan here instead"));
  const near = h("section", { class: "home-section near", id: "near" }, h("div", { class: "section-head" }, h("div", {}, nearTitle, nearSub)), chips, nearGrid, matchBox);
  const picks = createPicks();

  function renderChips() {
    chips.replaceChildren(
      ...[["all", t("All")], ...Object.entries(CATEGORY_LABEL)].map(([k, label]) =>
        h("button", { type: "button", class: `cat-chip${S.category === k ? " on" : ""}`, "aria-pressed": String(S.category === k), onclick: () => { S.category = k; renderChips(); loadNear(); } }, label),
      ),
    );
  }

  const skeletons = () => Array.from({ length: 3 }, () => h("div", { class: "it-card skeleton", "aria-hidden": "true" }, h("div", { class: "it-cover" }), h("div", { class: "it-body" }, h("span"), h("span"), h("span"))));

  // matching: the near section's grid gives way to the ranked plans
  const matching = () => picks.state.asked && Boolean(S.place);
  function renderNearMode() {
    const on = matching();
    chips.hidden = on;
    nearGrid.hidden = on;
    matchBox.hidden = !on;
    if (!on) matchBox.replaceChildren();
  }

  let findSeq = 0;
  async function runFind({ scroll = true } = {}) {
    if (!S.place) return;
    const seq = ++findSeq;
    picks.setAsked(true);
    renderNearMode();
    near.hidden = false;
    const P = picks.state;
    nearTitle.textContent = S.place.source === "location" ? t("Journeys near you") : t("Journeys for {place}", { place: S.place.label });
    nearSub.replaceChildren(
      P.places.length || P.food.length || P.days !== null
        ? t("Wayline\u2019s ready-made plans, ranked by the places, length and food you picked on the map. ")
        : S.place.source === "location"
          ? t("Every ready-made plan near you. Save places on the map to rank them. ")
          : t("Every ready-made plan for {place}. Save places on the map to rank them. ", { place: S.place.label }),
      backToAll,
    );
    matchBox.replaceChildren(h("p", { class: "muted" }, t("Looking through Wayline\u2019s plans\u2026")));
    if (scroll) near.scrollIntoView({ behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "start" });
    try {
      const into = h("div", {});
      await findJourneys(ctx, picks, S.place, into, { onRelax: () => runFind({ scroll: false }) });
      if (seq === findSeq) matchBox.replaceChildren(...into.childNodes);
    } catch (err) {
      if (seq === findSeq) matchBox.replaceChildren(h("p", { class: "form-error" }, err.message));
    }
  }

  let loadSeq = 0;
  async function loadNear() {
    if (matching()) return runFind({ scroll: false });
    renderNearMode();
    const seq = ++loadSeq;
    const cat = S.category === "all" ? "" : `&category=${S.category}`;
    nearTitle.textContent = S.place ? (S.place.source === "location" ? t("Near you") : t("Ideas for {place}", { place: S.place.label })) : t("Ideas to get you started");
    nearSub.textContent = S.place
      ? S.place.source === "location"
        ? t("Curated itineraries ranked by distance from where you are.")
        : t("Curated itineraries ranked by distance from {place}.", { place: S.place.label })
      : t("Use your location or search a destination to see itineraries near you. Meanwhile, here are all of Wayline's curated routes.");
    near.hidden = !S.place;
    nearGrid.replaceChildren(...skeletons());
    try {
      if (!S.place) {
        const { itineraries } = await api(`/api/itineraries?${cat.slice(1)}`);
        if (seq === loadSeq) fill(itineraries);
        return;
      }
      const { itineraries } = await api(`/api/itineraries/nearby?lat=${S.place.lat}&lng=${S.place.lng}${cat}`);
      if (seq !== loadSeq) return;
      if (itineraries.length) return fill(itineraries);
      if (S.category !== "all") {
        nearGrid.replaceChildren(h("div", { class: "empty-inline" }, h("p", {}, t("No {category} itineraries near {place} yet.", { category: CATEGORY_LABEL[S.category], place: S.place.label })), h("button", { class: "btn btn-ghost btn-sm", type: "button", onclick: () => { S.category = "all"; renderChips(); loadNear(); } }, t("Show all categories"))));
        return;
      }
      await attractionsFallback(seq);
    } catch (err) {
      if (seq === loadSeq) nearGrid.replaceChildren(h("div", { class: "empty-inline" }, h("p", { class: "form-error" }, err.message), h("button", { class: "btn btn-ghost btn-sm", type: "button", onclick: loadNear }, t("Try again"))));
    }
  }

  function fill(items) {
    nearGrid.replaceChildren(...(items.length ? items.map((it) => itineraryCard(it, ctx)) : [h("div", { class: "empty-inline" }, h("p", {}, t("No itineraries in this category yet.")))]));
  }

  // No curated itinerary nearby: individual places from Google, clearly
  // presented as places, not itineraries.
  async function attractionsFallback(seq) {
    const intro = h(
      "div",
      { class: "empty-inline wide" },
      h("h3", {}, t("Wayline doesn't have itineraries near {place} yet", { place: S.place.label })),
      h("p", { class: "muted" }, t("Curated routes cover a set of cities across Europe, North America, Asia and Oceania (see Explore ready-made trips). Below are individual places nearby, not complete itineraries.")),
    );
    nearGrid.replaceChildren(intro);
    try {
      const res = await api(`/api/places/nearby?lat=${S.place.lat}&lng=${S.place.lng}&radius=15000`);
      if (seq !== loadSeq) return;
      if (!res.places.length) {
        intro.append(h("p", { class: "muted small" }, res.source === "demo" ? t("Nearby places need Google Maps configured on the server.") : t("Google Maps found no notable places nearby.")));
        return;
      }
      nearGrid.append(
        h(
          "div",
          { class: "attractions wide" },
          h("h3", { class: "attractions-title" }, t("Individual places nearby")),
          h(
            "ul",
            { class: "place-list" },
            res.places.map((p) =>
              h(
                "li",
                {},
                h(
                  "button",
                  { type: "button", class: "place-row", onclick: () => placeDialog({ placeId: p.placeId, name: p.name, source: p.source }, ctx) },
                  h("span", { class: "place-pin" }, icon("pin")),
                  h("span", { class: "grow" }, h("strong", {}, p.name), h("small", { class: "muted" }, [p.category, p.address].filter(Boolean).join(" · "))),
                  h("span", { class: "muted small" }, km(p.distanceKm)),
                ),
              ),
            ),
          ),
          res.source === "google" ? h("p", { class: "attrib", translate: "no" }, "Google Maps") : h("p", { class: "demo-note" }, t("Demo places (Google not configured).")),
        ),
      );
    } catch (err) {
      intro.append(h("p", { class: "form-error small" }, err.message));
    }
  }

  // what the region browser, the photo stream and the map's quick picks show
  let D = { destinations: [], areas: [], itineraries: [] };

  // --- the map, with the destination search above it ---
  // one selection shared by the map and the recommendations
  const explore = createExploreMap(ctx, {
    finder,
    ideas: quickPicks,
    picks,
    onFind: () => runFind(),
    onStart: (origin) => ctx.createTrip(origin.source === "location" ? "" : origin.label),
  });

  // before anything is chosen: a few of Wayline's cities, one click each
  // (the same as picking it in search; no Google request until the map moves)
  function quickPicks() {
    if (!D.destinations.length) return "";
    return h(
      "div",
      {},
      h("p", { class: "xm-ideas-title" }, t("Or start with a city")),
      h("div", { class: "xm-ideas" }, D.destinations.slice(0, 12).map((d) => h("button", { type: "button", class: "cat-chip", onclick: () => setDestination({ label: d.name, lat: d.lat, lng: d.lng }) }, d.name))),
    );
  }

  // --- explore by region ---
  // Global browsing by region and country, separate from "near you" (which
  // only ever uses a place the visitor chose or a location they shared).
  const AREA_ALL = "all";
  const regionTabs = h("div", { class: "rx-tabs", role: "tablist", "aria-label": t("Regions") });
  const countryTabs = h("div", { class: "rx-countries", role: "group", "aria-label": t("Countries"), hidden: true });
  const destGrid = h("div", { class: "rx-grid", "aria-live": "polite" });
  const regions = h(
    "section",
    { class: "home-section rx", id: "explore" },
    h("div", { class: "section-head rx-head" }, h("div", {}, h("p", { class: "eyebrow" }, h("span", { class: "eyebrow-n" }, "03"), t("Curated by Wayline")), h("h2", {}, t("Explore ready-made trips")), h("p", { class: "section-sub" }, t("Itineraries written by the Wayline team, city by city. To find the ones that fit you, save a few places on the map above.")))),
    h("div", { class: "rx-filters" }, regionTabs, countryTabs),
    destGrid,
  );

  const visibleDests = () => D.destinations.filter((d) => (S.area === AREA_ALL || d.area === S.area) && (!S.country || d.country === S.country));

  function renderRegions() {
    const tab = (value, label) =>
      h("button", { type: "button", role: "tab", class: `rx-tab${S.area === value ? " on" : ""}`, "aria-selected": String(S.area === value), "data-area": value, onclick: () => setArea(value) }, label);
    regionTabs.replaceChildren(tab(AREA_ALL, t("All destinations")), ...D.areas.map((a) => tab(a.area, t(a.area))));
    // a country filter only where a region has more than one country
    const countries = D.areas.find((a) => a.area === S.area)?.countries ?? [];
    countryTabs.hidden = countries.length < 2;
    countryTabs.replaceChildren(
      ...(countries.length < 2
        ? []
        : [null, ...countries].map((c) => h("button", { type: "button", class: `cat-chip${S.country === c ? " on" : ""}`, "aria-pressed": String(S.country === c), "data-country": c ?? "", onclick: () => { S.country = c; renderRegions(); renderStream(); renderFeatured(); } }, c ? t(c) : t("All")))),
    );
    const list = visibleDests();
    destGrid.replaceChildren(...(list.length ? list.map(destCard) : [h("p", { class: "muted" }, t("No destinations here yet."))]));
  }

  function setArea(value) {
    S.area = value;
    S.country = null;
    try { sessionStorage.setItem("wayline.area", value); } catch {}
    renderRegions();
    renderStream();
    renderFeatured();
  }

  // a city: its photo, name, country, how long its itineraries run, and a way in
  function destCard(d) {
    const photo = photoFor(`dest-${d.id}`);
    return h(
      "article",
      { class: "rx-card", id: `city-${d.id}`, "data-dest": d.id },
      h(
        "div",
        { class: "rx-media" },
        h("button", { type: "button", class: `rx-photo${photo ? " has-photo" : ""}`, style: `--hue:${hue(d.name)}`, "aria-label": t("Show itineraries for {place}", { place: d.name }), onclick: () => openCity(d) }, coverImg(photo, { decorative: true })),
      ),
      h(
        "div",
        { class: "rx-body" },
        h("p", { class: "rx-country" }, t(d.country)),
        h("h3", {}, d.name),
        // how long its trips run, and nothing else: the photo and name say the rest
        d.days > 0 && h("p", { class: "rx-meta" }, d.days === 1 ? t("1 day") : t("Up to {n} days", { n: d.days })),
        h("button", { class: "linklike rx-go", type: "button", onclick: () => openCity(d) }, t("See itineraries →")),
      ),
    );
  }

  // Opening a city shows its itineraries in the ideas list (like searching
  // it). It changes only the chosen destination, never the visitor's location.
  function openCity(d) {
    setDestination({ label: d.name, lat: d.lat, lng: d.lng });
    near.scrollIntoView({ behavior: "smooth" });
  }

  api("/api/itineraries/destinations")
    .then(({ destinations, areas }) => {
      D = { ...D, destinations, areas: areas ?? [] };
      if (S.area !== AREA_ALL && !D.areas.some((a) => a.area === S.area)) S.area = AREA_ALL;
      renderRegions();
      renderStream();
      explore.refresh();
    })
    .catch((err) => destGrid.replaceChildren(h("p", { class: "form-error" }, err.message)));

  // --- travel photo stream ---
  const streamHead = h("div", { class: "section-head" }, h("div", {}, h("p", { class: "eyebrow" }, h("span", { class: "eyebrow-n" }, "02"), t("Destinations")), h("h2", {}, t("Where people are going"))));
  const stream = photoStream([], { onCity: openCity, navigate });
  const streamSection = h("section", { class: "ps", "aria-labelledby": "ps-h" }, h("div", { class: "home-section ps-head" }, streamHead), stream.el);
  streamHead.querySelector("h2").id = "ps-h";
  function renderStream() {
    // Follows what the visitor picked (region, then country), never the
    // hero's scenes. Too few photos for a country: its region's; too few for
    // the region: everywhere, so the row never looks empty.
    // itinerary photos only: the city cards just below already show each
    // city's own photo, and the same picture twice on one page cheapens both
    const all = streamItems(D.destinations, D.itineraries).filter((x) => !x.key.startsWith("dest-"));
    const inArea = S.area === AREA_ALL ? all : all.filter((x) => x.dest.area === S.area);
    const inCountry = S.country ? inArea.filter((x) => x.dest.country === S.country) : inArea;
    stream.render(inCountry.length >= 4 ? inCountry : inArea.length >= 4 ? inArea : all);
  }
  api("/api/itineraries")
    .then(({ itineraries }) => {
      D = { ...D, itineraries };
      renderStream();
      renderFeatured();
    })
    .catch(() => {});

  // --- itineraries for the region (under its cities, same filters) ---
  // "All destinations": the featured ones, with a way to see every one. A
  // region or country: every itinerary there. Never ranked by popularity.
  const featTitle = h("h3", { class: "rx-sub" });
  const featGrid = h("div", { class: "it-grid it-index", "aria-live": "polite" }, ...skeletons());
  const featMore = h("button", { class: "btn btn-ghost btn-sm", type: "button", hidden: true, onclick: () => { S.showAll = true; renderFeatured(); } }, t("Show all itineraries"));
  const featured = h("div", { class: "rx-its", id: "itineraries" }, featTitle, featGrid, featMore);
  let featuredIds = null;
  api("/api/itineraries/featured?limit=8")
    .then(({ itineraries }) => {
      featuredIds = itineraries.map((it) => it.id);
      renderFeatured();
    })
    .catch((err) => featGrid.replaceChildren(h("p", { class: "form-error" }, err.message)));
  function renderFeatured() {
    if (!featuredIds || !D.itineraries.length) return;
    const where = S.country ?? (S.area === AREA_ALL ? null : S.area);
    const inPlace = D.itineraries.filter((it) => it.source !== "user" && (S.area === AREA_ALL || it.area === S.area) && (!S.country || it.country === S.country));
    const list = where || S.showAll ? inPlace : featuredIds.map((id) => D.itineraries.find((it) => it.id === id)).filter(Boolean);
    featTitle.textContent = where ? t("Itineraries in {place}", { place: t(where) }) : S.showAll ? t("All itineraries") : t("Featured itineraries");
    featGrid.replaceChildren(...(list.length ? list.map((it, i) => itineraryCard(it, ctx, i)) : [h("p", { class: "muted" }, t("No itineraries here yet."))]));
    featMore.hidden = Boolean(where || S.showAll) || inPlace.length <= list.length;
    featMore.textContent = t("Show all {n} itineraries", { n: inPlace.length });
  }

  // trips travellers published: their own section, labelled by author, never
  // ranked in among Wayline's curated itineraries
  const sharedGrid = h("div", { class: "it-grid" });
  const sharedSection = h(
    "section",
    { class: "home-section", id: "shared", hidden: true },
    h("div", { class: "section-head" }, h("div", {}, h("h2", {}, t("Shared by travellers")), h("p", { class: "section-sub" }, t("Trips other Wayline travellers published. Preview one, rate it, or use it as the start of your own.")))),
    sharedGrid,
  );
  api("/api/publications")
    .then(({ publications }) => {
      sharedSection.hidden = publications.length === 0;
      sharedGrid.replaceChildren(...publications.slice(0, 9).map((it) => itineraryCard(it, ctx)));
    })
    .catch(() => {});

  regions.append(featured);
  // search first, then inspiration, then ready-made trips (near the chosen place, then by region)
  app.replaceChildren(ctx.topbar("home"), h("main", { class: "home" }, hero.el, explore.el, streamSection, near, regions, sharedSection), ctx.footer());

  S.place = activePlace();
  renderChips();
  renderPrompt();
  renderPlaceChip();
  loadNear();
  if (S.place) explore.setOrigin(S.place);
  permissionState().then((state) => {
    if (state === "denied") {
      // refused in the browser (now or since last visit): stop offering, drop the old position
      store.set(GEO_KEY, "denied");
      if (S.current) {
        S.current = null;
        store.set(LOC_KEY, null);
      }
      return refresh();
    }
    if (geoDenied() && state) store.set(GEO_KEY, "dismissed"); // re-allowed in browser settings
    const stale = !S.current || Date.now() - (S.current.at ?? 0) > REFRESH_MS;
    if (geoChoice() === "allowed" && state === "granted" && stale) locate({ quiet: true });
    renderPrompt();
    renderPlaceChip();
  });
  if (location.hash === "#explore") requestAnimationFrame(() => regions.scrollIntoView());
  if (location.hash === "#discover") requestAnimationFrame(() => explore.el.scrollIntoView());
  if (location.hash === "#explore-map") requestAnimationFrame(() => explore.el.scrollIntoView());
  // back from a preview: the list it came from (nearby when a place is chosen)
  if (location.hash === "#near") requestAnimationFrame(() => (near.hidden ? regions : near).scrollIntoView());

  return () => {
    clearTimeout(S.timer);
    S.aborter?.abort();
    explore.destroy();
    hero.destroy();
  };
}
