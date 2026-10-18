import { createExploreMap } from "/explore-map.js";
import { coverImg, photoCredit, photoFor } from "/photos.js";
import { placeDialog } from "/places.js";
import { api, dur, fmtRange, h, icon, km, relTime, uid } from "/ui.js";

export const CATEGORY_LABEL = {
  "half-day": "Half-day",
  "one-day": "One-day",
  weekend: "Weekend",
  "food-culture": "Food & Culture",
  "nature-outdoors": "Nature & Outdoors",
  "city-highlights": "City Highlights",
};
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

export function itineraryCard(t, { navigate }) {
  const shared = t.source === "user";
  const primary = t.categories.find((c) => !["half-day", "one-day", "weekend"].includes(c)) ?? t.categories[0];
  const length = t.days > 1 ? `${t.days} days` : `About ${dur(Math.round(t.durationMin / 30) * 30)}`;
  const open = () => navigate(`/itineraries/${t.id}`);
  const photo = photoFor(shared ? t.cover : t.id);
  return h(
    "article",
    { class: "it-card", dataset: { id: t.id } },
    h(
      "div",
      { class: `it-cover cover-${primary}${photo ? " has-photo" : ""}`, style: `--hue:${(CATEGORY_HUE[primary] ?? 260) + (hue(t.title) % 28)}` },
      coverImg(photo),
      h("span", { class: "it-cover-glyph", "aria-hidden": "true" }, icon(CATEGORY_ICON[primary] ?? "spark")),
      h("span", { class: "it-cover-dest", "aria-hidden": "true" }, t.destination),
      photoCredit(photo, { short: true }),
    ),
    h(
      "div",
      { class: "it-body" },
      h("p", { class: "it-tags" }, t.categories.map((c) => h("span", { class: "tag" }, CATEGORY_LABEL[c] ?? c))),
      h("h3", {}, h("a", { href: `/itineraries/${t.id}`, "data-link": true }, t.title)),
      h(
        "p",
        { class: "it-meta" },
        h("span", {}, t.destination),
        h("span", {}, length),
        h("span", {}, `${t.stopCount} ${t.stopCount === 1 ? "stop" : "stops"}`),
        typeof t.distanceKm === "number" && h("span", { class: "it-distance" }, t.distanceKm < 1 ? "Right here" : `${km(t.distanceKm)} away`),
      ),
      h("p", { class: "it-desc" }, t.description),
      shared && h("p", { class: "it-rating small", "data-rating": t.rating.count }, t.rating.count ? `★ ${t.rating.average.toFixed(1)} / 5 · ${t.rating.count} ${t.rating.count === 1 ? "review" : "reviews"}` : "No ratings yet"),
      h("div", { class: "it-foot" }, h("span", { class: `it-source${shared ? " it-source-user" : ""}` }, shared ? `Shared by ${t.author}` : "Curated by Wayline"), h("button", { class: "btn btn-outline btn-sm", type: "button", onclick: open }, "Preview")),
    ),
  );
}

const hue = (s) => [...s].reduce((a, c) => (a * 31 + c.charCodeAt(0)) % 360, 7);

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
  };
  const geoChoice = () => store.get(GEO_KEY);
  const geoDenied = () => geoChoice() === "denied";
  const activePlace = () => (S.dest ? { ...S.dest, source: "destination" } : S.current ? { ...S.current, source: "location" } : null);

  // --- hero & search ---
  const input = h("input", {
    type: "search",
    id: "dest-search",
    placeholder: "Search a city or destination",
    autocomplete: "off",
    role: "combobox",
    "aria-expanded": "false",
    "aria-controls": "dest-list",
    "aria-autocomplete": "list",
    maxlength: 80,
  });
  const list = h("ul", { id: "dest-list", class: "suggest", role: "listbox", hidden: true });
  const geoBtn = h("button", { class: "btn btn-ghost geo-btn", type: "button", onclick: () => useMyLocation() }, icon("locate"), "Use my location");
  const status = h("p", { class: "hero-status", role: "status" });
  const placeChip = h("div", { class: "place-chip" });
  // first visit only: the browser's own prompt appears after "Use my location" is pressed
  const geoPrompt = h(
    "div",
    { class: "geo-prompt", role: "region", "aria-label": "Use your location", hidden: true },
    h("span", { class: "geo-prompt-icon", "aria-hidden": "true" }, icon("locate")),
    h(
      "div",
      { class: "geo-prompt-text" },
      h("strong", {}, "See what's near you?"),
      h("p", {}, "Wayline can use your location to recommend nearby attractions, restaurants and itineraries. Your browser asks first, and Wayline keeps only a rough copy (about 1 km) on this device."),
    ),
    h(
      "div",
      { class: "geo-prompt-actions" },
      h("button", { class: "btn btn-primary btn-sm", type: "button", onclick: () => useMyLocation() }, "Use my location"),
      h("button", { class: "btn btn-ghost btn-sm", type: "button", onclick: notNow }, "Not now"),
    ),
  );

  const hero = h(
    "section",
    { class: "hero" },
    h(
      "div",
      { class: "hero-inner" },
      h("p", { class: "eyebrow" }, "Plan together, travel well"),
      h("h1", {}, "Your next journey starts here."),
      h("p", { class: "lede" }, "Find ready-made routes near you or wherever you're headed, preview them on the map, then copy one into a trip you plan with friends in real time."),
      h(
        "form",
        { class: "hero-search", role: "search", onsubmit: (e) => { e.preventDefault(); pick(S.active >= 0 ? S.active : 0); } },
        h("label", { for: "dest-search", class: "sr-only" }, "Search a destination"),
        icon("search"),
        input,
        h("button", { class: "btn btn-primary", type: "submit" }, "Explore"),
        list,
      ),
      geoPrompt,
      h("div", { class: "hero-actions" }, geoBtn, placeChip),
      status,
    ),
    h("div", { class: "hero-art-postcards", "aria-hidden": "true" }, [
      ["Sydney", "Harbour walk", "cover-city-highlights", 200, "tpl-sydney-harbour-highlights"],
      ["Canberra", "Lookouts", "cover-nature-outdoors", 140, "tpl-canberra-lookouts-gardens"],
      ["Tokyo", "Asakusa", "cover-food-culture", 20, "tpl-tokyo-asakusa-ueno"],
    ].map(([city, label, cls, hu, key], i) =>
      h("div", { class: `postcard pc-${i} ${cls}${photoFor(key) ? " has-photo" : ""}`, style: `--hue:${hu}` }, coverImg(photoFor(key), { eager: true, decorative: true }), h("b", {}, city), h("span", {}, label)),
    )),
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
      list.replaceChildren(h("li", { class: "suggest-empty" }, err.message || "Search isn't available right now."));
    }
  }

  function renderList() {
    list.hidden = false;
    input.setAttribute("aria-expanded", "true");
    if (!S.suggestions.length) {
      list.replaceChildren(h("li", { class: "suggest-empty" }, S.source === "demo" ? "Without Google configured, only Canberra, Sydney and Tokyo can be searched." : "No matching destinations."));
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
      S.source === "demo" ? h("li", { class: "suggest-foot" }, "Demo destinations (Google not configured)") : h("li", { class: "suggest-foot attrib", translate: "no" }, "Google Maps"),
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
    status.textContent = `Loading ${s.main}…`;
    try {
      const p = await api(`/api/places/${encodeURIComponent(s.placeId)}?view=basic${S.session ? `&session=${S.session}` : ""}`);
      S.session = null; // the session ends with the details call
      input.value = "";
      setDestination({ label: s.secondary ? `${s.main}, ${s.secondary.split(",").pop().trim()}` : s.main, lat: p.lat, lng: p.lng });
      status.textContent = "";
      near.scrollIntoView({ behavior: "smooth", block: "start" });
    } catch (err) {
      status.textContent = err.message;
    }
  }

  // --- location ---
  async function useMyLocation() {
    if (geoDenied() && (await permissionState()) !== "granted") {
      status.textContent = "Location access is off for Wayline in this browser. Search for a destination instead, or allow location in your browser settings and reload.";
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
      if (!quiet) status.textContent = "This browser can't share its location. Search for a destination instead.";
      return;
    }
    geoBtn.disabled = true;
    if (!quiet) status.textContent = "Finding your location…";
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const here = { lat: pos.coords.latitude, lng: pos.coords.longitude };
        // still in the same area: keep the name instead of geocoding again
        let label = S.current && kmApart(S.current, here) < 2 ? S.current.label : null;
        if (!label) {
          try {
            label = (await api(`/api/geo/reverse?lat=${here.lat}&lng=${here.lng}`)).label;
          } catch {
            label = "Your location";
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
          if (!quiet) status.textContent = "Location permission was denied, so Wayline won't ask again. Search for a destination instead.";
          refresh();
        } else if (!quiet) {
          status.textContent = err.code === 3 ? "Finding your location took too long. Try again, or search for a destination." : "Your location couldn't be determined. Search for a destination instead.";
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
    if (!S.place) return placeChip.replaceChildren(geoDenied() ? h("span", { class: "muted small" }, "Location is off. Search for a destination above.") : "");
    const change = h("button", { class: "linklike small", type: "button", onclick: () => input.focus() }, "Change");
    if (S.place.source === "location") {
      return placeChip.replaceChildren(
        h("span", { class: "chip chip-place" }, icon("locate"), "Current location: ", h("strong", {}, S.place.label)),
        change,
        h("button", { class: "linklike small", type: "button", onclick: forgetLocation }, "Forget"),
      );
    }
    placeChip.replaceChildren(
      h("span", { class: "chip chip-place" }, icon("pin"), "Exploring: ", h("strong", {}, S.place.label)),
      change,
      S.current
        ? h("button", { class: "linklike small", type: "button", onclick: clearDestination }, `Back to ${S.current.label}`)
        : h("button", { class: "linklike small", type: "button", onclick: clearDestination }, "Clear"),
    );
  }

  // --- near you ---
  const nearTitle = h("h2", {});
  const nearSub = h("p", { class: "section-sub" });
  const chips = h("div", { class: "cat-chips", role: "group", "aria-label": "Filter by category" });
  const nearGrid = h("div", { class: "it-grid", "aria-live": "polite" });
  const near = h("section", { class: "home-section", id: "near" }, h("div", { class: "section-head" }, h("div", {}, nearTitle, nearSub)), chips, nearGrid);

  function renderChips() {
    chips.replaceChildren(
      ...[["all", "All"], ...Object.entries(CATEGORY_LABEL)].map(([k, label]) =>
        h("button", { type: "button", class: `cat-chip${S.category === k ? " on" : ""}`, "aria-pressed": String(S.category === k), onclick: () => { S.category = k; renderChips(); loadNear(); } }, label),
      ),
    );
  }

  const skeletons = () => Array.from({ length: 3 }, () => h("div", { class: "it-card skeleton", "aria-hidden": "true" }, h("div", { class: "it-cover" }), h("div", { class: "it-body" }, h("span"), h("span"), h("span"))));

  let loadSeq = 0;
  async function loadNear() {
    const seq = ++loadSeq;
    const cat = S.category === "all" ? "" : `&category=${S.category}`;
    nearTitle.textContent = S.place ? (S.place.source === "location" ? "Near you" : `Ideas for ${S.place.label}`) : "Ideas to get you started";
    nearSub.textContent = S.place
      ? `Curated itineraries ranked by distance from ${S.place.source === "location" ? "where you are" : S.place.label}.`
      : "Use your location or search a destination to see itineraries near you. Meanwhile, here are all of Wayline's curated routes.";
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
        nearGrid.replaceChildren(h("div", { class: "empty-inline" }, h("p", {}, `No ${CATEGORY_LABEL[S.category]} itineraries near ${S.place.label} yet.`), h("button", { class: "btn btn-ghost btn-sm", type: "button", onclick: () => { S.category = "all"; renderChips(); loadNear(); } }, "Show all categories")));
        return;
      }
      await attractionsFallback(seq);
    } catch (err) {
      if (seq === loadSeq) nearGrid.replaceChildren(h("div", { class: "empty-inline" }, h("p", { class: "form-error" }, err.message), h("button", { class: "btn btn-ghost btn-sm", type: "button", onclick: loadNear }, "Try again")));
    }
  }

  function fill(items) {
    nearGrid.replaceChildren(...(items.length ? items.map((t) => itineraryCard(t, ctx)) : [h("div", { class: "empty-inline" }, h("p", {}, "No itineraries in this category yet."))]));
  }

  // No curated itinerary nearby: individual places from Google, clearly
  // presented as places, not itineraries.
  async function attractionsFallback(seq) {
    const intro = h(
      "div",
      { class: "empty-inline wide" },
      h("h3", {}, `Wayline doesn't have itineraries near ${S.place.label} yet`),
      h("p", { class: "muted" }, "Curated routes currently cover Canberra, Sydney and Tokyo. Below are individual places nearby, not complete itineraries."),
    );
    nearGrid.replaceChildren(intro);
    try {
      const res = await api(`/api/places/nearby?lat=${S.place.lat}&lng=${S.place.lng}&radius=15000`);
      if (seq !== loadSeq) return;
      if (!res.places.length) {
        intro.append(h("p", { class: "muted small" }, res.source === "demo" ? "Nearby places need Google Maps configured on the server." : "Google Maps found no notable places nearby."));
        return;
      }
      nearGrid.append(
        h(
          "div",
          { class: "attractions wide" },
          h("h3", { class: "attractions-title" }, "Individual places nearby"),
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
          res.source === "google" ? h("p", { class: "attrib", translate: "no" }, "Google Maps") : h("p", { class: "demo-note" }, "Demo places (Google not configured)."),
        ),
      );
    } catch (err) {
      intro.append(h("p", { class: "form-error small" }, err.message));
    }
  }

  // --- the map ---
  const explore = createExploreMap(ctx);

  // --- explore destinations ---
  const destGrid = h("div", { class: "dest-grid" });
  const exploreDest = h(
    "section",
    { class: "home-section", id: "explore" },
    h("div", { class: "section-head" }, h("div", {}, h("h2", {}, "Explore destinations"), h("p", { class: "section-sub" }, "Pick a city to see its itineraries, wherever you are now. Or search any city above."))),
    destGrid,
  );
  api("/api/itineraries/destinations")
    .then(({ destinations }) =>
      destGrid.replaceChildren(
        ...destinations.map((d) => {
          const photo = photoFor(`dest-${d.id ?? d.name.toLowerCase()}`);
          return h(
            "button",
            { type: "button", class: `dest-card${photo ? " has-photo" : ""}`, style: `--hue:${hue(d.name)}`, onclick: () => { setDestination({ label: d.name, lat: d.lat, lng: d.lng }); near.scrollIntoView({ behavior: "smooth" }); } },
            coverImg(photo, { decorative: true }),
            h("span", { class: "dest-name" }, d.name),
            h("span", { class: "dest-region" }, d.region),
            h("span", { class: "dest-count" }, `${d.itineraries} itineraries`),
          );
        }),
      ),
    )
    .catch((err) => destGrid.replaceChildren(h("p", { class: "form-error" }, err.message)));

  // --- featured ---
  const featGrid = h("div", { class: "it-grid" }, ...skeletons());
  const featured = h(
    "section",
    { class: "home-section" },
    h("div", { class: "section-head" }, h("div", {}, h("h2", {}, "Featured itineraries"), h("p", { class: "section-sub" }, "Hand-picked sample routes from the Wayline team."))),
    featGrid,
  );
  api("/api/itineraries/featured?limit=4")
    .then(({ itineraries }) => featGrid.replaceChildren(...itineraries.map((t) => itineraryCard(t, ctx))))
    .catch((err) => featGrid.replaceChildren(h("p", { class: "form-error" }, err.message)));

  // --- my trips ---
  const tripsBox = h("div", { class: "mini-trips" });
  const myTrips = h(
    "section",
    { class: "home-section", id: "my-trips" },
    h("div", { class: "section-head" }, h("div", {}, h("h2", {}, "My trips"), h("p", { class: "section-sub" }, "Trips you plan, alone or with friends.")), me && h("a", { class: "btn btn-ghost btn-sm", href: "/trips", "data-link": true }, "View all")),
    tripsBox,
  );
  if (!me) {
    tripsBox.replaceChildren(
      h("div", { class: "empty-inline" }, h("p", {}, "Sign in to see your trips and plan with others."), h("a", { class: "btn btn-primary btn-sm", href: "/login?next=/", "data-link": true }, "Sign in or create an account")),
    );
  } else {
    tripsBox.replaceChildren(h("p", { class: "muted" }, "Loading your trips…"));
    api("/api/trips")
      .then(({ owned, shared }) => {
        const all = [...owned, ...shared].sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 4);
        tripsBox.replaceChildren(
          ...(all.length
            ? all.map((t) =>
                h(
                  "a",
                  { class: "mini-trip", href: `/trips/${t.id}`, "data-link": true, style: `--hue:${hue(t.destination)}` },
                  h("strong", {}, t.title),
                  h("span", {}, `${t.destination} · ${fmtRange(t.startDate, t.endDate)}`),
                  h("small", { class: "muted" }, `${t.people} ${t.people === 1 ? "traveller" : "travellers"} · updated ${relTime(t.updatedAt)}`),
                ),
              )
            : [h("div", { class: "empty-inline" }, h("p", {}, "No trips yet. Preview an itinerary above and copy it into a trip, or start from scratch."), h("button", { class: "btn btn-primary btn-sm", type: "button", onclick: ctx.createTrip }, "Create a trip"))]),
        );
      })
      .catch((err) => tripsBox.replaceChildren(h("p", { class: "form-error" }, err.message)));
  }

  // trips travellers published: their own section, labelled by author, never
  // ranked in among Wayline's curated itineraries
  const sharedGrid = h("div", { class: "it-grid" });
  const sharedSection = h(
    "section",
    { class: "home-section", id: "shared", hidden: true },
    h("div", { class: "section-head" }, h("div", {}, h("h2", {}, "Shared by travellers"), h("p", { class: "section-sub" }, "Trips other Wayline travellers published. Preview one, rate it, or use it as the start of your own."))),
    sharedGrid,
  );
  api("/api/publications")
    .then(({ publications }) => {
      sharedSection.hidden = publications.length === 0;
      sharedGrid.replaceChildren(...publications.slice(0, 9).map((t) => itineraryCard(t, ctx)));
    })
    .catch(() => {});

  app.replaceChildren(ctx.topbar("home"), h("main", { class: "home" }, hero, explore.el, near, exploreDest, sharedSection, featured, myTrips), ctx.footer());

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
  if (location.hash === "#explore") requestAnimationFrame(() => exploreDest.scrollIntoView());
  if (location.hash === "#near") requestAnimationFrame(() => near.scrollIntoView());

  return () => {
    clearTimeout(S.timer);
    S.aborter?.abort();
    explore.destroy();
  };
}
