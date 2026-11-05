import { FOOD, LENGTHS, MAX_PICKS } from "/discover.js";
import { createMap } from "/map.js";
import { addToTripDialog, placeDialog } from "/places.js";
import { api, decodePolyline, dur, h, icon, km } from "/ui.js";
import { locale, t, tn, tServer } from "/i18n.js";

// "Explore places": an interactive map of real places around the discovery
// location. Individual places, never itineraries. Every Google call happens
// on a click (a category, a search, a place, a route), never on render.
// The homepage puts its destination search above the map (`finder`).
//
// It's also where trip discovery starts: places the visitor likes are saved
// to one shared selection (`picks`, from discover.js), shown in red on the
// map and in the panel's tray with the optional length and food, and "Find
// journeys" (`onFind`) matches Wayline's ready-made plans to them. Picks
// are interests, not a plan: no times, order or routes.

// "wayline": the places Wayline's own plans visit around here (no Google
// request; there even without a Maps key)
const CATEGORIES = [
  ["wayline", "In Wayline plans"],
  ["tourist_attraction", "Attractions"],
  ["museum", "Museums"],
  ["park", "Parks"],
  ["zoo", "Zoos"],
  ["restaurant", "Restaurants"],
  ["cafe", "Cafés"],
  ["shopping_mall", "Shopping"],
];
const MODES = [
  ["WALK", "Walk", "walk"],
  ["TRANSIT", "Transit", "transit"],
  ["DRIVE", "Drive", "drive"],
];

export function createExploreMap(ctx, { finder = null, ideas = null, picks, onFind, onStart }) {
  const S = {
    origin: null, // { label, lat, lng, source }
    type: null,
    query: "",
    results: [],
    source: null,
    selected: null,
    details: null,
    route: null, // { mode, data } | { mode, loading } | { mode, error }
    loading: false,
    error: null,
    cache: new Map(), // this page only: the same category twice isn't re-fetched
    // The places list being asked for: a new place, category or search, a
    // cleared location or the page going away replaces it, and only the
    // answer to the current one may change what's shown (an older city's
    // answer can arrive after a newer one's).
    req: 0,
    gone: false,
    prefs: false, // the tray's length and food, folded away until asked for
    finding: false,
  };
  let map = null;

  const mapHost = h("div", { class: "map-host" });
  const side = h("aside", { class: "xm-side", "aria-live": "polite" });
  const sub = h("p", { class: "section-sub xm-note" });
  const el = h(
    "section",
    { class: "home-section", id: "explore-map" },
    h("div", { class: "section-head" }, h("div", {}, h("p", { class: "eyebrow" }, h("span", { class: "eyebrow-n" }, "01"), t("Plan a trip")), h("h2", {}, t("Where would you like to go?")))),
    finder,
    h("div", { class: "xm-grid" }, h("div", { class: "xm-map" }, mapHost), side),
    sub,
  );

  createMap(mapHost, {
    config: ctx.config,
    onSelectStop: () => {},
    onSelectResult: (placeId) => select(shown().find((r) => r.placeId === placeId)),
  }).then((m) => {
    map = m;
    paintMap();
  });

  // what's on the map: this list's places, plus any picks it doesn't show
  const shown = () => [...S.results, ...picks.state.places.filter((p) => !S.results.some((r) => r.placeId === p.placeId)).map((p) => ({ ...p, name: p.label }))];

  function paintMap() {
    if (!map) return;
    const routes = S.route?.data?.status === "ok" && S.route.data.polyline ? [{ mode: S.route.mode, path: decodePolyline(S.route.data.polyline) }] : [];
    map.update({
      stops: S.origin?.source === "location" ? [{ id: "origin", title: t("You are here"), kind: "custom", lat: S.origin.lat, lng: S.origin.lng, selected: false }] : [],
      results: shown(),
      picked: picks.state.places.map((p) => p.placeId),
      routes,
      center: S.origin ? { lat: S.origin.lat, lng: S.origin.lng } : null,
      fitKey: `${S.origin?.lat},${S.origin?.lng}|${S.type ?? S.query}`,
      selectedPlaceId: S.selected?.placeId ?? null,
    });
  }

  // Ends whatever places request is in flight: its answer, success or
  // failure, will change nothing.
  function invalidate() {
    S.req++;
    S.loading = false;
  }

  async function run(key, url) {
    const req = ++S.req;
    const current = () => !S.gone && req === S.req;
    S.loading = true;
    S.error = null;
    S.selected = null;
    S.route = null;
    render();
    let data = null;
    let error = null;
    try {
      data = S.cache.get(key) ?? (url ? await api(url) : await waylinePlaces());
      // filed under its own key whenever it comes, so it's there if asked again
      S.cache.set(key, data);
      if (S.cache.size > 30) S.cache.delete(S.cache.keys().next().value);
    } catch (err) {
      error = err.message;
    }
    if (!current()) return;
    S.results = data ? data.places : [];
    S.source = data ? data.source : S.source;
    S.error = error;
    S.loading = false;
    render();
  }

  function showType(type) {
    if (!S.origin) return;
    S.type = type;
    S.query = "";
    const { lat, lng } = S.origin;
    if (type === "wayline") return run(`${type}|${lat}|${lng}`, null);
    run(`${type}|${lat}|${lng}`, `/api/places/nearby?lat=${lat}&lng=${lng}&radius=8000&type=${type}`);
  }

  // the stops of Wayline's plans around here, as places to pick
  async function waylinePlaces() {
    const { lat, lng } = S.origin;
    const { places } = await api(`/api/itineraries/highlights?lat=${lat}&lng=${lng}`);
    return {
      source: "wayline",
      places: places.map((x) => ({ placeId: `wl:${x.lat.toFixed(5)},${x.lng.toFixed(5)}`, name: x.title, lat: x.lat, lng: x.lng, category: tn(x.plans, "In {n} Wayline plan", "In {n} Wayline plans"), source: "wayline" })),
    };
  }

  function search(q) {
    if (!S.origin || q.length < 2) return;
    S.type = null;
    S.query = q;
    const { lat, lng } = S.origin;
    run(`q:${q.toLowerCase()}|${lat}|${lng}`, `/api/places/search?q=${encodeURIComponent(q)}&lat=${lat}&lng=${lng}`);
  }

  async function select(p) {
    if (!p) return;
    S.selected = p;
    S.details = null;
    S.route = null;
    render();
    map?.focus(p);
    if (p.source === "wayline") return; // a stop of Wayline's plans: no Google place to look up
    try {
      const d = await api(`/api/places/${encodeURIComponent(p.placeId)}`);
      if (S.selected?.placeId === p.placeId) S.details = d;
    } catch (err) {
      if (S.selected?.placeId === p.placeId) S.details = { error: err.message };
    }
    render();
  }

  async function directions(mode) {
    const p = S.selected;
    if (!p || !S.origin) return;
    S.route = { mode, loading: true };
    render();
    try {
      const data = await api("/api/routes", {
        method: "POST",
        body: { origin: { lat: S.origin.lat, lng: S.origin.lng }, destination: p.source === "google" ? { placeId: p.placeId } : { lat: p.lat, lng: p.lng }, mode },
      });
      if (S.selected === p) S.route = { mode, data };
    } catch (err) {
      if (S.selected === p) S.route = { mode, error: err.message };
    }
    render();
  }

  function render() {
    if (S.gone) return;
    sub.textContent = S.origin
      ? S.source === "demo"
        ? S.origin.source === "location"
          ? t("Places around your location (demo data: Google isn't configured). These are individual places, not itineraries.")
          : t("Places around {place} (demo data: Google isn't configured). These are individual places, not itineraries.", { place: S.origin.label })
        : S.origin.source === "location"
          ? t("Places around your location, from Google Maps. These are individual places, not itineraries.")
          : t("Places around {place}, from Google Maps. These are individual places, not itineraries.", { place: S.origin.label })
      : t("Search a city, or use your location, to browse what's around it.");
    paintMap();
    if (!S.origin) {
      side.replaceChildren(
        h(
          "div",
          { class: "xm-start" },
          h("p", { class: "xm-start-title" }, t("Start with a place")),
          h("p", { class: "muted small" }, t("Search a city above. The map moves there and shows attractions, restaurants and more to add to a trip. No location needed.")),
          ideas?.() ?? "",
        ),
      );
      return;
    }
    if (S.selected) return side.replaceChildren(tray(), placePanel());
    const input = h("input", { type: "search", name: "q", placeholder: S.origin.source === "location" ? t("Search places near you") : t("Search places in {place}", { place: S.origin.label }), maxlength: 120, value: S.query, "aria-label": t("Search places in this area") });
    side.replaceChildren(
      tray(),
      h("div", { class: "cat-chips xm-cats", role: "group", "aria-label": t("Place type") }, CATEGORIES.map(([it, label]) => h("button", { type: "button", class: `cat-chip${S.type === it ? " on" : ""}`, "aria-pressed": String(S.type === it), onclick: () => showType(it) }, t(label)))),
      h("form", { class: "xm-search", role: "search", onsubmit: (e) => { e.preventDefault(); search(input.value.trim()); } }, input, h("button", { class: "btn btn-dark btn-sm", type: "submit" }, t("Search"))),
      resultsList(),
    );
  }

  function resultsList() {
    if (S.loading) return h("p", { class: "muted pad", role: "status" }, t("Finding places…"));
    if (S.error) return h("div", { class: "pad" }, h("p", { class: "form-error" }, S.error));
    if (!S.type && !S.query) return h("p", { class: "muted pad" }, t("Pick a category or search to see places on the map."));
    if (!S.results.length) return h("p", { class: "muted pad" }, S.type === "wayline" ? t("Wayline has no ready-made plans around here yet.") : t("No places found here. Try another category, In Wayline plans, or a broader search."));
    return h(
      "div",
      {},
      S.source === "demo" && h("p", { class: "demo-note" }, h("strong", {}, t("Demo places.")), t(" Google Places isn't configured on this server; these are a few labelled Sydney landmarks.")),
      S.source === "wayline" && h("p", { class: "muted small pad-x" }, t("Stops of Wayline\u2019s ready-made plans around here.")),
      h(
        "ul",
        { class: "place-list xm-list" },
        S.results.map((p) =>
          h(
            "li",
            {},
            h(
              "button",
              { type: "button", class: "place-row", onclick: () => select(p) },
              h("span", { class: `place-pin${picks.has(p.placeId) ? " is-picked" : ""}` }, icon(picks.has(p.placeId) ? "check" : "pin")),
              h("span", { class: "grow" }, h("strong", {}, p.name), h("small", { class: "muted" }, [picks.has(p.placeId) && t("In your picks"), p.category, p.address].filter(Boolean).join(" · "))),
              typeof p.distanceKm === "number" && h("span", { class: "muted small" }, km(p.distanceKm)),
            ),
          ),
        ),
      ),
      S.source === "google" && h("p", { class: "attrib", translate: "no" }, "Google Maps"),
    );
  }

  function placePanel() {
    const p = S.selected;
    const d = S.details;
    const r = S.route;
    return h(
      "div",
      { class: "xm-panel" },
      h("button", { class: "linklike small", type: "button", onclick: () => { S.selected = null; S.route = null; render(); } }, t("← All places")),
      h("h3", {}, p.name),
      h("p", { class: "stop-meta" }, p.category && h("span", { class: "tag" }, p.category), p.source === "demo" && h("span", { class: "tag tag-demo" }, t("Demo place"))),
      pickButton(p),
      p.address && h("p", { class: "muted small" }, p.address),
      d === null && p.source !== "wayline" && h("p", { class: "muted small", role: "status" }, t("Loading details…")),
      d?.error && h("p", { class: "form-error small" }, d.error),
      d && !d.error && typeof d.rating === "number" && h("p", { class: "rating" }, h("strong", {}, d.rating.toFixed(1)), " ★", d.ratingCount ? h("span", { class: "muted" }, t(" ({n} Google reviews)", { n: d.ratingCount.toLocaleString(locale()) })) : null),
      d?.openingHours &&
        h("details", { class: "hours" }, h("summary", {}, d.openNow === true ? t("Open now · hours") : d.openNow === false ? t("Closed now · hours") : t("Opening hours")), h("ul", {}, d.openingHours.map((line) => h("li", {}, line)))),
      p.source !== "wayline" && h(
        "div",
        { class: "row-actions" },
        h("button", { class: "btn btn-ghost btn-sm", type: "button", onclick: () => addToTripDialog(p, ctx) }, icon("plus"), t("Add to Trip")),
        h("button", { class: "btn btn-quiet btn-sm", type: "button", onclick: () => placeDialog({ placeId: p.placeId, name: p.name, source: p.source }, ctx) }, t("More details")),
      ),
      p.source !== "wayline" && h(
        "div",
        { class: "xm-route" },
        h("p", { class: "small" }, h("strong", {}, t("Getting there")), S.origin.source === "location" ? t(" from your location") : t(" from central {place}", { place: S.origin.label })),
        h(
          "div",
          { class: "modes" },
          MODES.map(([m, label, ic]) => h("button", { type: "button", class: `mode${r?.mode === m ? " on" : ""}`, "aria-pressed": String(r?.mode === m), disabled: !ctx.config.routes || r?.loading, onclick: () => directions(m) }, icon(ic), h("span", {}, t(label)))),
        ),
        !ctx.config.routes && h("p", { class: "muted small" }, t("Directions need Google Maps configured on the server. None are estimated here.")),
        r?.loading && h("p", { class: "muted small", role: "status" }, t("Calculating route…")),
        r?.error && h("p", { class: "form-error small" }, r.error),
        r?.data && routeSummary(r.mode, r.data),
      ),
      p.source === "google" && h("p", { class: "attrib", translate: "no" }, "Google Maps"),
    );
  }

  // Save / remove a place from the shared picks
  function pickButton(p) {
    const on = picks.has(p.placeId);
    const full = !on && picks.state.places.length >= MAX_PICKS;
    return h(
      "button",
      { class: `btn btn-sm xm-pick${on ? " on" : ""}`, type: "button", "aria-pressed": String(on), disabled: full, onclick: () => (on ? picks.remove(p.placeId) : picks.add(p)) },
      icon(on ? "check" : "plus"),
      on ? t("In your picks") : full ? t("Up to {n} picks", { n: MAX_PICKS }) : t("Save to my picks"),
    );
  }

  // The tray: the places picked so far, the optional length and food, and
  // the one action, Find journeys. The selection is the visitor's
  // interests, not an itinerary.
  function tray() {
    const P = picks.state;
        const prefCount = P.food.length + (P.days !== null ? 1 : 0);
    const chip = (on, label, onclick) => h("button", { type: "button", class: `dx-chip${on ? " on" : ""}`, "aria-pressed": String(on), onclick }, label);
    return h(
      "section",
      { class: "xm-tray", id: "discover", "aria-labelledby": "xm-tray-h" },
      h("div", { class: "xm-tray-head" }, h("h3", { id: "xm-tray-h", class: "xm-tray-title" }, t("Your picks")), h("span", { class: "xm-tray-count" }, P.places.length ? t("{n} of {max}", { n: P.places.length, max: MAX_PICKS }) : "")),
      P.places.length
        ? h(
            "ul",
            { class: "xm-picked", "aria-label": t("Places you picked") },
            P.places.map((x) =>
              h(
                "li",
                {},
                h("button", { type: "button", class: "xm-picked-name", onclick: () => select(shown().find((r) => r.placeId === x.placeId)) }, x.label),
                h("button", { type: "button", class: "xm-picked-x", "aria-label": t("Remove {name}", { name: x.label }), onclick: () => picks.remove(x.placeId) }, icon("close")),
              ),
            ),
          )
        : h("p", { class: "xm-tray-hint" }, S.origin.source === "location" ? t("Save places you like from the map, and Wayline finds ready-made plans near you that go there. Optional.") : t("Save places you like from the map, and Wayline finds ready-made plans for {place} that go there. Optional.", { place: S.origin.label })),
      h(
        "button",
        { type: "button", class: "xm-prefs-toggle", "aria-expanded": String(S.prefs), "aria-controls": "xm-prefs", onclick: () => { S.prefs = !S.prefs; render(); } },
        h("span", { "aria-hidden": "true" }, S.prefs ? "\u2212" : "+"),
        t(" Length and food"),
        prefCount > 0 ? h("span", { class: "xm-prefs-count" }, t(" · {n} chosen", { n: prefCount })) : h("span", { class: "xm-prefs-opt" }, t(" · optional")),
      ),
      h(
        "div",
        { class: "xm-prefs", id: "xm-prefs", hidden: !S.prefs },
        h("p", { class: "dx-label", id: "xm-days-h" }, t("How long")),
        h("div", { class: "dx-chips", role: "group", "aria-labelledby": "xm-days-h" }, LENGTHS.map(([n, label]) => chip(P.days === n, t(label), () => picks.setDays(n)))),
        h("p", { class: "dx-label", id: "xm-food-h" }, t("How you like to eat")),
        h("div", { class: "dx-chips", role: "group", "aria-labelledby": "xm-food-h" }, FOOD.map(([k, label]) => chip(P.food.includes(k), t(label), () => picks.toggleFood(k)))),
      ),
      h(
        "div",
        { class: "xm-tray-actions" },
        h("button", { type: "button", class: "btn btn-primary xm-find", disabled: S.finding, onclick: find }, S.finding ? t("Finding\u2026") : t("Find journeys")),
        h("button", { type: "button", class: "linklike small xm-start", onclick: () => onStart(S.origin) }, t("or start a trip from scratch")),
      ),
    );
  }

  async function find() {
    S.finding = true;
    render();
    try {
      await onFind(S.origin);
    } finally {
      S.finding = false;
      render();
    }
  }

  function routeSummary(mode, o) {
    if (o.status !== "ok") return h("p", { class: "leg-warn small" }, tServer(o.message) ?? t("Google found no route for this mode."));
    const transit = (o.steps ?? []).filter((s) => s.kind === "transit");
    return h(
      "div",
      { class: "route-result" },
      h("p", {}, h("strong", {}, dur(Math.max(1, Math.ceil(o.durationSec / 60)))), ` · ${(o.distanceM / 1000).toFixed(1)} km`, mode === "TRANSIT" && transit.length ? tn(transit.length - 1, " · {n} transfer", " · {n} transfers") : ""),
      mode === "TRANSIT" &&
        transit.length > 0 &&
        h(
          "ol",
          { class: "steps" },
          transit.map((s) =>
            h(
              "li",
              {},
              h("span", { class: "line-chip", style: s.color ? `--lc:${s.color};--lt:${s.textColor ?? "#fff"}` : "" }, [s.vehicle, s.line].filter(Boolean).join(" ") || t("Transit")),
              ` ${s.from ?? "?"} ${s.localDeparture ?? ""} → ${s.to ?? "?"} ${s.localArrival ?? ""}`,
            ),
          ),
        ),
      mode === "TRANSIT" && h("p", { class: "muted tiny" }, t("For a departure now.")),
    );
  }

  picks.onChange(render);
  render();
  return {
    el,
    origin: () => S.origin,
    // the homepage's destinations arrived: redraw the panel's quick picks
    refresh: () => !S.origin && render(),
    setOrigin(origin) {
      if (S.gone) return;
      const changed = !S.origin || !origin || S.origin.lat !== origin.lat || S.origin.lng !== origin.lng;
      S.origin = origin;
      picks.moveTo(origin);
      if (!changed) return;
      invalidate();
      S.results = [];
      S.error = null;
      S.selected = null;
      S.route = null;
      S.type = null;
      S.query = "";
      if (origin) showType("tourist_attraction");
      else render();
    },
    destroy() {
      S.gone = true;
      invalidate();
      map?.destroy();
    },
  };
}
