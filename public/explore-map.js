import { createMap } from "/map.js";
import { addToTripDialog, placeDialog } from "/places.js";
import { api, decodePolyline, dur, h, icon, km } from "/ui.js";

// "Explore places": an interactive map of real places around the discovery
// location. Individual places, never itineraries. Every Google call happens
// on a click (a category, a search, a place, a route), never on render.
// The homepage puts its destination search above the map (`finder`) and
// supplies what to do with a chosen destination (`actions`).

const CATEGORIES = [
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

export function createExploreMap(ctx, { finder = null, actions = null, ideas = null } = {}) {
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
  };
  let map = null;

  const mapHost = h("div", { class: "map-host" });
  const side = h("aside", { class: "xm-side", "aria-live": "polite" });
  const sub = h("p", { class: "section-sub xm-note" });
  const el = h(
    "section",
    { class: "home-section", id: "explore-map" },
    h("div", { class: "section-head" }, h("div", {}, h("p", { class: "eyebrow" }, "Plan a trip"), h("h2", {}, "Where would you like to go?"), h("p", { class: "section-sub xm-lede" }, "Search a destination and start planning your trip."))),
    finder,
    h("div", { class: "xm-grid" }, h("div", { class: "xm-map" }, mapHost), side),
    sub,
  );

  createMap(mapHost, {
    config: ctx.config,
    onSelectStop: () => {},
    onSelectResult: (placeId) => select(S.results.find((r) => r.placeId === placeId)),
  }).then((m) => {
    map = m;
    paintMap();
  });

  function paintMap() {
    if (!map) return;
    const routes = S.route?.data?.status === "ok" && S.route.data.polyline ? [{ mode: S.route.mode, path: decodePolyline(S.route.data.polyline) }] : [];
    map.update({
      stops: S.origin?.source === "location" ? [{ id: "origin", title: "You are here", kind: "custom", lat: S.origin.lat, lng: S.origin.lng, selected: false }] : [],
      results: S.results,
      routes,
      center: S.origin ? { lat: S.origin.lat, lng: S.origin.lng } : null,
      fitKey: `${S.origin?.lat},${S.origin?.lng}|${S.type ?? S.query}`,
      selectedPlaceId: S.selected?.placeId ?? null,
    });
  }

  async function run(key, url) {
    S.loading = true;
    S.error = null;
    S.selected = null;
    S.route = null;
    render();
    try {
      const data = S.cache.get(key) ?? (await api(url));
      S.cache.set(key, data);
      if (S.cache.size > 30) S.cache.delete(S.cache.keys().next().value);
      S.results = data.places;
      S.source = data.source;
    } catch (err) {
      S.results = [];
      S.error = err.message;
    }
    S.loading = false;
    render();
  }

  function showType(type) {
    if (!S.origin) return;
    S.type = type;
    S.query = "";
    const { lat, lng } = S.origin;
    run(`${type}|${lat}|${lng}`, `/api/places/nearby?lat=${lat}&lng=${lng}&radius=8000&type=${type}`);
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
    sub.textContent = S.origin
      ? `Places around ${S.origin.source === "location" ? "your location" : S.origin.label}${S.source === "demo" ? " (demo data: Google isn't configured)" : ", from Google Maps"}. These are individual places, not itineraries.`
      : "Search a destination (or use your location), then browse attractions, restaurants and more around it on the map.";
    paintMap();
    if (!S.origin) {
      side.replaceChildren(
        h(
          "div",
          { class: "xm-start" },
          h("p", { class: "xm-start-title" }, "Start with a place"),
          h("p", { class: "muted small" }, "Search a city above. The map moves there and shows attractions, restaurants and more to add to a trip. No location needed."),
          ideas?.() ?? "",
        ),
      );
      return;
    }
    if (S.selected) return side.replaceChildren(placePanel());
    const input = h("input", { type: "search", name: "q", placeholder: S.origin.source === "location" ? "Search places near you" : `Search places in ${S.origin.label}`, maxlength: 120, value: S.query, "aria-label": "Search places in this area" });
    side.replaceChildren(
      actions?.(S.origin) ?? "",
      h("div", { class: "cat-chips xm-cats", role: "group", "aria-label": "Place type" }, CATEGORIES.map(([t, label]) => h("button", { type: "button", class: `cat-chip${S.type === t ? " on" : ""}`, "aria-pressed": String(S.type === t), onclick: () => showType(t) }, label))),
      h("form", { class: "xm-search", role: "search", onsubmit: (e) => { e.preventDefault(); search(input.value.trim()); } }, input, h("button", { class: "btn btn-dark btn-sm", type: "submit" }, "Search")),
      resultsList(),
    );
  }

  function resultsList() {
    if (S.loading) return h("p", { class: "muted pad", role: "status" }, "Finding places…");
    if (S.error) return h("div", { class: "pad" }, h("p", { class: "form-error" }, S.error));
    if (!S.type && !S.query) return h("p", { class: "muted pad" }, "Pick a category or search to see places on the map.");
    if (!S.results.length) return h("p", { class: "muted pad" }, "No places found here. Try another category or a broader search.");
    return h(
      "div",
      {},
      S.source === "demo" && h("p", { class: "demo-note" }, h("strong", {}, "Demo places."), " Google Places isn't configured on this server; these are a few labelled Sydney landmarks."),
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
              h("span", { class: "place-pin" }, icon("pin")),
              h("span", { class: "grow" }, h("strong", {}, p.name), h("small", { class: "muted" }, [p.category, p.address].filter(Boolean).join(" · "))),
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
      h("button", { class: "linklike small", type: "button", onclick: () => { S.selected = null; S.route = null; render(); } }, "← All places"),
      h("h3", {}, p.name),
      h("p", { class: "stop-meta" }, p.category && h("span", { class: "tag" }, p.category), p.source === "demo" && h("span", { class: "tag tag-demo" }, "Demo place")),
      p.address && h("p", { class: "muted small" }, p.address),
      d === null && h("p", { class: "muted small", role: "status" }, "Loading details…"),
      d?.error && h("p", { class: "form-error small" }, d.error),
      d && !d.error && typeof d.rating === "number" && h("p", { class: "rating" }, h("strong", {}, d.rating.toFixed(1)), " ★", d.ratingCount ? h("span", { class: "muted" }, ` (${d.ratingCount.toLocaleString("en-AU")} Google reviews)`) : null),
      d?.openingHours &&
        h("details", { class: "hours" }, h("summary", {}, d.openNow === true ? "Open now · hours" : d.openNow === false ? "Closed now · hours" : "Opening hours"), h("ul", {}, d.openingHours.map((line) => h("li", {}, line)))),
      h(
        "div",
        { class: "row-actions" },
        h("button", { class: "btn btn-primary btn-sm", type: "button", onclick: () => addToTripDialog(p, ctx) }, icon("plus"), "Add to Trip"),
        h("button", { class: "btn btn-ghost btn-sm", type: "button", onclick: () => placeDialog({ placeId: p.placeId, name: p.name, source: p.source }, ctx) }, "More details"),
      ),
      h(
        "div",
        { class: "xm-route" },
        h("p", { class: "small" }, h("strong", {}, "Getting there"), ` from ${S.origin.source === "location" ? "your location" : `central ${S.origin.label}`}`),
        h(
          "div",
          { class: "modes" },
          MODES.map(([m, label, ic]) => h("button", { type: "button", class: `mode${r?.mode === m ? " on" : ""}`, "aria-pressed": String(r?.mode === m), disabled: !ctx.config.routes || r?.loading, onclick: () => directions(m) }, icon(ic), h("span", {}, label))),
        ),
        !ctx.config.routes && h("p", { class: "muted small" }, "Directions need Google Maps configured on the server. None are estimated here."),
        r?.loading && h("p", { class: "muted small", role: "status" }, "Calculating route…"),
        r?.error && h("p", { class: "form-error small" }, r.error),
        r?.data && routeSummary(r.mode, r.data),
      ),
      p.source === "google" && h("p", { class: "attrib", translate: "no" }, "Google Maps"),
    );
  }

  function routeSummary(mode, o) {
    if (o.status !== "ok") return h("p", { class: "leg-warn small" }, o.message ?? "Google found no route for this mode.");
    const transit = (o.steps ?? []).filter((s) => s.kind === "transit");
    return h(
      "div",
      { class: "route-result" },
      h("p", {}, h("strong", {}, dur(Math.max(1, Math.ceil(o.durationSec / 60)))), ` · ${(o.distanceM / 1000).toFixed(1)} km`, mode === "TRANSIT" && transit.length ? ` · ${transit.length - 1} transfer${transit.length === 2 ? "" : "s"}` : ""),
      mode === "TRANSIT" &&
        transit.length > 0 &&
        h(
          "ol",
          { class: "steps" },
          transit.map((s) =>
            h(
              "li",
              {},
              h("span", { class: "line-chip", style: s.color ? `--lc:${s.color};--lt:${s.textColor ?? "#fff"}` : "" }, [s.vehicle, s.line].filter(Boolean).join(" ") || "Transit"),
              ` ${s.from ?? "?"} ${s.localDeparture ?? ""} → ${s.to ?? "?"} ${s.localArrival ?? ""}`,
            ),
          ),
        ),
      mode === "TRANSIT" && h("p", { class: "muted tiny" }, "For a departure now."),
    );
  }

  render();
  return {
    el,
    // the homepage's destinations arrived: redraw the panel's quick picks
    refresh: () => !S.origin && render(),
    setOrigin(origin) {
      const changed = !S.origin || !origin || S.origin.lat !== origin.lat || S.origin.lng !== origin.lng;
      S.origin = origin;
      if (!changed) return;
      S.results = [];
      S.selected = null;
      S.route = null;
      S.type = null;
      S.query = "";
      if (origin) showType("tourist_attraction");
      else render();
    },
    destroy() {
      map?.destroy();
    },
  };
}
