import { createMap } from "/map.js";
import { coverImg, photoFor } from "/photos.js";
import { locale, t, tn } from "/i18n.js";
import { api, dur, h, hhmm, icon, KIND_LABEL, toast } from "/ui.js";

// A published journey (/journeys/pub-…): the read-only page people share.
// Everything on it is read from the publication's snapshot, as the owner
// last published it (src/publications.ts): never the working trip, never
// its notes or members, nothing invented to fill a gap. Anyone with the
// link can read it, signed in or not; nobody can edit it here.

const MEAL_LABEL = { breakfast: "Breakfast", brunch: "Brunch", lunch: "Lunch", afternoon_tea: "Afternoon tea", dinner: "Dinner" };

export async function renderJourney(app, id, ctx) {
  const { config, me } = ctx;
  // left while loading (app.js route): nothing here touches the page after that
  const live = ctx.page?.live ?? (() => true);
  const boot = h("main", { class: "journey" }, h("div", { class: "boot", role: "status" }, t("Opening the journey…")));
  app.replaceChildren(ctx.topbar(""), boot, ctx.footer());
  let jn;
  try {
    jn = await api(`/api/itineraries/${encodeURIComponent(id)}`);
  } catch {
    if (!live()) return () => {};
    boot.replaceChildren(
      h("div", { class: "invite-card" }, h("h1", {}, t("This journey isn't available")), h("p", {}, t("It may have been unpublished by its author, or the link is incomplete.")), h("a", { class: "btn btn-primary", href: "/", "data-link": true }, t("Explore Wayline"))),
    );
    return () => {};
  }

  if (!live()) return () => {};
  const days = [...new Set(jn.stops.map((s) => s.day))].sort((a, b) => a - b);
  const located = (s) => typeof s.lat === "number" && typeof s.lng === "number";
  const photo = photoFor(jn.cover);
  const length = jn.days > 1 ? t("{n} days", { n: jn.days }) : t("One day");
  const published = new Date(jn.publishedAt).toLocaleDateString(locale(), { day: "numeric", month: "long", year: "numeric" });
  const mapHost = h("div", { class: "map-host" });

  const main = h(
    "main",
    { class: "journey" },
    jn.mine && ownerBar(jn),
    h(
      "header",
      { class: `jy-cover${photo ? " has-photo" : ""}` },
      photo && coverImg(photo, { eager: true, decorative: true }),
      h(
        "div",
        { class: "jy-cover-text" },
        h("p", { class: "jy-kicker" }, jn.destination),
        h("h1", { class: "jy-title" }, jn.title),
        h("p", { class: "jy-byline" }, h("span", {}, length), h("span", {}, tn(jn.stopCount, "{n} stop", "{n} stops")), h("span", {}, t("By "), h("strong", {}, jn.author.displayName))),
      ),
    ),
    h(
      "div",
      { class: "jy-body" },
      h(
        "section",
        { class: "jy-intro" },
        jn.description && h("p", { class: "jy-desc" }, jn.description),
        h("p", { class: "jy-meta" }, t("Published {date}. A snapshot of the plan as its author shared it; it doesn't change when they keep editing their own trip.", { date: published })),
        h(
          "div",
          { class: "jy-actions" },
          h("button", { class: "btn btn-ghost btn-sm", type: "button", onclick: copyLink }, icon("share"), t("Copy link")),
          jn.status === "published" && h("a", { class: "btn btn-ghost btn-sm", href: `/itineraries/${jn.id}`, "data-link": true }, icon("plus"), t("Make it my own trip")),
          h("a", { class: "btn btn-quiet btn-sm", href: `/itineraries/${jn.id}/export`, "data-link": true, "data-jy": "export" }, t("Export")),
        ),
      ),
      h("section", { class: "jy-map", "aria-label": t("Map of the journey") }, mapHost),
      h(
        "section",
        { class: "jy-days", "aria-label": t("Day by day") },
        days.map((d) => {
          const stops = jn.stops.filter((s) => s.day === d);
          return h(
            "article",
            { class: "jy-day" },
            h("h2", { class: "jy-day-h" }, h("span", { class: "jy-day-n" }, String(d).padStart(2, "0")), days.length > 1 ? t("Day {n}", { n: d }) : t("The day")),
            h(
              "ol",
              { class: "jy-stops" },
              stops.map((s) =>
                h(
                  "li",
                  { class: `jy-stop${s.role === "start" ? " jy-stop-start" : ""}` },
                  h("span", { class: "jy-time" }, s.startMin !== null ? hhmm(s.startMin) : ""),
                  h(
                    "div",
                    { class: "jy-stop-body" },
                    h("h3", {}, s.title),
                    h(
                      "p",
                      { class: "jy-stop-meta" },
                      [s.role === "start" ? t("Starting point") : s.meal ? t(MEAL_LABEL[s.meal]) : KIND_LABEL[s.kind], s.role !== "start" && s.durationMin ? dur(s.durationMin) : null, !located(s) && t("Location not shared")].filter(Boolean).join(" · "),
                    ),
                  ),
                ),
              ),
            ),
          );
        }),
      ),
      h("p", { class: "jy-foot" }, t("Planned together on Wayline. "), !me && h("a", { href: "/login?next=/", "data-link": true }, t("Plan your own journey")), me && h("a", { href: "/", "data-link": true }, t("Plan your next journey"))),
    ),
  );
  app.replaceChildren(ctx.topbar(""), main, ctx.footer());

  // the overview: the stops in order, as the snapshot has them (no route
  // lines: the snapshot keeps no travel times, and none are made up)
  const map = await createMap(mapHost, { config, onSelectStop: () => {}, onSelectResult: () => {} });
  if (!live()) {
    map.destroy();
    return () => {};
  }
  map.update({
    stops: jn.stops.filter(located).map((s) => ({ id: s.id, title: s.title, kind: s.kind, lat: s.lat, lng: s.lng, start: s.role === "start", selected: false, day: s.day })),
    results: [],
    center: jn.ref ?? null,
    fitKey: jn.id,
  });

  async function copyLink() {
    const url = `${location.origin}/journeys/${jn.id}`;
    try {
      await navigator.clipboard.writeText(url);
      toast(t("Link copied. Anyone with it can read this journey; nobody can edit it."));
    } catch {
      prompt(t("Copy this link:"), url);
    }
  }

  return () => map.destroy();
}

// For the author: where this page stands, and the way to manage it
function ownerBar(jn) {
  return h(
    "div",
    { class: "jy-owner", role: "note" },
    h(
      "p",
      {},
      jn.status !== "published"
        ? h("strong", {}, t("Unpublished: only you can see this page. "))
        : jn.visibility === "link"
          ? t("Your journey. Anyone with the link can read it; it isn't listed on Wayline. ")
          : t("Your journey. It's listed under Shared by travellers. "),
    ),
    h("a", { class: "linklike small", href: "/profile#published", "data-link": true }, t("Manage your journeys")),
  );
}
