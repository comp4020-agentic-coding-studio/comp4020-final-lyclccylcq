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

const KIND_COLOUR = { attraction: "#F2603D", food: "#E08A00", shopping: "#7A5AF8", accommodation: "#0F7C8C", custom: "#5F6B7A" };

export async function createMap(el, { config, onSelectStop, onSelectResult }) {
  if (config.mapsBrowserKey && !authFailed) {
    try {
      return await googleMap(el, config, { onSelectStop, onSelectResult });
    } catch (err) {
      return schematic(el, { onSelectStop, onSelectResult }, err.message);
    }
  }
  return schematic(el, { onSelectStop, onSelectResult }, null);
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
    clickableIcons: false,
    mapTypeControl: false,
    streetViewControl: false,
    fullscreenControl: false,
    gestureHandling: "greedy",
  });
  let markers = [];
  let line = null;
  let lastFit = "";

  const onAuthFail = () => {
    schematic(el, handlers, "Google Maps rejected the browser key. Check its website restrictions and that the Maps JavaScript API is enabled.").then((s) => {
      api.update = s.update;
      api.focus = s.focus;
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

      stops.forEach((s, i) => {
        const pin = h("button", { class: `pin${s.selected ? " pin-on" : ""}`, type: "button", style: `--c:${KIND_COLOUR[s.kind]}`, "aria-label": `Stop ${i + 1}: ${s.title}` }, h("span", {}, String(i + 1)));
        pin.addEventListener("click", (e) => {
          e.stopPropagation();
          handlers.onSelectStop(s.id);
        });
        markers.push(new AdvancedMarkerElement({ map, position: { lat: s.lat, lng: s.lng }, content: pin, title: s.title, zIndex: 10 + i }));
      });
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
          icons: [{ icon: { path: "M 0,-1 0,1", strokeOpacity: 0.7, strokeColor: "#1C2430", scale: 2.5 }, offset: "0", repeat: "12px" }],
        });
      }

      const pts = [...stops, ...results];
      const key = pts.map((p) => `${p.lat.toFixed(4)},${p.lng.toFixed(4)}`).join("|") || (center ? `${center.lat},${center.lng}` : "");
      if (key === lastFit) return;
      lastFit = key;
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
    destroy() {
      window.removeEventListener("wayline:maps-auth-failed", onAuthFail);
      for (const m of markers) m.map = null;
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
      const pad = { left: 40, right: Math.min(200, W * 0.4), top: 110, bottom: 120 };
      const scale = Math.min((W - pad.left - pad.right) / spanX, (H - pad.top - pad.bottom) / spanY);
      const cx = (minLng + maxLng) / 2;
      const cy = (minLat + maxLat) / 2;
      const midX = pad.left + (W - pad.left - pad.right) / 2;
      const midY = pad.top + (H - pad.top - pad.bottom) / 2;
      const at = (p) => [midX + (p.lng - cx) * k * scale, midY - (p.lat - cy) * scale];

      if (stops.length > 1) node("polyline", { points: stops.map((s) => at(s).join(",")).join(" "), class: "schematic-path" });
      results.forEach((r) => {
        const [x, y] = at(r);
        const g = node("g", { class: `schematic-result${r.placeId === selectedPlaceId ? " on" : ""}`, tabindex: 0, role: "button", "aria-label": r.name });
        node("circle", { cx: x, cy: y, r: 8 }, g);
        const t = node("text", { x: x + 13, y: y + 4.5 }, g);
        t.textContent = r.name;
        const pick = () => handlers.onSelectResult(r.placeId);
        g.addEventListener("click", pick);
        g.addEventListener("keydown", (e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), pick()));
      });
      stops.forEach((s, i) => {
        const [x, y] = at(s);
        const g = node("g", { class: `schematic-stop${s.selected ? " on" : ""}`, tabindex: 0, role: "button", "aria-label": `Stop ${i + 1}: ${s.title}`, style: `--c:${KIND_COLOUR[s.kind]}` });
        node("circle", { cx: x, cy: y, r: 14 }, g);
        const n = node("text", { x, y: y + 4.5, "text-anchor": "middle", class: "num" }, g);
        n.textContent = String(i + 1);
        const t = node("text", { x: x + 20, y: y + 4.5, class: "label" }, g);
        t.textContent = s.title;
        const pick = () => handlers.onSelectStop(s.id);
        g.addEventListener("click", pick);
        g.addEventListener("keydown", (e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), pick()));
      });
    },
    focus() {},
    destroy() {
      resize.disconnect();
    },
  };
  const resize = new ResizeObserver(() => api.last && api.update(api.last));
  resize.observe(box);
  return api;
}
