import { itineraryCard } from "/home.js";
import { api, fill, h, icon, km, uid } from "/ui.js";

// Trip discovery: a short questionnaire over Wayline's own curated
// itineraries. The visitor names a city, a few places, the kind of food and
// a length; the server (POST /api/itineraries/match) keeps the plans for that
// city and ranks them. Every reason shown is read from the plan's stops:
// partial matches say what's missing, and nothing is generated to fill a gap.
// Optional: the cards below it work without it.

const FOOD = [
  ["local", "Local cuisine"],
  ["market", "Food markets"],
  ["street", "Street food"],
  ["cafe", "Cafés & desserts"],
  ["seafood", "Seafood"],
];
const FOOD_LABEL = Object.fromEntries(FOOD);
const LENGTHS = [
  [1, "1 day"],
  [2, "2 days"],
  [3, "3 days"],
  [4, "4–5 days"],
];
const lengthLabel = (n) => (n >= 4 ? "4–5 days" : n === 1 ? "1 day" : `${n} days`);
const KEY = "wayline.discover"; // this tab's last question and the plan it opened
const MAX_PLACES = 8;

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
export const discoveryBack = (id) => (session.get()?.opened === id ? "/#discover" : null);

// a few well-covered cities to start from; every other one is a search away
const POPULAR = ["Kyoto", "Paris", "Tokyo", "London", "Sydney", "New York"];

export function tripDiscovery(ctx, { cities }) {
  const saved = session.get();
  const S = {
    refine: Boolean(saved?.places?.length || saved?.food?.length || saved?.days), // the optional preferences shown
    city: saved?.city ?? null, // { name, lat, lng }
    places: saved?.places ?? [], // { label, lat, lng, placeId }
    food: saved?.food ?? [],
    days: saved?.days ?? null,
    highlights: [],
    searchSession: null,
    timer: null,
    aborter: null,
    suggestions: [],
    cityMatches: [],
    cityActive: -1,
  };

  const results = h("div", { class: "dx-results", "aria-live": "polite" });

  // --- destination: a search over Wayline's own cities, and a few to start from ---
  const cityInput = h("input", { type: "search", id: "dx-city", class: "dx-input", placeholder: "Search a city, e.g. Kyoto", autocomplete: "off", role: "combobox", "aria-expanded": "false", "aria-controls": "dx-city-list", "aria-autocomplete": "list", maxlength: 60 });
  const cityList = h("ul", { id: "dx-city-list", class: "suggest dx-suggest", role: "listbox", hidden: true });
  const cityField = h("div", { class: "dx-field dx-field-city" }, icon("pin"), cityInput, cityList);
  const popular = h("div", { class: "dx-popular" });

  // --- the optional preferences ---
  const placeInput = h("input", { type: "search", id: "dx-place", class: "dx-input", placeholder: "Search a place, e.g. a temple or a market", autocomplete: "off", role: "combobox", "aria-expanded": "false", "aria-controls": "dx-place-list", "aria-autocomplete": "list", maxlength: 80 });
  const placeList = h("ul", { id: "dx-place-list", class: "suggest dx-suggest", role: "listbox", hidden: true });
  const chosen = h("ul", { class: "dx-picked", "aria-label": "Places you chose" });
  const ideas = h("div", { class: "dx-ideas" });
  const foodRow = h("div", { class: "dx-chips", role: "group", "aria-labelledby": "dx-food-h" });
  const lengthRow = h("div", { class: "dx-chips", role: "group", "aria-labelledby": "dx-days-h" });
  const refineBtn = h("button", { type: "button", class: "dx-refine-toggle", "aria-expanded": "false", "aria-controls": "dx-refine", onclick: () => { S.refine = !S.refine; render(); } });
  const refine = h(
    "div",
    { class: "dx-refine", id: "dx-refine" },
    h("div", { class: "dx-group" }, h("label", { class: "dx-label", for: "dx-place" }, "Places you\u2019d love to see"), h("div", { class: "dx-field" }, icon("search"), placeInput, placeList), chosen, ideas),
    h(
      "div",
      { class: "dx-pair" },
      h("div", { class: "dx-group" }, h("p", { class: "dx-label", id: "dx-days-h" }, "How long"), lengthRow),
      h("div", { class: "dx-group" }, h("p", { class: "dx-label", id: "dx-food-h" }, "How you like to eat"), foodRow),
    ),
  );
  const error = h("p", { class: "form-error", role: "alert", hidden: true });
  const submit = h("button", { type: "submit", class: "btn btn-primary dx-go" }, "Find journeys");
  const resetBtn = h("button", { type: "button", class: "linklike dx-reset", onclick: reset }, "Start over");

  const form = h(
    "form",
    { class: "dx-form", onsubmit: (e) => { e.preventDefault(); find(); } },
    h("div", { class: "dx-group" }, h("label", { class: "dx-label dx-label-main", for: "dx-city" }, "Where would you like to go?"), cityField, popular),
    h("div", { class: "dx-more" }, refineBtn, refine),
    h("div", { class: "dx-actions" }, submit, resetBtn, error),
  );

  const el = h(
    "section",
    { class: "dx", id: "discover", "aria-labelledby": "dx-h" },
    h(
      "div",
      { class: "dx-panel" },
      h(
        "div",
        { class: "dx-intro" },
        h("p", { class: "dx-kicker" }, "Personal picks"),
        h("h3", { id: "dx-h", class: "dx-title" }, "Find a journey that fits"),
        h("p", { class: "dx-lede" }, "Start with a city. Add a few places, a length or the food you like, and we\u2019ll match the ready-made plans that already go there."),
        h("p", { class: "dx-aside" }, "Matched from Wayline\u2019s own itineraries, never generated."),
      ),
      form,
    ),
    results,
  );

  const chip = (on, label, onclick, extra = {}) => h("button", { type: "button", class: `dx-chip${on ? " on" : ""}`, "aria-pressed": String(on), onclick, ...extra }, label);

  function render() {
    if (document.activeElement !== cityInput) cityInput.value = S.city?.name ?? "";
    cityField.classList.toggle("is-set", Boolean(S.city));
    const known = cities();
    popular.replaceChildren(
      ...(known.length
        ? [h("span", { class: "dx-popular-label" }, "Popular"), ...POPULAR.map((n) => known.find((c) => c.name === n)).filter(Boolean).map((c) => chip(S.city?.name === c.name, c.name, () => setCity(S.city?.name === c.name ? null : { name: c.name, lat: c.lat, lng: c.lng }), { "data-city": c.name }))]
        : []),
    );
    // the preferences: optional, folded away until asked for (open once any is set)
    const set = S.places.length + S.food.length + (S.days !== null ? 1 : 0);
    refine.hidden = !S.refine;
    refineBtn.setAttribute("aria-expanded", String(S.refine));
    fill(refineBtn, h("span", { class: "dx-refine-sign", "aria-hidden": "true" }, S.refine ? "\u2212" : "+"), h("span", { class: "dx-refine-text" }, "Refine with places, length and food"), set > 0 && h("span", { class: "dx-count" }, `${set} chosen`), !S.refine && h("span", { class: "dx-optional" }, "optional"));
    resetBtn.hidden = !S.city && set === 0;
    chosen.replaceChildren(
      ...S.places.map((p, i) =>
        h("li", { class: "dx-place" }, h("span", {}, p.label), h("button", { type: "button", class: "dx-remove", "aria-label": `Remove ${p.label}`, onclick: () => { S.places.splice(i, 1); render(); } }, "\u00d7")),
      ),
    );
    const left = S.highlights.filter((x) => !S.places.some((p) => p.label === x.title));
    fill(
      ideas,
      S.city && left.length
        ? h("div", {}, h("p", { class: "dx-ideas-title" }, `From Wayline\u2019s ${S.city.name} plans`), h("div", { class: "dx-chips" }, left.slice(0, 8).map((x) => chip(false, x.title, () => addPlace({ label: x.title, lat: x.lat, lng: x.lng, placeId: null }), { class: "dx-chip dx-idea", "aria-pressed": null }))))
        : !S.city && h("p", { class: "dx-note" }, "Choose a city to see the places its plans visit."),
      ctx.config.places !== "google" && S.city && h("p", { class: "dx-note" }, "Searching any place needs Google Maps on the server; the places above are always there."),
    );
    placeInput.disabled = S.places.length >= MAX_PLACES;
    // nothing chosen means any: no separate "any" button to keep in step
    lengthRow.replaceChildren(...LENGTHS.map(([n, label]) => chip(S.days === n, label, () => { S.days = S.days === n ? null : n; render(); })));
    foodRow.replaceChildren(...FOOD.map(([k, label]) => chip(S.food.includes(k), label, () => { S.food = S.food.includes(k) ? S.food.filter((f) => f !== k) : [...S.food, k]; render(); })));
  }

  // --- city search: Wayline's own destinations, no Google request ---
  cityInput.addEventListener("input", () => {
    const q = cityInput.value.trim().toLowerCase();
    if (S.city && cityInput.value !== S.city.name) {
      S.city = null;
      S.highlights = [];
      render();
    }
    // names that start with what's typed first, then any that contain it
    const starts = (c) => (c.name.toLowerCase().startsWith(q) ? 0 : 1);
    S.cityMatches = q ? cities().filter((c) => `${c.name} ${c.country}`.toLowerCase().includes(q)).sort((a, b) => starts(a) - starts(b)).slice(0, 6) : [];
    S.cityActive = S.cityMatches.length ? 0 : -1;
    renderCityList(q);
  });
  cityInput.addEventListener("keydown", (e) => {
    if (cityList.hidden) return;
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      S.cityActive = (S.cityActive + (e.key === "ArrowDown" ? 1 : -1) + S.cityMatches.length) % S.cityMatches.length;
      renderCityList(cityInput.value.trim());
    } else if (e.key === "Enter" && S.cityMatches.length) {
      e.preventDefault();
      pickCity(S.cityMatches[Math.max(0, S.cityActive)]);
    } else if (e.key === "Escape") closeCityList();
  });
  cityInput.addEventListener("blur", () => setTimeout(() => { closeCityList(); render(); }, 150));

  function renderCityList(q) {
    if (!q) return closeCityList();
    cityList.hidden = false;
    cityInput.setAttribute("aria-expanded", "true");
    cityList.replaceChildren(
      ...(S.cityMatches.length
        ? S.cityMatches.map((c, i) => h("li", { role: "option", id: `dx-city-${i}`, class: i === S.cityActive ? "on" : "", "aria-selected": String(i === S.cityActive), onmousedown: (e) => { e.preventDefault(); pickCity(c); } }, h("strong", {}, c.name), h("span", {}, c.country)))
        : [h("li", { class: "suggest-empty" }, "Wayline has no ready-made plans there yet.")]),
    );
    if (S.cityActive >= 0) cityInput.setAttribute("aria-activedescendant", `dx-city-${S.cityActive}`);
  }

  function closeCityList() {
    cityList.hidden = true;
    cityInput.setAttribute("aria-expanded", "false");
    cityInput.removeAttribute("aria-activedescendant");
  }

  function pickCity(c) {
    closeCityList();
    cityInput.value = c.name; // render() leaves a focused field alone
    cityInput.blur();
    setCity({ name: c.name, lat: c.lat, lng: c.lng });
  }

  async function setCity(c) {
    S.city = c;
    S.highlights = [];
    render();
    if (!c) return;
    try {
      const { places } = await api(`/api/itineraries/highlights?lat=${c.lat}&lng=${c.lng}`);
      if (S.city?.name !== c.name) return;
      S.highlights = places;
      render();
    } catch {}
  }

  function addPlace(p) {
    if (S.places.length >= MAX_PLACES || S.places.some((x) => x.label === p.label)) return;
    S.places.push(p);
    render();
  }

  // --- place search: the same Google autocomplete as the editor, biased to the city ---
  placeInput.addEventListener("input", () => {
    clearTimeout(S.timer);
    const q = placeInput.value.trim();
    if (q.length < 2 || ctx.config.places !== "google") return closeList();
    S.searchSession ??= uid();
    S.timer = setTimeout(() => suggest(q), 300);
  });
  placeInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !placeList.hidden && S.suggestions.length) {
      e.preventDefault();
      pick(0);
    } else if (e.key === "Escape") closeList();
  });
  placeInput.addEventListener("blur", () => setTimeout(closeList, 150));

  async function suggest(q) {
    S.aborter?.abort();
    S.aborter = new AbortController();
    const bias = S.city ? `&lat=${S.city.lat}&lng=${S.city.lng}` : "";
    try {
      const res = await fetch(`/api/places/autocomplete?q=${encodeURIComponent(q)}&kind=place&session=${S.searchSession}${bias}`, { signal: S.aborter.signal });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      S.suggestions = data.suggestions;
      placeList.hidden = false;
      placeInput.setAttribute("aria-expanded", "true");
      placeList.replaceChildren(
        ...(S.suggestions.length
          ? S.suggestions.map((s, i) => h("li", { role: "option", onmousedown: (e) => { e.preventDefault(); pick(i); } }, h("strong", {}, s.main), s.secondary && h("span", {}, s.secondary)))
          : [h("li", { class: "suggest-empty" }, "No matching places.")]),
        h("li", { class: "suggest-foot attrib", translate: "no" }, "Google Maps"),
      );
    } catch (err) {
      if (err.name !== "AbortError") closeList();
    }
  }

  function closeList() {
    placeList.hidden = true;
    placeInput.setAttribute("aria-expanded", "false");
  }

  async function pick(i) {
    const s = S.suggestions[i];
    if (!s) return;
    closeList();
    try {
      const p = await api(`/api/places/${encodeURIComponent(s.placeId)}?view=basic&session=${S.searchSession}`);
      S.searchSession = null;
      placeInput.value = "";
      addPlace({ label: s.main, lat: p.lat, lng: p.lng, placeId: p.placeId });
    } catch (err) {
      error.textContent = err.message;
      error.hidden = false;
    }
  }

  // --- matching ---
  let seq = 0;
  async function find({ scroll = true } = {}) {
    error.hidden = true;
    if (!S.city && !S.places.length) {
      error.textContent = "Choose a destination first.";
      error.hidden = false;
      return;
    }
    const mine = ++seq;
    const asked = { city: S.city, places: [...S.places], food: [...S.food], days: S.days };
    session.set({ ...asked, asked: true });
    submit.disabled = true;
    results.replaceChildren(h("p", { class: "muted" }, "Looking through Wayline’s plans…"));
    try {
      const r = await api("/api/itineraries/match", {
        method: "POST",
        body: { origin: S.city ? { lat: S.city.lat, lng: S.city.lng } : null, places: S.places.map(({ lat, lng, placeId }) => ({ lat, lng, placeId })), food: S.food, days: S.days },
      });
      if (mine !== seq) return;
      showResults(r, asked);
      if (scroll) results.scrollIntoView({ behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "start" });
    } catch (err) {
      if (mine === seq) results.replaceChildren(h("p", { class: "form-error" }, err.message));
    } finally {
      submit.disabled = false;
    }
  }

  function showResults({ inArea, results: list }, asked) {
    const where = asked.city?.name ?? "those places";
    const wishes = asked.places.length > 0 || asked.food.length > 0 || asked.days !== null;
    if (!list.length) return results.replaceChildren(emptyState(inArea, asked, where));
    const full = list.filter((t) => t.match.complete).length;
    const lead = !wishes
      ? `Every ready-made plan for ${where}: ${list.length}.`
      : full === list.length
        ? `${list.length} ${list.length === 1 ? "plan matches" : "plans match"} everything you asked for.`
        : full
          ? `${full} of ${list.length} plans match everything you asked for; the others match part of it.`
          : `No plan for ${where} has everything you asked for. ${list.length === 1 ? "This one has" : `These ${list.length} have`} some of it.`;
    results.replaceChildren(
      h("div", { class: "dx-results-head" }, h("p", { class: "dx-results-lead" }, lead), h("p", { class: "dx-results-note" }, "Open one to preview it, then make it your own trip.")),
      h("div", { class: "it-grid dx-grid" }, list.map((t) => resultCard(t, asked, wishes))),
    );
  }

  // a curated card, plus why it's here, said only from the plan's own stops
  function resultCard(t, asked, wishes) {
    const card = itineraryCard(t, ctx);
    card.addEventListener("click", (e) => {
      if (e.target.closest("a, button")) session.set({ ...session.get(), opened: t.id });
    }, true);
    if (!wishes) return card;
    const m = t.match;
    const lines = [];
    if (m.places.length) lines.push(h("li", { class: "dx-yes" }, `Includes ${listOf(m.places.map((p) => `${p.stop}${t.days > 1 ? ` (day ${p.day})` : ""}`))}.`));
    for (const x of m.missing) {
      const name = asked.places[x.want]?.label ?? "a place you chose";
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
    const why = h("div", { class: "dx-why" }, h("p", { class: `dx-fit${m.complete ? " dx-fit-full" : ""}` }, m.complete ? "Matches what you asked" : "Partial match"), h("ul", {}, lines));
    card.querySelector(".it-body").insertBefore(why, card.querySelector(".it-foot"));
    return card;
  }

  function emptyState(inArea, asked, where) {
    const relax = [];
    if (asked.places.length) relax.push(["Without the places", () => { S.places = []; render(); find({ scroll: false }); }]);
    if (asked.food.length) relax.push(["Any food", () => { S.food = []; render(); find({ scroll: false }); }]);
    if (asked.days !== null) relax.push(["Any length", () => { S.days = null; render(); find({ scroll: false }); }]);
    return h(
      "div",
      { class: "dx-empty" },
      inArea === 0
        ? [h("p", { class: "dx-empty-title" }, `Wayline doesn’t have ready-made plans for ${where} yet.`), h("p", { class: "muted" }, "Try one of the popular cities above, or start your own trip there and add the places yourself.")]
        : [
            h("p", { class: "dx-empty-title" }, `None of the ${inArea} ${inArea === 1 ? "plan" : "plans"} for ${where} ${asked.places.length ? "go to those places" : "match that"}.`),
            h("p", { class: "muted" }, "Loosen one of your choices, or start your own trip and add them yourself."),
          ],
      h(
        "div",
        { class: "dx-empty-actions" },
        relax.map(([label, go]) => h("button", { type: "button", class: "btn btn-ghost btn-sm", onclick: go }, label)),
        h("button", { type: "button", class: "btn btn-outline btn-sm", onclick: () => ctx.createTrip(asked.city?.name ?? "") }, icon("plus"), "Start my own trip"),
      ),
    );
  }

  function reset() {
    S.city = null;
    S.places = [];
    S.food = [];
    S.days = null;
    S.highlights = [];
    session.set(null);
    results.replaceChildren();
    error.hidden = true;
    render();
  }

  // the homepage's destination list arrives after this is built
  function refresh() {
    render();
    if (S.city && !S.highlights.length) setCity(S.city);
  }

  render();
  if (saved?.asked && (S.city || S.places.length)) find({ scroll: false });

  return {
    el,
    refresh,
    destroy() {
      clearTimeout(S.timer);
      S.aborter?.abort();
    },
  };
}

function listOf(items, joiner = "and") {
  if (items.length <= 1) return items.join("");
  return `${items.slice(0, -1).join(", ")} ${joiner} ${items[items.length - 1]}`;
}
