import { createMap } from "/map.js";
import { placeDialog } from "/places.js";
import { coverImg, photoFor } from "/photos.js";
import { api, CATEGORY_LABEL, decodePolyline, dur, fill, h, hhmm, icon, KIND_LABEL, openDialog, toast } from "/ui.js";

const MODE_LABEL = { WALK: "Walk", TRANSIT: "Public transport", DRIVE: "Drive" };

// The preview of one itinerary: its stops on the map and in order, places
// inspected on demand, and travel between stops looked up only when asked.
export async function renderPreview(app, id, ctx) {
  const { config, navigate } = ctx;
  app.replaceChildren(ctx.topbar("home"), h("main", { class: "preview" }, h("div", { class: "boot", role: "status" }, "Loading itinerary…")));
  let t;
  try {
    t = await api(`/api/itineraries/${encodeURIComponent(id)}`);
  } catch (err) {
    app.querySelector("main").replaceChildren(
      h("div", { class: "invite-card" }, h("h1", {}, "Itinerary not found"), h("p", {}, err.message), h("a", { class: "btn btn-primary", href: "/", "data-link": true }, "Back to recommendations")),
    );
    return () => {};
  }

  // a trip a traveller published (pub-…) rather than one of Wayline's own
  const shared = t.source === "user";
  const S = { day: 1, selected: null, mode: "WALK", routes: new Map(), loading: false };
  const days = [...new Set(t.stops.map((s) => s.day))];
  const dayStops = () => t.stops.filter((s) => s.day === S.day);
  const verified = t.stops.filter((s) => s.placeId).length;
  const located = (s) => typeof s.lat === "number" && typeof s.lng === "number";
  const reviewsBox = h("section", { class: "pv-reviews", "aria-labelledby": "pv-reviews-h" });

  const mapHost = h("div", { class: "map-host" });
  const mapPane = h("section", { class: "preview-map", "aria-label": "Map of the itinerary" }, mapHost);
  const stopsBox = h("ol", { class: "pv-stops", "aria-label": "Stops in order" });
  const dayTabs = h("div", { class: "day-tabs pv-days", role: "tablist", "aria-label": "Itinerary days" });
  const routeBar = h("div", { class: "pv-routes" });

  const panel = h(
    "section",
    { class: "preview-panel" },
    h("a", { class: "back-link", href: "/#near", "data-link": true }, icon("back"), "Back to recommendations"),
    shared && photoFor(t.cover) && h("div", { class: "pv-cover has-photo" }, coverImg(photoFor(t.cover), { decorative: true })),
    !shared && h("p", { class: "it-tags" }, t.categories.map((c) => h("span", { class: "tag" }, CATEGORY_LABEL[c] ?? c))),
    h("h1", {}, t.title),
    shared && h("p", { class: "pv-author", "data-pv": "author" }, `By ${t.author.displayName} · published ${new Date(t.publishedAt).toLocaleDateString()}`),
    shared && h("p", { class: "pv-rating", "data-pv": "rating" }, ratingText(t.rating)),
    h(
      "p",
      { class: "pv-meta" },
      h("span", {}, t.destination),
      h("span", {}, t.days > 1 ? `${t.days} days` : `About ${dur(Math.round(t.durationMin / 30) * 30)}`),
      h("span", {}, `${t.stopCount} ${t.stopCount === 1 ? "stop" : "stops"}`),
    ),
    h("p", { class: "pv-desc" }, t.description),
    shared && t.status === "unpublished" && h("p", { class: "small leg-warn" }, "Unpublished: only you can see this page."),
    h(
      "p",
      { class: "pv-source" },
      shared ? "Shared by a Wayline traveller, as they published it. It doesn't change when they edit their own trip. " : "A curated sample itinerary by Wayline. ",
      verified === t.stopCount
        ? "Every stop is matched to a Google Maps place."
        : verified
          ? `${verified} of ${t.stopCount} stops are matched to Google Maps places; the rest show approximate locations.`
          : "Stop locations are approximate: they haven't been matched to Google Maps places on this server.",
    ),
    h(
      "div",
      { class: "pv-actions" },
      !(shared && t.status !== "published") && h("button", { class: "btn btn-primary", type: "button", "data-pv": "use", onclick: copyDialog }, icon("plus"), shared ? "Use This Template" : "Plan this trip"),
      h("span", { class: "muted small" }, "Copies the stops into a new private trip you can edit and share."),
    ),
    days.length > 1 && dayTabs,
    routeBar,
    stopsBox,
    shared && reviewsBox,
  );
  app.querySelector("main").replaceChildren(h("div", { class: "preview-grid" }, mapPane, panel));

  const map = await createMap(mapHost, {
    config,
    onSelectStop: (sid) => select(sid, true),
    onSelectResult: () => {},
  });

  function renderDays() {
    dayTabs.replaceChildren(
      ...days.map((d) =>
        h("button", { type: "button", role: "tab", class: `day-tab${d === S.day ? " on" : ""}`, "aria-selected": String(d === S.day), onclick: () => { S.day = d; S.selected = null; render(); } }, h("span", { class: "day-tab-n" }, `Day ${d}`), h("span", { class: "day-tab-count" }, `${t.stops.filter((s) => s.day === d).length} stops`)),
      ),
    );
  }

  const legKey = (a, b) => `${a.id}>${b.id}|${S.mode}`;

  function renderRouteBar() {
    const stops = dayStops();
    if (stops.length < 2) return routeBar.replaceChildren();
    if (!config.routes) {
      return routeBar.replaceChildren(h("p", { class: "muted small" }, "Travel times between stops need Google Maps configured on the server. None are estimated here."));
    }
    fill(
      routeBar,
      h(
        "div",
        { class: "modes", role: "group", "aria-label": "Travel mode" },
        Object.entries(MODE_LABEL).map(([m, label]) =>
          h("button", { type: "button", class: `mode${S.mode === m ? " on" : ""}`, "aria-pressed": String(S.mode === m), onclick: () => { S.mode = m; render(); } }, icon(m === "WALK" ? "walk" : m === "TRANSIT" ? "transit" : "drive"), h("span", {}, label)),
        ),
      ),
      h("button", { class: "btn btn-outline btn-sm", type: "button", disabled: S.loading, onclick: loadRoutes }, S.loading ? "Calculating…" : "Get travel times"),
      S.mode === "TRANSIT" && h("p", { class: "muted small" }, "Public transport is looked up for departures from now, since this itinerary has no date yet."),
    );
  }

  async function loadRoutes() {
    const stops = dayStops();
    S.loading = true;
    renderRouteBar();
    const wp = (s) => (s.placeId ? { placeId: s.placeId } : { lat: s.lat, lng: s.lng });
    await Promise.all(
      stops.slice(0, -1).map(async (a, i) => {
        const b = stops[i + 1];
        try {
          const r = await api("/api/routes", { method: "POST", body: { origin: wp(a), destination: wp(b), mode: S.mode } });
          S.routes.set(legKey(a, b), r);
        } catch (err) {
          S.routes.set(legKey(a, b), { status: "error", message: err.message });
        }
      }),
    );
    S.loading = false;
    render();
  }

  function legLine(a, b) {
    const r = S.routes.get(legKey(a, b));
    if (!r) return h("li", { class: "pv-leg muted" }, "Travel time not calculated");
    if (r.status !== "ok") return h("li", { class: "pv-leg leg-warn" }, `No ${MODE_LABEL[S.mode].toLowerCase()} route: ${r.message ?? "Google returned none."}`);
    const transit = (r.steps ?? []).filter((s) => s.kind === "transit");
    return h(
      "li",
      { class: `pv-leg pv-leg-${S.mode.toLowerCase()}` },
      icon(S.mode === "WALK" ? "walk" : S.mode === "TRANSIT" ? "transit" : "drive"),
      h("span", {}, `${MODE_LABEL[S.mode]} · ${dur(Math.max(1, Math.ceil(r.durationSec / 60)))}${r.distanceM ? ` · ${(r.distanceM / 1000).toFixed(1)} km` : ""}`),
      transit.length > 0 && h("span", { class: "lines" }, transit.map((s) => h("span", { class: "line-chip", style: s.color ? `--lc:${s.color};--lt:${s.textColor ?? "#fff"}` : "" }, [s.vehicle, s.line].filter(Boolean).join(" ") || "Transit"))),
      h("span", { class: "leg-attrib", translate: "no" }, "Google Maps"),
    );
  }

  function renderStops() {
    const stops = dayStops();
    const items = [];
    stops.forEach((s, i) => {
      items.push(
        h(
          "li",
          { class: `pv-stop kind-${s.kind}${S.selected === s.id ? " selected" : ""}`, dataset: { id: s.id } },
          h("span", { class: "stop-num" }, String(i + 1)),
          h(
            "div",
            { class: "grow" },
            h("p", { class: "stop-time" }, s.startMin === null ? dur(s.durationMin) : `${hhmm(s.startMin)} – ${hhmm(s.startMin + s.durationMin)} · ${dur(s.durationMin)}`),
            h("h3", {}, h("button", { class: "linklike", type: "button", onclick: () => select(s.id, false) }, s.title)),
            h(
              "p",
              { class: "stop-meta" },
              h("span", { class: `tag tag-${s.kind}` }, KIND_LABEL[s.kind] ?? s.kind),
              s.placeId ? h("span", { class: "tag tag-rule" }, "Google place") : s.placeSource === "custom" ? h("span", { class: "tag" }, "Pinned spot") : s.placeSource === "demo" ? h("span", { class: "tag tag-demo" }, "Demo place") : !located(s) ? h("span", { class: "muted small" }, "No place") : h("span", { class: "tag tag-demo" }, "Approximate location"),
            ),
            s.note && h("p", { class: "muted small" }, s.note),
          ),
          h("button", { class: "btn btn-ghost btn-quiet btn-sm pv-inspect", type: "button", onclick: () => inspect(s) }, "Inspect"),
        ),
      );
      if (i + 1 < stops.length) items.push(legLine(s, stops[i + 1]));
    });
    stopsBox.replaceChildren(...items);
  }

  function renderMap() {
    const stops = dayStops();
    const routes = [];
    stops.slice(0, -1).forEach((a, i) => {
      const r = S.routes.get(legKey(a, stops[i + 1]));
      if (r?.status === "ok" && r.polyline) routes.push({ mode: S.mode, path: decodePolyline(r.polyline) });
    });
    map.update({
      stops: stops.filter(located).map((s) => ({ id: s.id, title: s.title, kind: s.kind, lat: s.lat, lng: s.lng, selected: s.id === S.selected })),
      results: [],
      routes,
      center: t.ref,
      fitKey: `day${S.day}`,
      selectedPlaceId: null,
    });
  }

  function select(sid, scroll) {
    S.selected = sid;
    render();
    const s = t.stops.find((x) => x.id === sid);
    if (s && located(s)) map.focus(s);
    if (scroll) stopsBox.querySelector(`[data-id="${sid}"]`)?.scrollIntoView({ block: "center", behavior: "smooth" });
  }

  function inspect(s) {
    S.selected = s.id;
    render();
    placeDialog({ placeId: s.placeId, name: s.title, lat: s.lat, lng: s.lng, source: s.placeId ? "google" : "curated", note: s.note, query: s.placeQuery }, ctx);
  }

  function copyDialog() {
    if (!ctx.me) return navigate(`/login?next=${encodeURIComponent(`/itineraries/${t.id}`)}`);
    const d = new Date(Date.now() + 14 * 86_400_000);
    if (t.categories.includes("weekend")) d.setUTCDate(d.getUTCDate() + ((6 - d.getUTCDay() + 7) % 7));
    const error = h("p", { class: "form-error", role: "alert", hidden: true });
    const form = h(
      "form",
      { method: "dialog", class: "stack" },
      h("h2", {}, shared ? "Use This Template" : "Plan this trip"),
      h("p", { class: "muted" }, `Wayline will create a new private trip with ${t.stopCount} ${t.stopCount === 1 ? "stop" : "stops"} over ${t.days} day${t.days > 1 ? "s" : ""}, owned by you. You can change anything afterwards and invite others${shared ? `; ${t.author.displayName}'s trip isn't affected` : ""}.`),
      h("label", { class: "field" }, h("span", {}, "First day"), h("input", { name: "startDate", type: "date", required: true, value: d.toISOString().slice(0, 10) })),
      error,
      h("div", { class: "dialog-actions" }, h("button", { class: "btn btn-ghost", type: "button", onclick: () => dialog.close() }, "Cancel"), h("button", { class: "btn btn-primary", type: "submit" }, "Create trip")),
    );
    const dialog = openDialog(h("dialog", { class: "dialog" }, form));
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      try {
        const trip = await api(`/api/itineraries/${t.id}/copy`, { method: "POST", body: { startDate: form.startDate.value } });
        dialog.close();
        toast(`Created "${trip.title}".`);
        navigate(`/trips/${trip.id}`);
      } catch (err) {
        error.textContent = err.message;
        error.hidden = false;
      }
    });
  }

  // --- ratings and reviews (published trips only) ---
  function renderReviews() {
    if (!shared) return;
    const mine = t.myReview;
    const canReview = ctx.me && !t.mine && t.status === "published";
    const form = canReview ? reviewForm(mine) : null;
    fill(
      reviewsBox,
      h("h2", { id: "pv-reviews-h" }, "Reviews"),
      h("p", { class: "pv-rating" }, ratingText(t.rating)),
      !ctx.me && h("p", { class: "small muted" }, h("a", { href: `/login?next=${encodeURIComponent(`/itineraries/${t.id}`)}`, "data-link": true }, "Sign in"), " to rate this trip."),
      t.mine && h("p", { class: "small muted" }, "This is your trip, so you can't review it."),
      form,
      h(
        "ul",
        { class: "review-list" },
        t.reviews.length
          ? t.reviews.map((r) =>
              h(
                "li",
                { class: "review", "data-review": r.id },
                h("p", {}, h("span", { class: "stars", "aria-label": `${r.rating} out of 5` }, "★".repeat(r.rating) + "☆".repeat(5 - r.rating)), " ", h("strong", {}, r.author.displayName), r.mine && " (you)", h("span", { class: "muted small" }, ` · ${new Date(r.updatedAt).toLocaleDateString()}`)),
                r.comment && h("p", { class: "review-text" }, r.comment),
              ),
            )
          : h("li", { class: "muted small" }, "No reviews yet."),
      ),
    );
  }

  function reviewForm(mine) {
    const error = h("p", { class: "form-error", role: "alert", hidden: true });
    const stars = h(
      "div",
      { class: "star-pick", role: "radiogroup", "aria-label": "Rating" },
      [1, 2, 3, 4, 5].map((n) => h("label", { class: "star-opt" }, h("input", { type: "radio", name: "rating", value: String(n), required: true, checked: mine?.rating === n }), h("span", {}, `${n}★`))),
    );
    const form = h(
      "form",
      { class: "stack review-form", "data-pv": "review-form" },
      h("h3", {}, mine ? "Your review" : "Write a Review"),
      stars,
      h("label", { class: "field" }, h("span", {}, "Comment (optional)"), h("textarea", { name: "comment", maxlength: 1000, rows: 3 }, mine?.comment ?? "")),
      error,
      h(
        "div",
        { class: "row-actions" },
        h("button", { class: "btn btn-primary btn-sm", type: "submit" }, mine ? "Update review" : "Post review"),
        mine && h("button", { class: "btn btn-ghost btn-sm btn-danger-text", type: "button", "data-pv": "delete-review", onclick: remove }, "Delete review"),
      ),
    );
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      try {
        const res = await api(`/api/itineraries/${t.id}/reviews`, { method: "PUT", body: { rating: Number(form.rating.value), comment: form.comment.value } });
        Object.assign(t, res);
        toast(mine ? "Review updated." : "Thanks for your review.");
        render();
      } catch (err) {
        error.textContent = err.message;
        error.hidden = false;
      }
    });
    async function remove() {
      if (!confirm("Delete your review?")) return;
      try {
        Object.assign(t, await api(`/api/itineraries/${t.id}/reviews/${mine.id}`, { method: "DELETE" }));
        toast("Review deleted.");
        render();
      } catch (err) {
        error.textContent = err.message;
        error.hidden = false;
      }
    }
    return form;
  }

  function render() {
    renderDays();
    renderRouteBar();
    renderStops();
    renderMap();
    renderReviews();
    for (const el of panel.querySelectorAll(".pv-rating")) el.textContent = ratingText(t.rating);
  }
  render();
  return () => map.destroy();
}

const ratingText = (r) => (r.count ? `Rating: ${r.average.toFixed(1)} / 5 · ${r.count} ${r.count === 1 ? "review" : "reviews"}` : "No ratings yet");
