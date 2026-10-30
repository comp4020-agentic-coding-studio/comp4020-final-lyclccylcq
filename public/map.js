import { h } from "/ui.js";

// The map: Google's Maps JavaScript API when a browser key is configured,
// otherwise a plain schematic that places the stops by their coordinates and
// says plainly that it is not a map. Both take the same updates.

let loader = null;
let authFailed = false;

function loadGoogle(key) {
  if (window.google?.maps?.importLibrary) return Promise.resolve();
  loader ??= new Promise((resolve, reject) => {
    window.__waylineMapsReady = () => resolve();
    // Google calls this when the key is rejected (wrong referrer, API off...).
    window.gm_authFailure = () => {
      authFailed = true;
      window.dispatchEvent(new Event("wayline:maps-auth-failed"));
    };
    const s = document.createElement("script");
    s.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(key)}&v=weekly&loading=async&callback=__waylineMapsReady`;
    s.async = true;
    s.onerror = () => reject(new Error("Google Maps couldn't be loaded."));
    document.head.append(s);
  });
  return loader;
}

const MODE_COLOUR = { WALK: "#1F6F5C", TRANSIT: "#2B4DB8", DRIVE: "#8A5A16" };
const distanceKm = (a, b) => {
  const rad = Math.PI / 180;
  const x = Math.sin(((b.lat - a.lat) * rad) / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(((b.lng - a.lng) * rad) / 2) ** 2;
  return 12742 * Math.asin(Math.sqrt(x));
};
const formatKm = (k) => (k < 1 ? `${Math.round(k * 1000)} m` : `${k < 10 ? k.toFixed(1) : Math.round(k)} km`);
// the start shows "S"; the stops after it are numbered from 1, as in the timeline
const stopLabel = (stops, i) => (stops[i].start ? "S" : String(i + 1 - (stops[0]?.start ? 1 : 0)));
// a category is a small dot on the stop; the stop itself is always the line's ink
const KIND_COLOUR = { attraction: "#C2563A", food: "#B98216", shopping: "#6D5BB5", accommodation: "#2E7C88", custom: "#7A8290" };

// onPlaceClick(placeId, latLng): one of Google's own place icons was clicked.
// onMapClick(latLng): anywhere else. onViewChange({ lat, lng, zoom, heading }):
// the map moved (throttled). All optional; without them the map
// keeps Google's icons inert, as before. The schematic has no real geography,
// so it never reports map clicks.
export async function createMap(el, { config, onSelectStop, onSelectResult, onPlaceClick, onMapClick, onViewChange }) {
  const handlers = { onSelectStop, onSelectResult, onPlaceClick, onMapClick, onViewChange };
  if (config.mapsBrowserKey && !authFailed) {
    try {
      return await googleMap(el, config, handlers);
    } catch (err) {
      return schematic(el, handlers, err.message);
    }
  }
  return schematic(el, handlers, null);
}

async function googleMap(el, config, handlers) {
  await loadGoogle(config.mapsBrowserKey);
  const { Map, Polyline } = await google.maps.importLibrary("maps");
  const { AdvancedMarkerElement } = await google.maps.importLibrary("marker");
  const canvas = h("div", { class: "map-canvas" });
  el.replaceChildren(canvas);
  const map = new Map(canvas, {
    center: { lat: 20, lng: 0 },
    zoom: 2,
    mapId: config.mapId,
    clickableIcons: Boolean(handlers.onPlaceClick),
    mapTypeControl: false,
    streetViewControl: false,
    fullscreenControl: false,
    gestureHandling: "greedy",
  });
  // Google fires "click" only for a click, never at the end of a drag or zoom.
  // A click on a place icon carries its placeId; stop() keeps Google's own
  // info window closed so Wayline's panel is the only one.
  map.addListener("click", (e) => {
    const at = { lat: e.latLng.lat(), lng: e.latLng.lng() };
    if (e.placeId && handlers.onPlaceClick) {
      e.stop();
      handlers.onPlaceClick(e.placeId, at);
    } else if (handlers.onMapClick) {
      handlers.onMapClick(at);
    }
  });
  let markers = [];
  let line = null;
  let routeLines = [];
  let lastFit = "";

  // --- where the other people on the trip are looking ---
  // An OverlayView is only here for its projection: it turns a latitude and
  // longitude into this map's pixels, accounting for zoom, rotation and tilt.
  let peers = [];
  const peerLayer = h("div", { class: "peer-layer" });
  el.append(peerLayer);
  const overlay = new google.maps.OverlayView();
  overlay.onAdd = () => {};
  overlay.onRemove = () => {};
  overlay.draw = () => layoutPeers();
  overlay.setMap(map);
  // keep clear of the search bar (top), Google's attribution (bottom) and the
  // zoom buttons (right)
  // and the "Return to my spot" control (top right)
  const EDGE = { top: 86, right: 64, bottom: 42, left: 18 };

  function layoutPeers() {
    const proj = overlay.getProjection();
    if (!proj) return;
    const w = canvas.clientWidth;
    const hgt = canvas.clientHeight;
    const centre = map.getCenter();
    peerLayer.replaceChildren(
      ...peers.map((p) => {
        const pt = proj.fromLatLngToContainerPixel(new google.maps.LatLng(p.lat, p.lng));
        const label = `Jump to ${p.displayName}'s view`;
        const jump = () => {
          map.panTo({ lat: p.lat, lng: p.lng });
          map.setZoom(Math.round(p.zoom));
        };
        const inside = pt && pt.x >= EDGE.left && pt.x <= w - EDGE.right && pt.y >= EDGE.top && pt.y <= hgt - EDGE.bottom;
        if (inside) {
          return h(
            "button",
            { class: "peer-marker", type: "button", style: `--pc:${p.colour}; left:${pt.x}px; top:${pt.y}px`, title: `${p.displayName} is looking here`, "aria-label": `${p.displayName} is looking at this area. ${label}`, onclick: jump },
            h("span", { class: "peer-initials" }, p.initials),
            h("span", { class: "peer-name" }, `${p.displayName}'s view`),
          );
        }
        // off screen: an arrow on the edge, along the line from this map's
        // centre to theirs, in screen space
        const cx = w / 2;
        const cy = hgt / 2;
        const dx = (pt?.x ?? cx) - cx;
        const dy = (pt?.y ?? cy) - cy;
        const sx = dx === 0 ? Infinity : (dx > 0 ? w - EDGE.right - cx : cx - EDGE.left) / Math.abs(dx);
        const sy = dy === 0 ? Infinity : (dy > 0 ? hgt - EDGE.bottom - cy : cy - EDGE.top) / Math.abs(dy);
        const s = Math.min(sx, sy);
        const x = cx + dx * s;
        const y = cy + dy * s;
        // anchor the label inward from the edge it sits on, so none of it is cut off
        const side = sx <= sy ? (dx > 0 ? "right" : "left") : dy > 0 ? "bottom" : "top";
        const shift = { left: "translate(0, -50%)", right: "translate(-100%, -50%)", top: "translate(-50%, 0)", bottom: "translate(-50%, -100%)" }[side];
        const angle = (Math.atan2(dy, dx) * 180) / Math.PI;
        const km = centre ? distanceKm({ lat: centre.lat(), lng: centre.lng() }, p) : null;
        return h(
          "button",
          { class: `peer-edge${side === "right" ? " peer-edge-right" : ""}`, type: "button", style: `--pc:${p.colour}; left:${x}px; top:${y}px; transform:${shift}`, title: label, "aria-label": `${p.displayName} is exploring ${km === null ? "elsewhere" : `${formatKm(km)} away`}. ${label}`, onclick: jump },
          h("span", { class: "peer-arrow", style: `transform: rotate(${angle}deg)`, "aria-hidden": "true" }, "➤"),
          h("span", { class: "peer-tag" }, h("strong", {}, p.initials), ` ${p.displayName}${km === null ? "" : ` · ${formatKm(km)}`}`),
        );
      }),
    );
  }
  map.addListener("bounds_changed", layoutPeers);

  // --- "My spot": the last place this person deliberately picked ---
  // Its own marker, outside update()'s rebuilt list and never part of a
  // fitBounds, so later renders can't move or drop it. Local to this tab.
  let mySpot = null;
  const spotPin = h("span", { class: "my-spot", "aria-hidden": "true" }, h("span", { class: "my-spot-dot" }), h("span", { class: "my-spot-label" }, "My spot"));
  const spotMarker = new AdvancedMarkerElement({ content: spotPin, title: "My spot: the last place you picked on the map", zIndex: 150 });
  // "Return to my spot", a Google map control
  const returnBtn = h(
    "button",
    { class: "map-control my-spot-return", type: "button", disabled: true, "data-map": "return", "aria-label": "Return to my spot", title: "Pick a spot on the map first" },
    h("span", { class: "my-spot-icon", "aria-hidden": "true" }),
    h("span", { class: "my-spot-return-text" }, "Return to my spot"),
  );
  // a control's events must never reach the map as a click on the map
  for (const type of ["click", "dblclick", "pointerdown", "mousedown", "touchstart", "contextmenu"]) returnBtn.addEventListener(type, (e) => e.stopPropagation());
  returnBtn.addEventListener("click", () => api.returnToMySpot());
  const controlBox = h("div", { class: "map-control-box" }, returnBtn);
  // Wide maps: top right, clear of the search bar (top left), the zoom
  // buttons and attribution (bottom right) and the call window (bottom).
  // Narrow maps (phones): the search bar spans the top, so it goes bottom
  // right, above Google's camera control, where the phone call panel isn't.
  let slot = null;
  const placeControl = () => {
    const want = canvas.clientWidth > 600 ? google.maps.ControlPosition.RIGHT_TOP : google.maps.ControlPosition.RIGHT_BOTTOM;
    if (want === slot) return;
    if (slot !== null) {
      const arr = map.controls[slot];
      const i = arr.getArray().indexOf(controlBox);
      if (i >= 0) arr.removeAt(i);
    }
    map.controls[want].push(controlBox);
    slot = want;
  };
  placeControl();
  const controlResize = new ResizeObserver(placeControl);
  controlResize.observe(canvas);

  // report this map's view, throttled: at most every 400 ms while moving, and
  // once more when it settles
  let lastSent = 0;
  let pendingView = null;
  const viewNow = () => {
    const c = map.getCenter();
    return c ? { lat: c.lat(), lng: c.lng(), zoom: map.getZoom() ?? 0, heading: map.getHeading?.() ?? 0 } : null;
  };
  const report = () => {
    if (!handlers.onViewChange) return;
    const v = viewNow();
    if (!v) return;
    const wait = 400 - (Date.now() - lastSent);
    if (wait > 0) {
      clearTimeout(pendingView);
      pendingView = setTimeout(report, wait);
      return;
    }
    lastSent = Date.now();
    handlers.onViewChange(v);
  };
  map.addListener("bounds_changed", report);
  map.addListener("idle", report);

  const onAuthFail = () => {
    schematic(el, handlers, "Google Maps rejected the browser key. Check its website restrictions and that the Maps JavaScript API is enabled.").then((s) => {
      api.update = s.update;
      api.focus = s.focus;
      api.setPeers = s.setPeers;
      api.setMySpot = s.setMySpot;
      api.returnToMySpot = s.returnToMySpot;
      spotMarker.map = null;
      peerLayer.remove();
      s.update(api.last);
    });
  };
  window.addEventListener("wayline:maps-auth-failed", onAuthFail, { once: true });

  const api = {
    kind: "google",
    last: null,
    update(data) {
      api.last = data;
      const { stops, results, center, selectedPlaceId } = data;
      for (const m of markers) m.map = null;
      markers = [];
      line?.setMap(null);
      for (const r of routeLines) r.setMap(null);
      // real route geometry from the Routes API, drawn solid
      routeLines = (data.routes ?? []).map((r) => new Polyline({ map, path: r.path, strokeColor: MODE_COLOUR[r.mode] ?? "#15171A", strokeOpacity: 0.92, strokeWeight: 6, zIndex: 5 }));

      stops.forEach((s, i) => {
        const label = stopLabel(stops, i);
        const pin = h(
          "button",
          { class: `pin${s.start ? " pin-start" : ""}${s.selected ? " pin-on" : ""}`, type: "button", style: `--k:${KIND_COLOUR[s.kind]}`, "aria-label": s.start ? `Start: ${s.title}` : `Stop ${label}: ${s.title}` },
          h("span", {}, label),
          !s.start && h("i", { class: "pin-kind", "aria-hidden": "true" }),
        );
        pin.addEventListener("click", (e) => {
          e.stopPropagation();
          handlers.onSelectStop(s.id);
        });
        markers.push(new AdvancedMarkerElement({ map, position: { lat: s.lat, lng: s.lng }, content: pin, title: s.title, zIndex: s.start ? 60 : 10 + i }));
      });
      // the spot just clicked or being considered: shown, never added on its own
      if (data.temp) {
        const dot = h("span", { class: `pin pin-temp${data.temp.start ? " pin-temp-start" : ""}`, "aria-hidden": "true" }, h("span", {}, data.temp.start ? "S" : "+"));
        markers.push(new AdvancedMarkerElement({ map, position: { lat: data.temp.lat, lng: data.temp.lng }, content: dot, title: data.temp.label ?? "Selected spot", zIndex: 200 }));
      }
      results.forEach((r) => {
        const dot = h("button", { class: `pin pin-result${r.placeId === selectedPlaceId ? " pin-on" : ""}`, type: "button", "aria-label": r.name }, "");
        dot.addEventListener("click", (e) => {
          e.stopPropagation();
          handlers.onSelectResult(r.placeId);
        });
        markers.push(new AdvancedMarkerElement({ map, position: { lat: r.lat, lng: r.lng }, content: dot, title: r.name, zIndex: 100 }));
      });
      if (stops.length > 1) {
        // the order of the stops, drawn straight: not a route
        line = new Polyline({
          map,
          path: stops.map((s) => ({ lat: s.lat, lng: s.lng })),
          strokeOpacity: 0,
          icons: [{ icon: { path: "M 0,-1 0,1", strokeOpacity: 0.55, strokeColor: "#15171A", scale: 2 }, offset: "0", repeat: "10px" }],
        });
      }

      const pts = [...stops, ...results];
      const key = (data.fitKey ?? "") + pts.map((p) => `${p.lat.toFixed(4)},${p.lng.toFixed(4)}`).join("|") || (center ? `${center.lat},${center.lng}` : "");
      if (key === lastFit) return;
      lastFit = key;
      // keepView: a collaborator's change updates the markers but leaves this
      // person's zoom and position alone
      if (data.keepView) return;
      if (pts.length > 1) {
        const b = new google.maps.LatLngBounds();
        pts.forEach((p) => b.extend(p));
        map.fitBounds(b, 64);
      } else if (pts.length === 1) {
        map.setCenter(pts[0]);
        map.setZoom(14);
      } else if (center) {
        map.setCenter(center);
        map.setZoom(12);
      }
    },
    focus(p) {
      map.panTo({ lat: p.lat, lng: p.lng });
      if (map.getZoom() < 14) map.setZoom(15);
    },
    // the other people's views: [{ displayName, initials, colour, lat, lng, zoom }]
    setPeers(list) {
      peers = list;
      layoutPeers();
    },
    zoom: () => map.getZoom() ?? null,
    // { lat, lng, zoom } or null. Only marks it: never moves the camera.
    setMySpot(spot) {
      mySpot = spot;
      spotMarker.position = spot ? { lat: spot.lat, lng: spot.lng } : null;
      spotMarker.map = spot ? map : null;
      returnBtn.disabled = !spot;
      returnBtn.title = spot ? "Return to my spot" : "Pick a spot on the map first";
    },
    // Moves the camera only: no stops, routes or nearby-place requests.
    returnToMySpot() {
      if (!mySpot) return false;
      // one camera move, centre and zoom together: a panTo + setZoom pair can
      // land on a mix of targets if another animation (a jump to someone's
      // view) is still running
      map.moveCamera({ center: { lat: mySpot.lat, lng: mySpot.lng }, zoom: Math.max(3, Math.round(mySpot.zoom ?? 15)) });
      spotPin.classList.remove("is-pulsing");
      void spotPin.offsetWidth; // restart the highlight
      spotPin.classList.add("is-pulsing");
      return true;
    },
    destroy() {
      window.removeEventListener("wayline:maps-auth-failed", onAuthFail);
      clearTimeout(pendingView);
      overlay.setMap(null);
      for (const m of markers) m.map = null;
      spotMarker.map = null;
      controlResize.disconnect();
      const arr = slot === null ? null : map.controls[slot];
      const i = arr ? arr.getArray().indexOf(controlBox) : -1;
      if (i >= 0) arr.removeAt(i);
    },
  };
  return api;
}

async function schematic(el, handlers, problem) {
  const NS = "http://www.w3.org/2000/svg";
  const box = h("div", { class: "schematic" });
  const note = h(
    "div",
    { class: "map-note" },
    h("strong", {}, "Schematic view, not a map."),
    " ",
    problem ?? "The interactive Google map needs GOOGLE_MAPS_BROWSER_KEY on the server. Stops are placed by their coordinates.",
  );
  el.replaceChildren(box, note);
  const svgEl = document.createElementNS(NS, "svg");
  svgEl.setAttribute("class", "schematic-svg");
  svgEl.setAttribute("role", "img");
  box.append(svgEl);

  const node = (name, attrs, parent = svgEl) => {
    const n = document.createElementNS(NS, name);
    for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, String(v));
    parent.append(n);
    return n;
  };

  const api = {
    kind: "schematic",
    last: null,
    update(data) {
      api.last = data;
      const { stops, results, selectedPlaceId } = data;
      // drawn in real pixels of the pane, so it stays legible on a phone
      const W = Math.max(box.clientWidth, 280) || 1000;
      const H = Math.max(box.clientHeight, 280) || 640;
      svgEl.setAttribute("viewBox", `0 0 ${W} ${H}`);
      svgEl.replaceChildren();
      svgEl.setAttribute("aria-label", stops.length ? `Schematic of ${stops.length} stops in plan order` : "Empty schematic");
      for (let x = 0; x <= W; x += 50) node("line", { x1: x, y1: 0, x2: x, y2: H, class: "grid" });
      for (let y = 0; y <= H; y += 50) node("line", { x1: 0, y1: y, x2: W, y2: y, class: "grid" });
      const pts = [...stops, ...results];
      if (!pts.length) {
        const t = node("text", { x: W / 2, y: H / 2, "text-anchor": "middle", class: "schematic-empty" });
        t.textContent = "Search for a place to see it here";
        return;
      }
      const lats = pts.map((p) => p.lat);
      const lngs = pts.map((p) => p.lng);
      const [minLat, maxLat, minLng, maxLng] = [Math.min(...lats), Math.max(...lats), Math.min(...lngs), Math.max(...lngs)];
      const k = Math.cos(((minLat + maxLat) / 2) * (Math.PI / 180));
      const spanX = Math.max((maxLng - minLng) * k, 0.005);
      const spanY = Math.max(maxLat - minLat, 0.005);
      // room on the right for labels, and for the search bar and note on top and bottom
      const short = H < 520;
      const pad = { left: 40, right: Math.min(200, W * 0.3), top: short ? 40 : 110, bottom: short ? 110 : 120 };
      const scale = Math.min((W - pad.left - pad.right) / spanX, (H - pad.top - pad.bottom) / spanY);
      const cx = (minLng + maxLng) / 2;
      const cy = (minLat + maxLat) / 2;
      const midX = pad.left + (W - pad.left - pad.right) / 2;
      const midY = pad.top + (H - pad.top - pad.bottom) / 2;
      const at = (p) => [midX + (p.lng - cx) * k * scale, midY - (p.lat - cy) * scale];

      if (stops.length > 1) node("polyline", { points: stops.map((s) => at(s).join(",")).join(" "), class: "schematic-path" });
      for (const r of data.routes ?? []) {
        node("polyline", { points: r.path.map((q) => at(q).join(",")).join(" "), class: "schematic-route", style: `stroke:${MODE_COLOUR[r.mode] ?? "#15171A"}` });
      }
      results.forEach((r) => {
        const [x, y] = at(r);
        const g = node("g", { class: `schematic-result${r.placeId === selectedPlaceId ? " on" : ""}`, tabindex: 0, role: "button", "aria-label": r.name });
        node("circle", { cx: x, cy: y, r: 8 }, g);
        const left = x > W * 0.62;
        const t = node("text", { x: left ? x - 13 : x + 13, y: y + 4.5, "text-anchor": left ? "end" : "start" }, g);
        t.textContent = r.name;
        const pick = () => handlers.onSelectResult(r.placeId);
        g.addEventListener("click", pick);
        g.addEventListener("keydown", (e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), pick()));
      });
      stops.forEach((s, i) => {
        const [x, y] = at(s);
        const label = stopLabel(stops, i);
        const g = node("g", { class: `schematic-stop${s.start ? " start" : ""}${s.selected ? " on" : ""}`, tabindex: 0, role: "button", "aria-label": s.start ? `Start: ${s.title}` : `Stop ${label}: ${s.title}`, style: `--k:${KIND_COLOUR[s.kind]}` });
        node("circle", { cx: x, cy: y, r: 14 }, g);
        const n = node("text", { x, y: y + 4.5, "text-anchor": "middle", class: "num" }, g);
        n.textContent = label;
        // labels near the right edge go on the left of the marker
        const left = x > W * 0.62;
        const t = node("text", { x: left ? x - 20 : x + 20, y: y + 4.5, class: "label", "text-anchor": left ? "end" : "start" }, g);
        t.textContent = s.title;
        const pick = () => handlers.onSelectStop(s.id);
        g.addEventListener("click", pick);
        g.addEventListener("keydown", (e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), pick()));
      });
    },
    focus() {},
    setPeers() {}, // not a map: there's nowhere true to show someone's view
    // not a map either: a spot has nowhere true to be shown or returned to
    setMySpot() {},
    returnToMySpot: () => false,
    destroy() {
      resize.disconnect();
    },
  };
  const resize = new ResizeObserver(() => api.last && api.update(api.last));
  resize.observe(box);
  return api;
}
