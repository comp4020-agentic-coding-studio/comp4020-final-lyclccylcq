import { createMap } from "/map.js";
import { coverImg, photoFor } from "/photos.js";
import { api, dur, h, hhmm, icon, KIND_LABEL, toast } from "/ui.js";

// A published journey (/journeys/pub-…): the read-only page people share.
// Everything on it is read from the publication's snapshot, as the owner
// last published it (src/publications.ts): never the working trip, never
// its notes or members, nothing invented to fill a gap. Anyone with the
// link can read it, signed in or not; nobody can edit it here.

const MEAL_LABEL = { breakfast: "Breakfast", brunch: "Brunch", lunch: "Lunch", afternoon_tea: "Afternoon tea", dinner: "Dinner" };

export async function renderJourney(app, id, ctx) {
  const { config, me } = ctx;
  app.replaceChildren(ctx.topbar(""), h("main", { class: "journey" }, h("div", { class: "boot", role: "status" }, "Opening the journey…")), ctx.footer());
  let t;
  try {
    t = await api(`/api/itineraries/${encodeURIComponent(id)}`);
  } catch {
    app.querySelector("main").replaceChildren(
      h("div", { class: "invite-card" }, h("h1", {}, "This journey isn't available"), h("p", {}, "It may have been unpublished by its author, or the link is incomplete."), h("a", { class: "btn btn-primary", href: "/", "data-link": true }, "Explore Wayline")),
    );
    return () => {};
  }

  const days = [...new Set(t.stops.map((s) => s.day))].sort((a, b) => a - b);
  const located = (s) => typeof s.lat === "number" && typeof s.lng === "number";
  const photo = photoFor(t.cover);
  const length = t.days > 1 ? `${t.days} days` : "One day";
  const published = new Date(t.publishedAt).toLocaleDateString("en-AU", { day: "numeric", month: "long", year: "numeric" });
  const mapHost = h("div", { class: "map-host" });

  const main = h(
    "main",
    { class: "journey" },
    t.mine && ownerBar(t),
    h(
      "header",
      { class: `jy-cover${photo ? " has-photo" : ""}` },
      photo && coverImg(photo, { eager: true, decorative: true }),
      h(
        "div",
        { class: "jy-cover-text" },
        h("p", { class: "jy-kicker" }, t.destination),
        h("h1", { class: "jy-title" }, t.title),
        h("p", { class: "jy-byline" }, h("span", {}, length), h("span", {}, `${t.stopCount} ${t.stopCount === 1 ? "stop" : "stops"}`), h("span", {}, "By ", h("strong", {}, t.author.displayName))),
      ),
    ),
    h(
      "div",
      { class: "jy-body" },
      h(
        "section",
        { class: "jy-intro" },
        t.description && h("p", { class: "jy-desc" }, t.description),
        h("p", { class: "jy-meta" }, `Published ${published}. A snapshot of the plan as its author shared it; it doesn't change when they keep editing their own trip.`),
        h(
          "div",
          { class: "jy-actions" },
          h("button", { class: "btn btn-ghost btn-sm", type: "button", onclick: copyLink }, icon("share"), "Copy link"),
          t.status === "published" && h("a", { class: "btn btn-ghost btn-sm", href: `/itineraries/${t.id}`, "data-link": true }, icon("plus"), "Make it my own trip"),
          h("button", { class: "btn btn-quiet btn-sm", type: "button", onclick: () => print() }, "Print"),
        ),
      ),
      h("section", { class: "jy-map", "aria-label": "Map of the journey" }, mapHost),
      h(
        "section",
        { class: "jy-days", "aria-label": "Day by day" },
        days.map((d) => {
          const stops = t.stops.filter((s) => s.day === d);
          return h(
            "article",
            { class: "jy-day" },
            h("h2", { class: "jy-day-h" }, h("span", { class: "jy-day-n" }, String(d).padStart(2, "0")), days.length > 1 ? `Day ${d}` : "The day"),
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
                      [s.role === "start" ? "Starting point" : s.meal ? MEAL_LABEL[s.meal] : KIND_LABEL[s.kind], s.role !== "start" && s.durationMin ? dur(s.durationMin) : null, !located(s) && "Location not shared"].filter(Boolean).join(" · "),
                    ),
                  ),
                ),
              ),
            ),
          );
        }),
      ),
      h("p", { class: "jy-foot" }, "Planned together on Wayline. ", !me && h("a", { href: "/login?next=/", "data-link": true }, "Plan your own journey"), me && h("a", { href: "/", "data-link": true }, "Plan your next journey")),
    ),
  );
  app.replaceChildren(ctx.topbar(""), main, ctx.footer());

  // the overview: the stops in order, as the snapshot has them (no route
  // lines: the snapshot keeps no travel times, and none are made up)
  const map = await createMap(mapHost, { config, onSelectStop: () => {}, onSelectResult: () => {} });
  map.update({
    stops: t.stops.filter(located).map((s) => ({ id: s.id, title: s.title, kind: s.kind, lat: s.lat, lng: s.lng, start: s.role === "start", selected: false, day: s.day })),
    results: [],
    center: t.ref ?? null,
    fitKey: t.id,
  });

  async function copyLink() {
    const url = `${location.origin}/journeys/${t.id}`;
    try {
      await navigator.clipboard.writeText(url);
      toast("Link copied. Anyone with it can read this journey; nobody can edit it.");
    } catch {
      prompt("Copy this link:", url);
    }
  }

  return () => map.destroy();
}

// For the author: where this page stands, and the way to manage it
function ownerBar(t) {
  return h(
    "div",
    { class: "jy-owner", role: "note" },
    h(
      "p",
      {},
      t.status !== "published"
        ? h("strong", {}, "Unpublished: only you can see this page. ")
        : t.visibility === "link"
          ? "Your journey. Anyone with the link can read it; it isn't listed on Wayline. "
          : "Your journey. It's listed under Shared by travellers. ",
    ),
    h("a", { class: "linklike small", href: "/profile#published", "data-link": true }, "Manage your journeys"),
  );
}
