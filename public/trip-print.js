import { coverImg, photoFor } from "/photos.js";
import { api, dur, fmtDay, fmtRange, h, hhmm, icon, KIND_LABEL } from "/ui.js";

// A trip as a printable document (/trips/:id/print), for its members, with
// nothing published: the plan as it is now, day by day, with each stop's
// time, length and notes, and the travel between stops where a route was
// looked up (Google's duration and distance for the chosen mode, marked
// when out of date). Read through the same GET /api/trips/:id as the
// editor, so only members can open it. Printing it, or saving it as a PDF,
// is the browser's own print dialog.

const MEAL_LABEL = { breakfast: "Breakfast", brunch: "Brunch", lunch: "Lunch", afternoon_tea: "Afternoon tea", dinner: "Dinner" };
const MODE_WORD = { WALK: "Walk", TRANSIT: "Public transport", DRIVE: "Drive" };

export async function renderTripPrint(app, tripId, ctx) {
  app.replaceChildren(h("main", { class: "tp" }, h("div", { class: "boot", role: "status" }, "Preparing your trip…")));
  const t = await api(`/api/trips/${tripId}`); // a 404 for non-members, handled by the router
  const cover = photoFor(t.cover ?? null);
  const nDays = t.days.length;
  const printed = new Date().toLocaleString("en-AU", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });

  const travel = (d, a, b) => {
    const seg = d.segments.find((s) => s.fromId === a.id && s.toId === b.id);
    const o = seg?.options.find((x) => x.mode === seg.selectedMode);
    if (!o || o.status !== "ok") return null;
    const transit = (o.steps ?? []).filter((s) => s.kind === "transit");
    return h(
      "li",
      { class: "tp-leg" },
      `${MODE_WORD[o.mode]} · ${dur(Math.max(1, Math.ceil(o.durationSec / 60)))} · ${(o.distanceM / 1000).toFixed(1)} km`,
      o.mode === "TRANSIT" && transit.length ? ` · ${transit.map((s) => [s.vehicle, s.line].filter(Boolean).join(" ")).filter(Boolean).join(", ")}` : "",
      seg.stale && h("span", { class: "tp-stale" }, " (times changed since; look it up again)"),
    );
  };

  const main = h(
    "main",
    { class: "tp" },
    h(
      "div",
      { class: "tp-bar" },
      h("a", { class: "btn btn-quiet btn-sm", href: `/trips/${t.id}`, "data-link": true }, icon("back"), "Back to the trip"),
      h("p", { class: "small muted" }, "Choose ", h("strong", {}, "Save as PDF"), " as the printer to keep a copy."),
      h("button", { class: "btn btn-primary btn-sm", type: "button", "data-print": "go", onclick: () => print() }, "Print or save as PDF"),
    ),
    h(
      "article",
      { class: "tp-doc" },
      h(
        "header",
        { class: "tp-head" },
        cover && h("div", { class: "tp-cover" }, coverImg(cover, { eager: true, decorative: true })),
        h("p", { class: "tp-kicker" }, t.destination),
        h("h1", { class: "tp-title" }, t.title),
        h("p", { class: "tp-sub" }, `${fmtRange(t.startDate, t.endDate)} · ${nDays} ${nDays === 1 ? "day" : "days"} · ${t.members.map((m) => m.displayName).join(", ")}`),
      ),
      t.days.map((d, i) =>
        h(
          "section",
          { class: "tp-day" },
          h("h2", { class: "tp-day-h" }, h("span", { class: "tp-day-n" }, `Day ${i + 1}`), fmtDay(d.date, { weekday: "long", day: "numeric", month: "long" })),
          d.activities.length
            ? h(
                "ol",
                { class: "tp-stops" },
                d.activities.flatMap((a, k) => {
                  const next = d.activities[k + 1];
                  const what = a.role === "start" ? "Starting point" : a.meal ? MEAL_LABEL[a.meal] : KIND_LABEL[a.kind];
                  const end = a.startMin !== null && a.role !== "start" ? a.startMin + a.durationMin : null;
                  return [
                    h(
                      "li",
                      { class: "tp-stop" },
                      h("span", { class: "tp-time" }, a.startMin !== null ? hhmm(a.startMin) : "", end !== null && h("small", {}, `–${hhmm(end)}`)),
                      h(
                        "div",
                        {},
                        h("h3", {}, a.title),
                        h("p", { class: "tp-meta" }, [what, a.role !== "start" && a.durationMin ? dur(a.durationMin) : null, a.place?.source === "demo" && "Demo place", a.place?.source === "custom" && "Pinned spot"].filter(Boolean).join(" · ")),
                        a.notes && h("p", { class: "tp-notes" }, a.notes),
                      ),
                    ),
                    next && travel(d, a, next),
                  ].filter(Boolean);
                }),
              )
            : h("p", { class: "tp-empty" }, "Nothing planned yet."),
        ),
      ),
      h("p", { class: "tp-foot" }, `Planned on Wayline · printed ${printed}. Travel times come from Google Maps, as looked up in the trip; ones never looked up aren't shown.`),
    ),
  );
  app.replaceChildren(main);
  return () => {};
}
