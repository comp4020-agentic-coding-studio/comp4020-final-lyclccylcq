import { discoveryBack } from "/discover.js";
import { createMap } from "/map.js";
import { placeDialog } from "/places.js";
import { coverImg, photoFor } from "/photos.js";
import { api, CATEGORY_LABEL, decodePolyline, dur, fill, h, hhmm, icon, KIND_LABEL, openDialog, toast } from "/ui.js";
import { locale, t, tn, tServer } from "/i18n.js";

// dates: the browser's own format in English (as before), Chinese when chosen
const dateLocale = () => (locale() === "zh-CN" ? "zh-CN" : undefined);
// English here; t() at each use
const MODE_LABEL = { WALK: "Walk", TRANSIT: "Public transport", DRIVE: "Drive" };

// The preview of one itinerary: its stops on the map and in order, places
// inspected on demand, and travel between stops looked up only when asked.
export async function renderPreview(app, id, ctx) {
  const { config, navigate } = ctx;
  app.replaceChildren(ctx.topbar("home"), h("main", { class: "preview" }, h("div", { class: "boot", role: "status" }, t("Loading itinerary…"))));
  let it;
  try {
    it = await api(`/api/itineraries/${encodeURIComponent(id)}`);
  } catch (err) {
    app.querySelector("main").replaceChildren(
      h("div", { class: "invite-card" }, h("h1", {}, t("Itinerary not found")), h("p", {}, err.message), h("a", { class: "btn btn-primary", href: "/", "data-link": true }, t("Back to recommendations"))),
    );
    return () => {};
  }

  // a trip a traveller published (pub-…) rather than one of Wayline's own
  const shared = it.source === "user";
  // loading: the modes with a lookup in flight (each answer belongs to the mode it was asked for)
  const S = { day: 1, selected: null, mode: "WALK", routes: new Map(), loading: new Set() };
  const days = [...new Set(it.stops.map((s) => s.day))];
  const dayStops = () => it.stops.filter((s) => s.day === S.day);
  const verified = it.stops.filter((s) => s.placeId).length;
  const located = (s) => typeof s.lat === "number" && typeof s.lng === "number";
  const reviewsBox = h("section", { class: "pv-reviews", "aria-labelledby": "pv-reviews-h" });

  const mapHost = h("div", { class: "map-host" });
  const mapPane = h("section", { class: "preview-map", "aria-label": t("Map of the itinerary") }, mapHost);
  const stopsBox = h("ol", { class: "pv-stops", "aria-label": t("Stops in order") });
  const dayTabs = h("div", { class: "day-tabs pv-days", role: "tablist", "aria-label": t("Itinerary days") });
  const routeBar = h("div", { class: "pv-routes" });

  const panel = h(
    "section",
    { class: "preview-panel" },
    h("a", { class: "back-link", href: discoveryBack(it.id) ?? "/#near", "data-link": true }, icon("back"), t("Back to recommendations")),
    shared && photoFor(it.cover) && h("div", { class: "pv-cover has-photo" }, coverImg(photoFor(it.cover), { decorative: true })),
    !shared && h("p", { class: "it-tags" }, it.categories.map((c) => h("span", { class: "tag" }, CATEGORY_LABEL[c] ?? c))),
    h("h1", {}, it.title),
    shared && h("p", { class: "pv-author", "data-pv": "author" }, t("By {name} · published {date}", { name: it.author.displayName, date: new Date(it.publishedAt).toLocaleDateString(dateLocale()) })),
    shared && h("p", { class: "pv-rating", "data-pv": "rating" }, ratingText(it.rating)),
    h(
      "p",
      { class: "pv-meta" },
      h("span", {}, it.destination),
      h("span", {}, it.days > 1 ? t("{n} days", { n: it.days }) : t("About {time}", { time: dur(Math.round(it.durationMin / 30) * 30) })),
      h("span", {}, tn(it.stopCount, "{n} stop", "{n} stops")),
    ),
    h("p", { class: "pv-desc" }, it.description),
    shared && it.status === "unpublished" && h("p", { class: "small leg-warn" }, t("Unpublished: only you can see this page.")),
    h(
      "p",
      { class: "pv-source" },
      shared ? t("Shared by a Wayline traveller, as they published it. It doesn't change when they edit their own trip. ") : t("A curated sample itinerary by Wayline. "),
      verified === it.stopCount
        ? t("Every stop is matched to a Google Maps place.")
        : verified
          ? t("{verified} of {n} stops are matched to Google Maps places; the rest show approximate locations.", { verified, n: it.stopCount })
          : t("Stop locations are approximate: they haven't been matched to Google Maps places on this server."),
    ),
    h(
      "div",
      { class: "pv-actions" },
      !(shared && it.status !== "published") && h("button", { class: "btn btn-primary", type: "button", "data-pv": "use", onclick: copyDialog }, icon("plus"), shared ? t("Use This Template") : t("Plan this trip")),
      h("span", { class: "muted small" }, t("Copies the stops into a new private trip you can edit and share.")),
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
        h("button", { type: "button", role: "tab", class: `day-tab${d === S.day ? " on" : ""}`, "aria-selected": String(d === S.day), onclick: () => { S.day = d; S.selected = null; render(); } }, h("span", { class: "day-tab-n" }, t("Day {n}", { n: d })), h("span", { class: "day-tab-count" }, t("{n} stops", { n: it.stops.filter((s) => s.day === d).length }))),
      ),
    );
  }

  const legKey = (a, b, mode = S.mode) => `${a.id}>${b.id}|${mode}`;

  function renderRouteBar() {
    const stops = dayStops();
    if (stops.length < 2) return routeBar.replaceChildren();
    if (!config.routes) {
      return routeBar.replaceChildren(h("p", { class: "muted small" }, t("Travel times between stops need Google Maps configured on the server. None are estimated here.")));
    }
    fill(
      routeBar,
      h(
        "div",
        { class: "modes", role: "group", "aria-label": t("Travel mode") },
        Object.entries(MODE_LABEL).map(([m, label]) =>
          h("button", { type: "button", class: `mode${S.mode === m ? " on" : ""}`, "aria-pressed": String(S.mode === m), onclick: () => { S.mode = m; render(); } }, icon(m === "WALK" ? "walk" : m === "TRANSIT" ? "transit" : "drive"), h("span", {}, t(label))),
        ),
      ),
      h("button", { class: "btn btn-outline btn-sm", type: "button", disabled: S.loading.has(S.mode), "data-routes": "load", onclick: loadRoutes }, S.loading.has(S.mode) ? t("Calculating…") : t("Get travel times")),
      S.mode === "TRANSIT" && h("p", { class: "muted small" }, t("Public transport is looked up for departures from now, since this itinerary has no date yet.")),
    );
  }

  // The mode, day and stops are fixed when the lookup starts: switching mode
  // while it runs is allowed, and each answer (or error) is filed under the
  // mode and leg it was asked for, never the one showing when it arrives.
  async function loadRoutes() {
    const mode = S.mode;
    const stops = dayStops();
    const legs = stops.slice(0, -1).map((a, i) => [a, stops[i + 1]]);
    if (S.loading.has(mode)) return;
    S.loading.add(mode);
    renderRouteBar();
    const wp = (s) => (s.placeId ? { placeId: s.placeId } : { lat: s.lat, lng: s.lng });
    await Promise.all(
      legs.map(async ([a, b]) => {
        const key = legKey(a, b, mode);
        try {
          S.routes.set(key, await api("/api/routes", { method: "POST", body: { origin: wp(a), destination: wp(b), mode } }));
        } catch (err) {
          S.routes.set(key, { status: "error", message: err.message });
        }
      }),
    );
    S.loading.delete(mode);
    render();
  }

  function legLine(a, b) {
    const r = S.routes.get(legKey(a, b));
    if (!r) return h("li", { class: "pv-leg muted" }, t("Travel time not calculated"));
    if (r.status !== "ok") return h("li", { class: "pv-leg leg-warn" }, t("No {mode} route: {reason}", { mode: t(MODE_LABEL[S.mode]).toLowerCase(), reason: tServer(r.message) ?? t("Google returned none.") }));
    const transit = (r.steps ?? []).filter((s) => s.kind === "transit");
    return h(
      "li",
      { class: `pv-leg pv-leg-${S.mode.toLowerCase()}` },
      icon(S.mode === "WALK" ? "walk" : S.mode === "TRANSIT" ? "transit" : "drive"),
      h("span", {}, `${t(MODE_LABEL[S.mode])} · ${dur(Math.max(1, Math.ceil(r.durationSec / 60)))}${r.distanceM ? ` · ${(r.distanceM / 1000).toFixed(1)} km` : ""}`),
      transit.length > 0 && h("span", { class: "lines" }, transit.map((s) => h("span", { class: "line-chip", style: s.color ? `--lc:${s.color};--lt:${s.textColor ?? "#fff"}` : "" }, [s.vehicle, s.line].filter(Boolean).join(" ") || t("Transit")))),
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
              s.placeId ? h("span", { class: "tag tag-rule" }, t("Google place")) : s.placeSource === "custom" ? h("span", { class: "tag" }, t("Pinned spot")) : s.placeSource === "demo" ? h("span", { class: "tag tag-demo" }, t("Demo place")) : !located(s) ? h("span", { class: "muted small" }, t("No place")) : h("span", { class: "tag tag-demo" }, t("Approximate location")),
            ),
            s.note && h("p", { class: "muted small" }, s.note),
          ),
          h("button", { class: "btn btn-ghost btn-quiet btn-sm pv-inspect", type: "button", onclick: () => inspect(s) }, t("Inspect")),
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
      center: it.ref,
      fitKey: `day${S.day}`,
      selectedPlaceId: null,
    });
  }

  function select(sid, scroll) {
    S.selected = sid;
    render();
    const s = it.stops.find((x) => x.id === sid);
    if (s && located(s)) map.focus(s);
    if (scroll) stopsBox.querySelector(`[data-id="${sid}"]`)?.scrollIntoView({ block: "center", behavior: "smooth" });
  }

  function inspect(s) {
    S.selected = s.id;
    render();
    placeDialog({ placeId: s.placeId, name: s.title, lat: s.lat, lng: s.lng, source: s.placeId ? "google" : "curated", note: s.note, query: s.placeQuery }, ctx);
  }

  function copyDialog() {
    if (!ctx.me) return navigate(`/login?next=${encodeURIComponent(`/itineraries/${it.id}`)}`);
    const d = new Date(Date.now() + 14 * 86_400_000);
    if (it.categories.includes("weekend")) d.setUTCDate(d.getUTCDate() + ((6 - d.getUTCDay() + 7) % 7));
    const error = h("p", { class: "form-error", role: "alert", hidden: true });
    const form = h(
      "form",
      { method: "dialog", class: "stack" },
      h("h2", {}, shared ? t("Use This Template") : t("Plan this trip")),
      h("p", { class: "muted" }, t("Wayline will create a new private trip with {stops} over {days}, owned by you. You can change anything afterwards and invite others{rest}.", { stops: tn(it.stopCount, "{n} stop", "{n} stops"), days: tn(it.days, "{n} day", "{n} days"), rest: shared ? t("; {name}'s trip isn't affected", { name: it.author.displayName }) : "" })),
      h("label", { class: "field" }, h("span", {}, t("First day")), h("input", { name: "startDate", type: "date", required: true, value: d.toISOString().slice(0, 10) })),
      error,
      h("div", { class: "dialog-actions" }, h("button", { class: "btn btn-ghost", type: "button", onclick: () => dialog.close() }, t("Cancel")), h("button", { class: "btn btn-primary", type: "submit" }, t("Create trip"))),
    );
    const dialog = openDialog(h("dialog", { class: "dialog" }, form));
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      try {
        const trip = await api(`/api/itineraries/${it.id}/copy`, { method: "POST", body: { startDate: form.startDate.value } });
        dialog.close();
        toast(t("Created \"{title}\".", { title: trip.title }));
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
    const mine = it.myReview;
    const canReview = ctx.me && !it.mine && it.status === "published";
    const form = canReview ? reviewForm(mine) : null;
    fill(
      reviewsBox,
      h("h2", { id: "pv-reviews-h" }, t("Reviews")),
      h("p", { class: "pv-rating" }, ratingText(it.rating)),
      !ctx.me && h("p", { class: "small muted" }, h("a", { href: `/login?next=${encodeURIComponent(`/itineraries/${it.id}`)}`, "data-link": true }, t("Sign in")), t(" to rate this trip.")),
      it.mine && h("p", { class: "small muted" }, t("This is your trip, so you can't review it.")),
      form,
      h(
        "ul",
        { class: "review-list" },
        it.reviews.length
          ? it.reviews.map((r) =>
              h(
                "li",
                { class: "review", "data-review": r.id },
                h("p", {}, h("span", { class: "stars", "aria-label": t("{n} out of 5", { n: r.rating }) }, "★".repeat(r.rating) + "☆".repeat(5 - r.rating)), " ", h("strong", {}, r.author.displayName), r.mine && t(" (you)"), h("span", { class: "muted small" }, ` · ${new Date(r.updatedAt).toLocaleDateString(dateLocale())}`)),
                r.comment && h("p", { class: "review-text" }, r.comment),
              ),
            )
          : h("li", { class: "muted small" }, t("No reviews yet.")),
      ),
    );
  }

  function reviewForm(mine) {
    const error = h("p", { class: "form-error", role: "alert", hidden: true });
    const stars = h(
      "div",
      { class: "star-pick", role: "radiogroup", "aria-label": t("Rating") },
      [1, 2, 3, 4, 5].map((n) => h("label", { class: "star-opt" }, h("input", { type: "radio", name: "rating", value: String(n), required: true, checked: mine?.rating === n }), h("span", {}, `${n}★`))),
    );
    const form = h(
      "form",
      { class: "stack review-form", "data-pv": "review-form" },
      h("h3", {}, mine ? t("Your review") : t("Write a Review")),
      stars,
      h("label", { class: "field" }, h("span", {}, t("Comment (optional)")), h("textarea", { name: "comment", maxlength: 1000, rows: 3 }, mine?.comment ?? "")),
      error,
      h(
        "div",
        { class: "row-actions" },
        h("button", { class: "btn btn-primary btn-sm", type: "submit" }, mine ? t("Update review") : t("Post review")),
        mine && h("button", { class: "btn btn-ghost btn-sm btn-danger-text", type: "button", "data-pv": "delete-review", onclick: remove }, t("Delete review")),
      ),
    );
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      try {
        const res = await api(`/api/itineraries/${it.id}/reviews`, { method: "PUT", body: { rating: Number(form.rating.value), comment: form.comment.value } });
        Object.assign(it, res);
        toast(mine ? t("Review updated.") : t("Thanks for your review."));
        render();
      } catch (err) {
        error.textContent = err.message;
        error.hidden = false;
      }
    });
    async function remove() {
      if (!confirm(t("Delete your review?"))) return;
      try {
        Object.assign(it, await api(`/api/itineraries/${it.id}/reviews/${mine.id}`, { method: "DELETE" }));
        toast(t("Review deleted."));
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
    for (const el of panel.querySelectorAll(".pv-rating")) el.textContent = ratingText(it.rating);
  }
  render();
  return () => map.destroy();
}

const ratingText = (r) => (r.count ? tn(r.count, "Rating: {avg} / 5 · {n} review", "Rating: {avg} / 5 · {n} reviews", { avg: r.average.toFixed(1) }) : t("No ratings yet"));
