import { itineraryCard } from "/home.js";
import { api, h, icon, km } from "/ui.js";

// Trip discovery, map-first. The homepage map holds one shared selection:
// the destination, the places saved from the map ("my picks"), and the
// optional food and length. This module keeps that selection for the tab,
// asks the server (POST /api/itineraries/match) to rank Wayline's own
// curated itineraries against it, and explains each result from the plan's
// own stops: partial matches say what's missing, nothing is generated to
// fill a gap, and no model is called (every input is structured).

export const FOOD = [
  ["local", "Local cuisine"],
  ["market", "Food markets"],
  ["street", "Street food"],
  ["cafe", "Cafés & desserts"],
  ["seafood", "Seafood"],
];
const FOOD_LABEL = Object.fromEntries(FOOD);
export const LENGTHS = [
  [1, "1 day"],
  [2, "2 days"],
  [3, "3 days"],
  [4, "4–5 days"],
];
const lengthLabel = (n) => (n >= 4 ? "4–5 days" : n === 1 ? "1 day" : `${n} days`);
const KEY = "wayline.discover"; // this tab's picks, preferences, last question and the plan it opened
export const MAX_PICKS = 8;

const session = {
  get() {
    try {
      return JSON.parse(sessionStorage.getItem(KEY) ?? "null");
    } catch {
      return null;
    }
  },
  set(v) {
    try {
      sessionStorage.setItem(KEY, JSON.stringify(v));
    } catch {}
  },
};

// the preview page's way back, when it was opened from these results
export const discoveryBack = (id) => (session.get()?.opened === id ? "/#near" : null);

// The shared selection. Places are things the visitor is interested in,
// not a plan: no times, no order, no routes. Saved per tab, and tied to
// the destination they were picked around.
export function createPicks() {
  const saved = session.get();
  const P = {
    near: saved?.near ?? null, // { lat, lng } the picks were made around
    places: saved?.places ?? [], // { placeId, label, lat, lng, category, source }
    food: saved?.food ?? [],
    days: saved?.days ?? null,
    asked: saved?.asked ?? false, // the last "Find journeys" is showing
    opened: saved?.opened ?? null,
  };
  const listeners = new Set();
  const save = () => session.set({ near: P.near, places: P.places, food: P.food, days: P.days, asked: P.asked, opened: P.opened });
  const changed = () => {
    save();
    for (const f of listeners) f();
  };
  return {
    get state() {
      return P;
    },
    has: (placeId) => P.places.some((p) => p.placeId === placeId),
    add(p) {
      if (P.places.length >= MAX_PICKS || P.places.some((x) => x.placeId === p.placeId)) return false;
      P.places = [...P.places, { placeId: p.placeId, label: p.name ?? p.label, lat: p.lat, lng: p.lng, category: p.category ?? null, source: p.source ?? null }];
      changed();
      return true;
    },
    remove(placeId) {
      P.places = P.places.filter((p) => p.placeId !== placeId);
      changed();
    },
    toggleFood(k) {
      P.food = P.food.includes(k) ? P.food.filter((f) => f !== k) : [...P.food, k];
      changed();
    },
    setDays(n) {
      P.days = P.days === n ? null : n;
      changed();
    },
    // loosen a choice (the empty state's buttons): { places: [] }, { food: [] }, { days: null }
    set(patch) {
      Object.assign(P, patch);
      changed();
    },
    // a new destination: picks made around another place don't carry over
    // (a place more than 150 km away couldn't match its plans anyway)
    moveTo(origin) {
      if (!origin) return;
      const far = P.near && kmApart(P.near, origin) > 150;
      P.near = { lat: origin.lat, lng: origin.lng };
      if (far) {
        P.places = [];
        P.asked = false;
      }
      changed();
    },
    setAsked(v) {
      P.asked = v;
      save();
    },
    opened(id) {
      P.opened = id;
      save();
    },
    reset() {
      P.places = [];
      P.food = [];
      P.days = null;
      P.asked = false;
      changed();
    },
    onChange(f) {
      listeners.add(f);
      return () => listeners.delete(f);
    },
  };
}

const kmApart = (a, b) => {
  const rad = Math.PI / 180;
  const x = Math.sin(((b.lat - a.lat) * rad) / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(((b.lng - a.lng) * rad) / 2) ** 2;
  return 12742 * Math.asin(Math.sqrt(x));
};

// Runs the match for the current selection and destination, and renders
// the answer into `into` (curated cards with why each is there).
export async function findJourneys(ctx, picks, origin, into, { onRelax } = {}) {
  const P = picks.state;
  const asked = { where: origin?.source === "location" ? "near you" : origin?.label ? `in ${origin.label}` : "there", city: origin?.source === "location" ? null : origin?.label ?? null, places: [...P.places], food: [...P.food], days: P.days };
  picks.setAsked(true);
  const r = await api("/api/itineraries/match", {
    method: "POST",
    body: { origin: origin ? { lat: origin.lat, lng: origin.lng } : null, places: P.places.map(({ lat, lng, placeId, source }) => ({ lat, lng, placeId: source === "google" ? placeId : null })), food: P.food, days: P.days },
  });
  into.replaceChildren(...resultsView(ctx, picks, r, asked, onRelax));
  return r;
}

function resultsView(ctx, picks, { inArea, results: list }, asked, onRelax) {
  const wishes = asked.places.length > 0 || asked.food.length > 0 || asked.days !== null;
  if (!list.length) return [emptyState(ctx, picks, inArea, asked, onRelax)];
  const full = list.filter((t) => t.match.complete).length;
  const lead = !wishes
    ? `Every ready-made plan ${asked.where}: ${list.length}.`
    : full === list.length
      ? `${list.length} ${list.length === 1 ? "plan matches" : "plans match"} everything you picked.`
      : full
        ? `${full} of ${list.length} plans match everything you picked; the others match part of it.`
        : `No plan ${asked.where} has everything you picked. ${list.length === 1 ? "This one has" : `These ${list.length} have`} some of it.`;
  return [
    h("p", { class: "dx-results-lead" }, lead),
    h("div", { class: "it-grid dx-grid" }, list.map((t) => resultCard(ctx, picks, t, asked, wishes))),
  ];
}

// a curated card, plus why it's here, said only from the plan's own stops
function resultCard(ctx, picks, t, asked, wishes) {
  const card = itineraryCard(t, ctx);
  card.addEventListener("click", (e) => {
    if (e.target.closest("a, button")) picks.opened(t.id);
  }, true);
  if (!wishes) return card;
  const m = t.match;
  const lines = [];
  if (m.places.length) lines.push(h("li", { class: "dx-yes" }, `Includes ${listOf(m.places.map((p) => `${p.stop}${t.days > 1 ? ` (day ${p.day})` : ""}`))}.`));
  for (const x of m.missing) {
    const name = asked.places[x.want]?.label ?? "a place you picked";
    lines.push(h("li", { class: "dx-no" }, Number.isFinite(x.nearestKm) ? `Doesn’t go to ${name}; its nearest stop is ${km(x.nearestKm)} away.` : `Doesn’t go to ${name}.`));
  }
  for (const f of m.food) lines.push(h("li", { class: "dx-yes" }, `${FOOD_LABEL[f.style]}: ${listOf(f.stops)}.`));
  if (asked.food.length && !m.food.length) lines.push(h("li", { class: "dx-no" }, `No stop marked for ${listOf(asked.food.map((f) => FOOD_LABEL[f].toLowerCase()), "or")}.`));
  if (m.duration) {
    const d = m.duration;
    lines.push(
      h(
        "li",
        { class: d.fit === "exact" ? "dx-yes" : "dx-no" },
        d.fit === "exact" ? `${lengthLabel(t.days)}, as you asked.` : d.fit === "shorter" ? `${lengthLabel(t.days)}, shorter than the ${lengthLabel(d.want)} you asked for: room to add your own.` : `${lengthLabel(t.days)}, longer than the ${lengthLabel(d.want)} you asked for.`,
      ),
    );
  }
  const why = h("div", { class: "dx-why" }, h("p", { class: `dx-fit${m.complete ? " dx-fit-full" : ""}` }, m.complete ? "Matches what you picked" : "Partial match"), h("ul", {}, lines));
  card.querySelector(".it-body").insertBefore(why, card.querySelector(".it-foot"));
  return card;
}

// No plan fits: loosen one choice, or start a trip there yourself (the
// editor's own tools, including Plan with AI for a day, take it from
// there). Nothing is generated here.
function emptyState(ctx, picks, inArea, asked, onRelax) {
  const relax = [];
  const again = () => onRelax?.();
  if (asked.places.length) relax.push(["Without my places", () => { picks.set({ places: [] }); again(); }]);
  if (asked.food.length) relax.push(["Any food", () => { picks.set({ food: [] }); again(); }]);
  if (asked.days !== null) relax.push(["Any length", () => { picks.set({ days: null }); again(); }]);
  return h(
    "div",
    { class: "dx-empty" },
    inArea === 0
      ? [h("p", { class: "dx-empty-title" }, `Wayline doesn’t have ready-made plans ${asked.where} yet.`), h("p", { class: "muted" }, "Start your own trip there and add the places yourself, or pick one of the cities under Explore ready-made trips.")]
      : [
          h("p", { class: "dx-empty-title" }, `None of the ${inArea} ${inArea === 1 ? "plan" : "plans"} ${asked.where} ${asked.places.length ? "go to the places you picked" : "match that"}.`),
          h("p", { class: "muted" }, "Loosen one choice, or start your own trip and add them yourself."),
        ],
    h(
      "div",
      { class: "dx-empty-actions" },
      relax.map(([label, go]) => h("button", { type: "button", class: "btn btn-ghost btn-sm", onclick: go }, label)),
      h("button", { type: "button", class: "btn btn-outline btn-sm", onclick: () => ctx.createTrip(asked.city ?? "") }, icon("plus"), "Start my own trip"),
    ),
  );
}

function listOf(items, joiner = "and") {
  if (items.length <= 1) return items.join("");
  return `${items.slice(0, -1).join(", ")} ${joiner} ${items[items.length - 1]}`;
}
