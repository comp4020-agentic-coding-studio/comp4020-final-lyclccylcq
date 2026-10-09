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
const PLACE_KEY = "wayline.discover"; // session only, rounded to ~1 km
const GEO_KEY = "wayline.geo-denied";

const store = {
  get(k) {
    try {
      return JSON.parse(sessionStorage.getItem(k) ?? "null");
    } catch {
      return null;
    }
  },
  set(k, v) {
    try {
      v === null ? sessionStorage.removeItem(k) : sessionStorage.setItem(k, JSON.stringify(v));
    } catch {}
  },
};

const round = (n) => Math.round(n * 100) / 100;

export function itineraryCard(t, { navigate }) {
  const primary = t.categories.find((c) => !["half-day", "one-day", "weekend"].includes(c)) ?? t.categories[0];
  const length = t.days > 1 ? `${t.days} days` : `About ${dur(Math.round(t.durationMin / 30) * 30)}`;
  const open = () => navigate(`/itineraries/${t.id}`);
  return h(
    "article",
    { class: "it-card", dataset: { id: t.id } },
    h(
      "div",
      { class: `it-cover cover-${primary}`, style: `--hue:${(CATEGORY_HUE[primary] ?? 260) + (hue(t.title) % 28)}`, "aria-hidden": "true" },
      h("span", { class: "it-cover-glyph" }, icon(CATEGORY_ICON[primary] ?? "spark")),
      h("span", { class: "it-cover-dest" }, t.destination),
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
        h("span", {}, `${t.stopCount} stops`),
        typeof t.distanceKm === "number" && h("span", { class: "it-distance" }, t.distanceKm < 1 ? "Right here" : `${km(t.distanceKm)} away`),
      ),
      h("p", { class: "it-desc" }, t.description),
      h("div", { class: "it-foot" }, h("span", { class: "it-source" }, "Curated by Wayline"), h("button", { class: "btn btn-outline btn-sm", type: "button", onclick: open }, "Preview")),
    ),
  );
}

const hue = (s) => [...s].reduce((a, c) => (a * 31 + c.charCodeAt(0)) % 360, 7);

export function renderHome(app, ctx) {
  const { me, config, navigate } = ctx;
  const S = {
    place: store.get(PLACE_KEY), // { label, lat, lng, source: "location" | "destination" }
    category: "all",
    session: null,
    suggestions: [],
    active: -1,
    aborter: null,
    timer: null,
  };
  const geoDenied = () => store.get(GEO_KEY) === true;

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
  const geoBtn = h("button", { class: "btn btn-ghost geo-btn", type: "button", onclick: useMyLocation }, icon("locate"), "Use my location");
  const status = h("p", { class: "hero-status", role: "status" });
  const placeChip = h("div", { class: "place-chip" });

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
      h("div", { class: "hero-actions" }, geoBtn, placeChip),
      status,
    ),
    h("div", { class: "hero-art-postcards", "aria-hidden": "true" }, [
      ["Sydney", "Harbour walk", "cover-city-highlights", 200],
      ["Canberra", "Lookouts", "cover-nature-outdoors", 140],
      ["Tokyo", "Asakusa", "cover-food-culture", 20],
    ].map(([city, label, cls, hu], i) => h("div", { class: `postcard pc-${i} ${cls}`, style: `--hue:${hu}` }, h("b", {}, city), h("span", {}, label)))),
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
      setPlace({ label: s.secondary ? `${s.main}, ${s.secondary.split(",").pop().trim()}` : s.main, lat: p.lat, lng: p.lng, source: "destination" });
      status.textContent = "";
      near.scrollIntoView({ behavior: "smooth", block: "start" });
    } catch (err) {
      status.textContent = err.message;
    }
  }

  // --- location ---
  async function useMyLocation() {
    if (geoDenied()) {
      status.textContent = "Location access is off for Wayline in this browser. Search for a destination instead, or allow location in your browser settings and reload.";
      return;
    }
    if (!navigator.geolocation) {
      status.textContent = "This browser can't share its location. Search for a destination instead.";
      return;
    }
    geoBtn.disabled = true;
    status.textContent = "Finding your location…";
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const { latitude: lat, longitude: lng } = pos.coords;
        let label = "Your location";
        try {
          label = (await api(`/api/geo/reverse?lat=${lat}&lng=${lng}`)).label;
        } catch {}
        geoBtn.disabled = false;
        status.textContent = "";
        setPlace({ label, lat, lng, source: "location" });
      },
      (err) => {
        geoBtn.disabled = false;
        if (err.code === 1) {
          store.set(GEO_KEY, true); // don't ask again this session
          status.textContent = "Location permission was denied, so Wayline won't ask again. Search for a destination instead.";
          renderPlaceChip();
        } else {
          status.textContent = err.code === 3 ? "Finding your location took too long. Try again, or search for a destination." : "Your location couldn't be determined. Search for a destination instead.";
        }
      },
      { enableHighAccuracy: false, timeout: 10_000, maximumAge: 10 * 60_000 },
    );
  }

  function setPlace(p) {
    S.place = p;
    store.set(PLACE_KEY, { ...p, lat: round(p.lat), lng: round(p.lng) });
    renderPlaceChip();
    loadNear();
  }

  function renderPlaceChip() {
    geoBtn.hidden = geoDenied() && !S.place;
    if (!S.place) return placeChip.replaceChildren(geoDenied() ? h("span", { class: "muted small" }, "Location is off. Search for a destination above.") : "");
    placeChip.replaceChildren(
      h("span", { class: "chip chip-place" }, icon(S.place.source === "location" ? "locate" : "pin"), "Exploring: ", h("strong", {}, S.place.label)),
      h("button", { class: "linklike small", type: "button", onclick: () => input.focus() }, "Change"),
      h("button", { class: "linklike small", type: "button", onclick: () => { S.place = null; store.set(PLACE_KEY, null); renderPlaceChip(); loadNear(); } }, "Clear"),
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
                  { type: "button", class: "place-row", onclick: () => placeDialog({ placeId: p.placeId, name: p.name, source: p.source }) },
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

  // --- explore destinations ---
  const destGrid = h("div", { class: "dest-grid" });
  const explore = h(
    "section",
    { class: "home-section", id: "explore" },
    h("div", { class: "section-head" }, h("div", {}, h("h2", {}, "Explore destinations"), h("p", { class: "section-sub" }, "Pick a city to see its itineraries, wherever you are now. Or search any city above."))),
    destGrid,
  );
  api("/api/itineraries/destinations")
    .then(({ destinations }) =>
      destGrid.replaceChildren(
        ...destinations.map((d) =>
          h(
            "button",
            { type: "button", class: "dest-card", style: `--hue:${hue(d.name)}`, onclick: () => { setPlace({ label: d.name, lat: d.lat, lng: d.lng, source: "destination" }); near.scrollIntoView({ behavior: "smooth" }); } },
            h("span", { class: "dest-name" }, d.name),
            h("span", { class: "dest-region" }, d.region),
            h("span", { class: "dest-count" }, `${d.itineraries} itineraries`),
          ),
        ),
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

  app.replaceChildren(ctx.topbar("home"), h("main", { class: "home" }, hero, near, explore, featured, myTrips), ctx.footer());

  renderChips();
  renderPlaceChip();
  loadNear();
  // a browser that has already refused location: don't offer to ask
  navigator.permissions?.query({ name: "geolocation" }).then((p) => {
    if (p.state === "denied") {
      store.set(GEO_KEY, true);
      renderPlaceChip();
    }
  }).catch(() => {});
  if (location.hash === "#explore") requestAnimationFrame(() => explore.scrollIntoView());
  if (location.hash === "#near") requestAnimationFrame(() => near.scrollIntoView());

  return () => {
    clearTimeout(S.timer);
    S.aborter?.abort();
  };
}
