import { createMap } from "/map.js";
import { createVoice } from "/voice.js";
import {
  api,
  avatar,
  dur,
  fill,
  fmtDay,
  fmtRange,
  guessKind,
  h,
  hhmm,
  icon,
  initials,
  KIND_DURATION,
  KIND_LABEL,
  km,
  openDialog,
  parseTime,
  personColour,
  relTime,
  toast,
  uid,
} from "/ui.js";

const MODE_LABEL = { WALK: "Walk", TRANSIT: "Transit", DRIVE: "Drive" };
const MODE_WORD = { WALK: "Walking", TRANSIT: "Transit", DRIVE: "Driving" };
const MEAL_LABEL = { breakfast: "Breakfast", brunch: "Brunch", lunch: "Lunch", afternoon_tea: "Afternoon tea", dinner: "Dinner" };
const MEAL_MINUTES = { breakfast: 45, brunch: 60, lunch: 60, afternoon_tea: 45, dinner: 90 };
const FOOD_TYPES = new Set(["restaurant", "cafe", "bakery", "bar", "meal_takeaway", "coffee_shop", "food_court", "fast_food_restaurant", "tea_house", "brunch_restaurant", "breakfast_restaurant"]);
const MODE_ICON = { WALK: "walk", TRANSIT: "transit", DRIVE: "drive" };

export async function openEditor(root, tripId, ctx) {
  const first = await api(`/api/trips/${tripId}`);
  const S = {
    trip: first,
    dayId: null,
    selectedId: null,
    results: [],
    resultsSource: null,
    place: null,
    placeDetails: null,
    presence: [],
    live: false,
    tab: "plan",
    copilotOpen: false,
    // copilot conversation, per day, local to this tab: dayId -> { turns: [{ q, lang, res | error, ... }] }
    ai: new Map(),
    aiPending: null, // { dayId, question, controller, startedAt }
    aiDraft: "",
    dismissed: new Set(),
    dragging: null,
    editing: null,
    openLegs: new Set(),
    busyLegs: new Set(),
    // a map click: { lat, lng, label, type, results, source, loading, error, cache }
    explore: null,
    // choosing the starting point: { step: "choose" | "map" | "search" | "confirm", candidate, message, locating }
    starting: null,
    hint: false, // "explore the map or search to add your next stop", after a start is set
    confirming: null, // proposal key awaiting "Confirm change"
  };
  let voice = null;
  const params = new URLSearchParams(location.search);
  if (params.has("new")) history.replaceState(history.state, "", location.pathname);
  const startOf = () => S.trip.days.flatMap((d) => d.activities).find((a) => a.role === "start") ?? null;
  if (params.has("new") && !startOf()) S.starting = { step: "choose" };
  S.startBase = startOf()?.version ?? null; // the start as it was when choosing began
  const dayKey = `wayline.day.${tripId}`;
  try {
    S.dayId = localStorage.getItem(dayKey);
  } catch {}
  if (!S.trip.days.some((d) => d.id === S.dayId)) S.dayId = S.trip.days[0]?.id ?? null;

  const me = ctx.me;
  const role = () => S.trip.members.find((m) => m.id === me.id)?.role ?? null;
  const day = () => S.trip.days.find((d) => d.id === S.dayId) ?? S.trip.days[0];
  const memberName = (id) => (id === me.id ? "you" : S.trip.members.find((m) => m.id === id)?.displayName ?? "someone");

  // --- skeleton ---

  const bar = h("header", { class: "trip-bar" });
  const searchInput = h("input", {
    type: "search",
    name: "q",
    placeholder: `Search places in ${S.trip.destination}`,
    "aria-label": "Search for places",
    autocomplete: "off",
    maxlength: 120,
  });
  const searchForm = h("form", { class: "search", role: "search" }, icon("search"), searchInput, h("button", { class: "btn btn-primary btn-sm", type: "submit" }, "Search"));
  const searchPanel = h("div", { class: "search-panel", hidden: true });
  const mapHost = h("div", { class: "map-host" });
  const dayTabs = h("nav", { class: "day-tabs", role: "tablist", "aria-label": "Trip days" });
  const dayHead = h("div", { class: "day-head" });
  const timeline = h("ol", { class: "timeline", "aria-label": "Itinerary for the selected day" });
  const planFoot = h(
    "div",
    { class: "plan-foot" },
    h("button", { class: "btn btn-ghost", type: "button", onclick: () => activityDialog({}) }, icon("plus"), "Add custom activity"),
  );
  const copilotPane = h("aside", { class: "pane pane-copilot", "aria-label": "Copilot" });
  const mobileTabs = h("nav", { class: "mobile-tabs", "aria-label": "Workspace" });
  const workspace = h(
    "main",
    { class: "workspace" },
    h("section", { class: "pane pane-map", "aria-label": "Map and place search" }, searchForm, searchPanel, mapHost),
    h("section", { class: "pane pane-plan", "aria-label": "Itinerary" }, dayTabs, dayHead, timeline, planFoot),
    copilotPane,
  );
  root.replaceChildren(h("div", { class: "editor" }, bar, workspace, mobileTabs));
  if (S.starting && matchMedia("(max-width: 899px)").matches) S.tab = "map";

  const map = await createMap(mapHost, {
    config: ctx.config,
    onSelectStop: (id) => {
      select(id, { scroll: true });
      if (isPhone()) setTab("plan");
    },
    onSelectResult: (placeId) => pickPlace(shownResults().find((r) => r.placeId === placeId)),
    onPlaceClick: (placeId, at) => placeClicked(placeId, at),
    onMapClick: (at) => mapClicked(at),
    onViewChange: (v) => shareView(v),
  });

  const isPhone = () => matchMedia("(max-width: 899px)").matches;

  // "My spot": the latest place this person deliberately picked on the map
  // (a click on the map or on a Google place), with the zoom it was picked
  // at. Not the camera (S.myView follows every pan), a collaborator's view,
  // the starting point, a search result or the device's location. Kept in
  // this tab only (sessionStorage) and never sent to anyone.
  const SPOT_KEY = `wayline.mySpot.${tripId}`;
  const readSpot = () => {
    try {
      const v = JSON.parse(sessionStorage.getItem(SPOT_KEY) ?? "null");
      return v && Number.isFinite(v.lat) && Number.isFinite(v.lng) && Math.abs(v.lat) <= 90 && Math.abs(v.lng) <= 180 ? v : null;
    } catch {
      return null;
    }
  };
  function setMySpot(at) {
    const spot = { lat: at.lat, lng: at.lng, zoom: Math.max(map.zoom?.() ?? 15, 14) };
    try {
      sessionStorage.setItem(SPOT_KEY, JSON.stringify(spot));
    } catch {
      // private mode: it still works until the page closes
    }
    map.setMySpot(spot);
  }
  if (map.kind === "google") map.setMySpot(readSpot());

  // --- server state ---

  // remote: it came on the live stream (maybe a collaborator's change), so the
  // map keeps this person's zoom and position
  function applySnapshot(snap, { remote = false } = {}) {
    if (!snap || typeof snap.rev !== "number" || snap.rev < S.trip.rev) return;
    S.trip = snap;
    voice?.membersChanged();
    S.keepView = remote;
    if (!snap.days.some((d) => d.id === S.dayId)) S.dayId = snap.days[0]?.id ?? null;
    if (S.selectedId && !snap.days.some((d) => d.activities.some((a) => a.id === S.selectedId))) S.selectedId = null;
    S.editing?.onSnapshot(snap);
    render();
  }

  async function act(promise, { quiet = false } = {}) {
    try {
      const res = await promise;
      applySnapshot(res?.trip ?? res);
      return res;
    } catch (err) {
      if (err.status === 401) ctx.signOut();
      else if (!quiet) toast(err.message, { kind: "error" });
      throw err;
    }
  }
  const base = `/api/trips/${tripId}`;

  // one id per open tab, so two tabs of the same person are two map views
  const session = uid();
  const events = new EventSource(`${base}/events?session=${session}`);
  events.addEventListener("snapshot", (e) => applySnapshot(JSON.parse(e.data), { remote: true }));
  // voice calls: signalling for this tab only (ADR 0004)
  voice = createVoice({
    base,
    session,
    me,
    getMembers: () => S.trip.members,
    getPresence: () => S.presence,
    onChange: () => renderBar(),
    debug: params.has("calldebug"),
  });
  events.addEventListener("call", (e) => voice.handle(JSON.parse(e.data)));
  events.addEventListener("presence", (e) => {
    const wasAlone = S.presence.length <= 1;
    S.presence = JSON.parse(e.data);
    renderBar();
    renderPeers();
    // someone just arrived: let them see where this map is looking
    if (wasAlone && S.presence.length > 1 && S.myView) postView(S.myView);
  });

  // --- where everyone's map is looking (live only, never saved) ---
  const views = new Map(); // session -> { userId, displayName, lat, lng, zoom, heading, seen }
  events.addEventListener("view", (e) => {
    const v = JSON.parse(e.data);
    if (v.session === session) return;
    views.set(v.session, { ...v, seen: Date.now() });
    renderPeers();
  });
  events.addEventListener("view-gone", (e) => {
    views.delete(JSON.parse(e.data).session);
    renderPeers();
  });
  const VIEW_TTL_MS = 60_000;
  const prune = setInterval(() => {
    for (const [k, v] of views) if (Date.now() - v.seen > VIEW_TTL_MS) views.delete(k);
    renderPeers();
  }, 15_000);

  function renderPeers() {
    const here = new Set(S.presence.map((p) => p.id));
    const list = [...views.values()]
      .filter((v) => here.has(v.userId))
      .map((v) => {
        const name = v.userId === me.id ? `${v.displayName} (another tab)` : v.displayName;
        return { displayName: name, initials: initials(v.displayName), colour: personColour(v.userId), lat: v.lat, lng: v.lng, zoom: v.zoom };
      });
    map.setPeers(list);
  }

  // sent only while someone else has the trip open; nobody to tell otherwise
  function shareView(v) {
    S.myView = v;
    if (S.presence.length > 1) postView(v);
  }
  function postView(v) {
    fetch(`${base}/view`, { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" }, body: JSON.stringify({ session, ...v }) }).catch(() => {});
  }
  events.addEventListener("revoked", (e) => {
    const { reason } = JSON.parse(e.data);
    events.close();
    voice.destroy();
    toast(reason === "deleted" ? "This trip was deleted." : "You no longer have access to this trip.", { kind: "error" });
    ctx.navigate("/", { replace: true });
  });
  events.onopen = () => {
    S.live = true;
    renderBar();
    // a reconnect starts a new stream: the server sends the others' views again,
    // and this map's view goes out once more if anyone else is here
    if (S.presence.length > 1 && S.myView) postView(S.myView);
  };
  events.onerror = () => {
    S.live = false;
    views.clear();
    renderPeers();
    renderBar();
  };

  // --- rendering ---

  function render() {
    renderBar();
    renderDays();
    if (!S.dragging) renderTimeline();
    renderSearch();
    renderMap();
    renderCopilot();
    renderTabs();
  }

  function renderBar() {
    const t = S.trip;
    const online = S.presence.length ? S.presence : [{ id: me.id, displayName: me.displayName }];
    const issues = t.days.reduce((n, d) => n + d.analysis.issues.length, 0);
    fill(
      bar,
      h("a", { class: "icon-btn", href: "/", "data-link": true, "aria-label": "Back to your trips" }, icon("back")),
      h("div", { class: "trip-title" }, h("h1", {}, t.title), h("p", {}, `${t.destination} · ${fmtRange(t.startDate, t.endDate)}`)),
      h(
        "div",
        { class: "presence", title: online.map((p) => p.displayName).join(", ") },
        h("span", { class: "avatars" }, online.slice(0, 4).map((p) => avatar(p, "sm"))),
        h("span", { class: "presence-label" }, online.length > 1 ? `${online.length} people are planning this trip` : "Just you right now"),
      ),
      h("span", { class: `conn ${S.live ? "conn-live" : "conn-off"}`, role: "status" }, S.live ? "Live" : "Reconnecting…"),
      voice.render(),
      h("button", { class: "btn btn-ghost btn-sm", type: "button", onclick: shareDialog }, icon("share"), h("span", { class: "hide-sm" }, "Share")),
      role() === "owner" && h("button", { class: "icon-btn", type: "button", "aria-label": "Trip settings", onclick: settingsDialog }, icon("settings")),
      h(
        "button",
        { class: `btn btn-sm ${S.copilotOpen ? "btn-dark" : "btn-ghost"} hide-phone`, type: "button", "aria-pressed": String(S.copilotOpen), onclick: () => { S.copilotOpen = !S.copilotOpen; render(); } },
        icon("spark"),
        "Copilot",
        issues > 0 && h("span", { class: "badge badge-danger", "aria-label": `${issues} issues` }, String(issues)),
      ),
    );
  }

  function renderDays() {
    dayTabs.replaceChildren(
      ...S.trip.days.map((d, i) => {
        const conflicts = d.analysis.issues.filter((x) => x.severity === "conflict").length;
        const tab = h(
          "button",
          {
            type: "button",
            role: "tab",
            class: `day-tab${d.id === S.dayId ? " on" : ""}`,
            "aria-selected": String(d.id === S.dayId),
            onclick: () => setDay(d.id),
          },
          h("span", { class: "day-tab-n" }, `Day ${i + 1}`),
          h("span", { class: "day-tab-date" }, fmtDay(d.date)),
          h("span", { class: "day-tab-count" }, d.activities.length ? `${d.activities.length} stop${d.activities.length === 1 ? "" : "s"}` : "Empty"),
          conflicts > 0 && h("span", { class: "dot-danger", "aria-label": `${conflicts} conflicts` }),
        );
        tab.addEventListener("dragover", (e) => {
          if (!S.dragging) return;
          e.preventDefault();
          tab.classList.add("drop-target");
        });
        tab.addEventListener("dragleave", () => tab.classList.remove("drop-target"));
        tab.addEventListener("drop", (e) => {
          e.preventDefault();
          tab.classList.remove("drop-target");
          const id = S.dragging;
          if (id) move(id, d.id, 9999).then(() => toast(`Moved to Day ${i + 1}.`));
        });
        return tab;
      }),
    );
  }

  function setDay(id) {
    S.dayId = id;
    S.selectedId = null;
    try {
      localStorage.setItem(dayKey, id);
    } catch {}
    render();
  }

  function renderTimeline() {
    const d = day();
    if (!d) return;
    const idx = S.trip.days.indexOf(d);
    const conflicts = d.analysis.issues.filter((x) => x.severity === "conflict").length;
    dayHead.replaceChildren(
      h("h2", {}, `Day ${idx + 1}`, h("span", {}, ` · ${fmtDay(d.date, { weekday: "long", day: "numeric", month: "long" })}`)),
      h(
        "p",
        { class: conflicts ? "day-sum day-sum-bad" : "day-sum" },
        d.activities.length === 0 ? "Nothing planned yet" : `${d.activities.length} stop${d.activities.length === 1 ? "" : "s"}`,
        conflicts > 0 && ` · ${conflicts} schedule conflict${conflicts === 1 ? "" : "s"}`,
      ),
    );

    const missing = missingLegs(d);
    if (missing.length > 1) {
      dayHead.append(
        h(
          "p",
          { class: "day-routes" },
          h("button", { class: "btn btn-sm btn-outline", type: "button", disabled: missing.some(([a, b]) => S.busyLegs.has(`${a.id}>${b.id}`)), onclick: () => calcMissing(d) }, `Calculate ${missing.length} missing routes`),
        ),
      );
    }
    if (!startOf() && !S.starting && idx === 0) {
      dayHead.append(h("p", { class: "day-start-link" }, h("button", { class: "linklike small", type: "button", onclick: () => beginStart() }, icon("pin"), "Set a starting point")));
    }

    if (!d.activities.length) {
      timeline.replaceChildren(
        h(
          "li",
          { class: "timeline-empty" },
          h("h3", {}, "Start by searching for somewhere you want to visit"),
          h("p", {}, "Explore the map or search to add a stop: click a place on the map, or click anywhere to see what's nearby. You can also add your own activity below. Wayline works out the travel time between consecutive stops."),
          h("button", { class: "btn btn-primary btn-sm", type: "button", onclick: () => { if (isPhone()) setTab("map"); searchInput.focus(); } }, icon("search"), "Search places"),
        ),
      );
      return;
    }
    const items = [];
    d.activities.forEach((a, i) => {
      items.push(stopItem(a, i, d));
      if (i + 1 < d.activities.length) items.push(legItem(d, a, d.activities[i + 1]));
    });
    if (S.hint && d.activities.length === 1 && d.activities[0].role === "start") {
      items.push(
        h(
          "li",
          { class: "timeline-hint" },
          h("p", {}, h("strong", {}, "Explore the map or search to add your next stop."), " Click a place on the map for details, or click anywhere to see what's nearby."),
          h("button", { class: "icon-btn", type: "button", "aria-label": "Dismiss", onclick: () => { S.hint = false; renderTimeline(); } }, icon("close")),
        ),
      );
    }
    timeline.replaceChildren(...items);
  }

  // One stop on the day's rail: its time on the left, a dot carrying the same
  // number as its map marker, then what it is. Timed stops sit where their
  // time puts them (the server keeps that order), so they move by changing the
  // time; untimed stops, after them, can still be moved up and down.
  function stopItem(a, i, d) {
    const n = d.activities.length;
    const isStart = a.role === "start";
    const first = d.activities[0]?.role === "start" ? 1 : 0;
    const firstUntimed = d.activities.findIndex((x) => x.role !== "start" && x.startMin === null);
    const timed = a.startMin !== null;
    const li = h(
      "li",
      { class: `stop kind-${a.kind}${isStart ? " stop-start" : ""}${timed ? "" : " stop-untimed"}${a.id === S.selectedId ? " selected" : ""}`, dataset: { id: a.id }, draggable: isStart ? "false" : "true" },
      h(
        "div",
        { class: "stop-rail" },
        h("span", { class: "stop-clock" }, timed ? hhmm(a.startMin) : isStart ? "" : "No time"),
        h("span", { class: "stop-num", title: isStart ? "Start" : `Marker ${i + 1 - first} on the map` }, isStart ? "S" : String(i + 1 - first)),
      ),
      h(
        "article",
        { class: "stop-card", tabindex: "-1" },
        isStart && h("p", { class: "stop-top" }, h("span", { class: "start-badge" }, "Start"), a.startMin === null ? "" : h("span", { class: "muted small" }, ` leave ${hhmm(a.startMin)}`)),
        h("h3", {}, h("button", { class: "linklike", type: "button", onclick: () => openStop(a) }, a.title)),
        h(
          "p",
          { class: "stop-meta" },
          !isStart && h("span", {}, `Visit ${dur(a.durationMin)}`),
          a.meal && h("span", { class: "tag tag-meal" }, MEAL_LABEL[a.meal]),
          !isStart && !a.meal && h("span", { class: `tag tag-${a.kind}` }, KIND_LABEL[a.kind]),
          a.place?.source === "custom" && h("span", { class: "tag", title: "A spot picked on the map, not a Google place" }, "Pinned spot"),
          a.place?.source === "demo" && h("span", { class: "tag tag-demo", title: "Demo fixture, not data from Google" }, "Demo place"),
          a.place?.source === "curated" && h("span", { class: "tag tag-demo", title: "From Wayline's curated sample data, not matched to a Google place" }, "Approximate location"),
          !a.place && h("span", { class: "muted" }, "No place"),
        ),
        a.notes && h("p", { class: "stop-notes" }, a.notes),
        a.updatedBy && a.updatedBy !== me.id && Date.now() - a.updatedAt < 120_000 && h("p", { class: "stop-touched" }, `Changed by ${memberName(a.updatedBy)} ${relTime(a.updatedAt)}`),
        h(
          "div",
          { class: "stop-actions" },
          isStart
            ? h("button", { class: "btn btn-ghost btn-sm", type: "button", onclick: () => beginStart() }, icon("pin"), "Change start")
            : timed
              ? h("button", { class: "btn btn-ghost btn-sm", type: "button", "aria-label": `Change the time of ${a.title}`, onclick: () => activityDialog({ activity: a, focus: "start" }) }, "Change time")
              : [
                  h("button", { class: "icon-btn", type: "button", "aria-label": `Move ${a.title} earlier`, disabled: i <= Math.max(first, firstUntimed), onclick: () => move(a.id, d.id, i - 1) }, icon("up")),
                  h("button", { class: "icon-btn", type: "button", "aria-label": `Move ${a.title} later`, disabled: i === n - 1, onclick: () => move(a.id, d.id, i + 1) }, icon("down")),
                ],
          !isStart && h("button", { class: "icon-btn", type: "button", title: "Change place", "aria-label": `Change the place of ${a.title}`, onclick: () => beginReplace(a) }, icon("pin")),
          h("button", { class: "btn btn-ghost btn-sm", type: "button", onclick: () => activityDialog({ activity: a }) }, icon("edit"), "Edit"),
          h("button", { class: "icon-btn icon-btn-danger", type: "button", "aria-label": `Remove ${a.title}`, onclick: () => removeActivity(a) }, icon("trash")),
        ),
      ),
    );
    if (isStart) return li;
    li.addEventListener("dragstart", (e) => {
      S.dragging = a.id;
      e.dataTransfer.effectAllowed = "move";
      e.dataTransfer.setData("text/plain", a.id);
      requestAnimationFrame(() => li.classList.add("dragging"));
    });
    li.addEventListener("dragend", () => {
      S.dragging = null;
      timeline.querySelectorAll(".drop-before,.drop-after").forEach((x) => x.classList.remove("drop-before", "drop-after"));
      render();
    });
    return li;
  }

  timeline.addEventListener("dragover", (e) => {
    if (!S.dragging) return;
    e.preventDefault();
    const { target, after } = dropTarget(e.clientY);
    timeline.querySelectorAll(".drop-before,.drop-after").forEach((x) => x.classList.remove("drop-before", "drop-after"));
    target?.classList.add(after ? "drop-after" : "drop-before");
  });
  timeline.addEventListener("drop", (e) => {
    if (!S.dragging) return;
    e.preventDefault();
    const { index } = dropTarget(e.clientY);
    const id = S.dragging;
    S.dragging = null;
    const a = day()?.activities.find((x) => x.id === id);
    if (a?.startMin !== null) return void activityDialog({ activity: a, focus: "start", note: "This stop has a time, so it sits where its time puts it. Change the time to move it." });
    move(id, S.dayId, index);
  });

  function dropTarget(y) {
    const stops = [...timeline.querySelectorAll(".stop:not(.dragging)")];
    const i = stops.findIndex((el) => {
      const r = el.getBoundingClientRect();
      return y < r.top + r.height / 2;
    });
    if (i === -1) return { index: stops.length, target: stops[stops.length - 1], after: true };
    return { index: i, target: stops[i], after: false };
  }

  // The journey between two stops: how you go and how long it takes. The
  // stops' own times already say when; departures and arrivals stay in the
  // collapsed details. Overlaps and too-short gaps show as a warning, and
  // nothing is rescheduled for the user.
  function legItem(d, prev, next) {
    const gap = d.analysis.gaps.find((g) => g.fromId === prev.id && g.toId === next.id);
    const seg = d.segments.find((s) => s.fromId === prev.id && s.toId === next.id);
    const issues = d.analysis.issues.filter((x) => x.fromId === prev.id && x.toId === next.id);
    const key = `${prev.id}>${next.id}`;
    const busy = S.busyLegs.has(key);
    const sel = seg?.options.find((o) => o.mode === seg.selectedMode);

    const body = [];
    if (gap?.status === "no_places") {
      body.push(h("p", { class: "leg-line muted" }, "No travel time: ", !prev.place ? prev.title : next.title, " has no place on the map."));
    } else if (gap?.status === "not_calculated") {
      body.push(h("div", { class: "leg-line" }, h("span", { class: "muted" }, "Travel time not calculated"), routeButton(prev, next, busy, "Calculate")));
    } else if (seg) {
      body.push(
        h(
          "div",
          { class: "leg-main" },
          sel
            ? h("p", { class: "leg-summary" }, icon(MODE_ICON[sel.mode]), h("strong", {}, `${MODE_WORD[sel.mode]} · ${dur(Math.max(1, Math.ceil(sel.durationSec / 60)))}`))
            : h("p", { class: "leg-summary muted" }, seg.options.map((o) => o.message).filter(Boolean)[0] ?? "No route was found."),
          modeChips(seg),
        ),
      );
      if (sel) body.push(routeDetails(sel, key));
      if (seg.stale) body.push(h("div", { class: "leg-line leg-warn" }, "Times changed since this was calculated.", routeButton(prev, next, busy, "Recalculate", true)));
      body.push(h("p", { class: "leg-attrib", translate: "no" }, `Google Maps · ${relTime(seg.computedAt)}`));
    }

    return h(
      "li",
      { class: `leg${issues.some((x) => x.severity === "conflict") ? " leg-bad" : ""}`, "aria-label": `Travel from ${prev.title} to ${next.title}` },
      ...body,
      issues.map((x) =>
        h(
          "p",
          { class: "leg-issue" },
          h("span", { class: "chip chip-danger" }, x.kind === "overlap" ? `Overlaps by ${dur(x.minutes)}` : `${dur(x.minutes)} short`),
          " ",
          x.message,
          " ",
          h("button", { class: "linklike", type: "button", onclick: openCopilot }, "See options"),
        ),
      ),
    );
  }

  const routable = (a) => a.place?.source === "google" || (a.place?.source === "custom" && a.place.lat !== null);

  // consecutive pairs that could be routed but have no route yet
  const missingLegs = (d) =>
    ctx.config.routes
      ? d.activities.slice(0, -1).map((a, i) => [a, d.activities[i + 1]]).filter(([a, b]) => routable(a) && routable(b) && !d.segments.some((s) => s.fromId === a.id && s.toId === b.id))
      : [];

  async function calcMissing(d) {
    for (const [a, b] of missingLegs(d)) await calcRoute(a, b, false);
  }

  function routeButton(prev, next, busy, label, force = false) {
    const unverified = !routable(prev) || !routable(next);
    const disabledWhy = !ctx.config.routes
      ? "Routes need Google Maps configured on the server"
      : unverified
        ? "Only Google places and spots picked on the map can be routed"
        : null;
    return h(
      "span",
      { class: "route-btn" },
      h(
        "button",
        { class: "btn btn-sm btn-outline", type: "button", disabled: Boolean(disabledWhy) || busy, onclick: () => calcRoute(prev, next, force) },
        busy ? "Calculating…" : label,
      ),
      disabledWhy && h("small", { class: "muted" }, disabledWhy),
    );
  }

  // switching how you go: one small button per mode, its time in the label
  function modeChips(seg) {
    return h(
      "div",
      { class: "modes modes-compact", role: "group", "aria-label": "Transport mode" },
      seg.options.map((o) => {
        const ok = o.status === "ok";
        const label = ok ? `${MODE_WORD[o.mode]}, ${dur(Math.max(1, Math.ceil(o.durationSec / 60)))}` : `${MODE_WORD[o.mode]}: ${o.message ?? "not available"}`;
        return h(
          "button",
          {
            type: "button",
            class: `mode${seg.selectedMode === o.mode ? " on" : ""}`,
            "aria-pressed": String(seg.selectedMode === o.mode),
            "aria-label": label,
            title: label,
            disabled: !ok,
            onclick: () => seg.selectedMode !== o.mode && act(api(`${base}/segments/${seg.id}/mode`, { method: "POST", body: { mode: o.mode } })).catch(() => {}),
          },
          icon(MODE_ICON[o.mode]),
        );
      }),
    );
  }

  // the route's particulars (distance, lines, departures), out of the way
  function routeDetails(o, key) {
    const transit = (o.steps ?? []).filter((s) => s.kind === "transit");
    const open = S.openLegs.has(key);
    if (!o.distanceM && !o.steps?.length) return null;
    return h(
      "div",
      { class: "route" },
      h(
        "button",
        { class: "linklike small", type: "button", "aria-expanded": String(open), onclick: () => { open ? S.openLegs.delete(key) : S.openLegs.add(key); renderTimeline(); } },
        open ? "Hide details" : "Details",
      ),
      open &&
        h(
          "div",
          { class: "route-more" },
          h("p", { class: "small muted" }, [o.distanceM ? `${(o.distanceM / 1000).toFixed(o.distanceM < 10_000 ? 1 : 0)} km` : null, o.mode === "TRANSIT" && transit.length ? `${transit.length - 1} transfer${transit.length === 2 ? "" : "s"}` : null].filter(Boolean).join(" · ")),
          o.mode === "TRANSIT" && transit.length > 0 && h("p", { class: "lines" }, transit.map((s) => lineChip(s))),
          o.steps?.length > 0 &&
            h(
              "ol",
              { class: "steps" },
              o.steps.map((s) =>
                s.kind === "walk"
                  ? h("li", { class: "step-walk" }, icon("walk"), `Walk ${dur(Math.max(1, Math.round(s.durationSec / 60)))}${s.distanceM ? ` (${Math.round(s.distanceM)} m)` : ""}`)
                  : h(
                      "li",
                      { class: "step-transit" },
                      lineChip(s),
                      s.headsign && h("span", {}, ` toward ${s.headsign}`),
                      h("span", { class: "step-stops" }, ` ${s.from ?? "?"} ${s.localDeparture ?? ""} → ${s.to ?? "?"} ${s.localArrival ?? ""}`),
                      s.stops !== null && h("span", { class: "muted" }, ` · ${s.stops} stop${s.stops === 1 ? "" : "s"}`),
                    ),
              ),
            ),
        ),
    );
  }

  const lineChip = (s) =>
    h(
      "span",
      { class: "line-chip", style: s.color ? `--lc:${s.color};--lt:${s.textColor ?? "#fff"}` : "" },
      [s.vehicle, s.line].filter(Boolean).join(" ") || "Transit",
    );

  function renderTabs() {
    const issues = (day()?.analysis.issues ?? []).length;
    workspace.dataset.tab = S.tab;
    workspace.classList.toggle("with-copilot", S.copilotOpen);
    mobileTabs.replaceChildren(
      ...[
        ["map", "Map", "search"],
        ["plan", "Plan", "edit"],
        ["copilot", "Copilot", "spark"],
      ].map(([k, label, ic]) =>
        h(
          "button",
          { type: "button", class: S.tab === k ? "on" : "", "aria-pressed": String(S.tab === k), onclick: () => setTab(k) },
          icon(ic),
          h("span", {}, label),
          k === "copilot" && issues > 0 && h("span", { class: "badge badge-danger" }, String(issues)),
        ),
      ),
    );
  }

  function setTab(t) {
    S.tab = t;
    renderTabs();
  }

  function openCopilot() {
    if (isPhone()) setTab("copilot");
    else {
      S.copilotOpen = true;
      render();
    }
  }

  // --- map & search ---

  // the list on screen: nearby places around a map click, else search results
  const shownResults = () => (S.explore ? S.explore.results : S.results);

  function renderMap() {
    const d = day();
    const stops = (d?.activities ?? [])
      .filter((a) => a.place && a.place.lat !== null)
      .map((a) => ({ id: a.id, title: a.title, kind: a.kind, lat: a.place.lat, lng: a.place.lng, start: a.role === "start", selected: a.id === S.selectedId }));
    // one temporary marker at most: the start being considered, the clicked
    // spot, or a clicked place that isn't one of the listed results
    const cand = S.starting?.candidate;
    const clickedPlace = S.place && !shownResults().some((r) => r.placeId === S.place.placeId) && Number.isFinite(S.place.lat) ? S.place : null;
    const temp = cand
      ? { lat: cand.place.lat, lng: cand.place.lng, label: cand.title, start: true }
      : clickedPlace
        ? { lat: clickedPlace.lat, lng: clickedPlace.lng, label: clickedPlace.name }
        : S.explore
          ? { lat: S.explore.lat, lng: S.explore.lng, label: S.explore.label }
          : null;
    map.update({ stops, results: shownResults(), temp, center: S.trip.center, selectedPlaceId: S.place?.placeId ?? null, keepView: S.keepView });
    S.keepView = false;
  }

  searchForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const q = searchInput.value.trim();
    if (q.length < 2) return;
    searchPanel.hidden = false;
    searchPanel.replaceChildren(h("p", { class: "muted pad" }, "Searching…"));
    try {
      const res = await api(`/api/places/search?q=${encodeURIComponent(q)}&tripId=${tripId}`);
      S.results = res.places;
      S.resultsSource = res.source;
      S.place = null;
      S.placeDetails = null;
      S.explore = null;
      if (S.starting) S.starting = { ...S.starting, step: "search", candidate: null };
      renderSearch();
      renderMap();
    } catch (err) {
      searchPanel.replaceChildren(h("p", { class: "form-error pad" }, err.message));
    }
  });

  function closeSearch() {
    S.results = [];
    S.place = null;
    S.placeDetails = null;
    S.explore = null;
    if (S.starting) S.starting = null;
    S.replacing = null;
    searchPanel.hidden = true;
    renderMap();
    renderTimeline();
  }

  // Details are fetched when a place is opened, and the place is filled in
  // from them (a clicked map icon starts with only its id and position).
  async function pickPlace(p) {
    if (!p) return;
    S.place = p;
    S.placeDetails = null;
    renderSearch();
    renderMap();
    if (Number.isFinite(p.lat)) map.focus(p);
    if (p.source !== "google") return void ((S.placeDetails = { none: true }), renderSearch());
    try {
      // the guide view: description, reviews and attributes, once per opened place
      const details = await api(`/api/places/${encodeURIComponent(p.placeId)}?view=guide`);
      if (S.place?.placeId === p.placeId) {
        S.place = { ...S.place, name: details.name, address: details.address, category: details.category, types: details.types, lat: details.lat, lng: details.lng, pending: false };
        S.placeDetails = details;
        renderSearch();
        renderMap();
        // one large photo and up to two small ones, fetched once
        const uris = await Promise.all(
          (details.photos ?? []).map((ph, i) => api(`/api/places/photo?name=${encodeURIComponent(ph.name)}&w=${i === 0 ? 640 : 320}`).then((r) => r.uri, () => null)),
        );
        if (S.placeDetails === details && uris.some(Boolean)) {
          details.photoUris = uris;
          renderSearch();
        }
      }
    } catch (err) {
      if (S.place?.placeId === p.placeId) {
        S.placeDetails = { error: err.message };
        renderSearch();
      }
    }
  }

  // A click on one of Google's place icons: open it. While choosing the
  // start, it becomes the candidate instead.
  function placeClicked(placeId, at) {
    const p = { placeId, name: "Loading place…", lat: at.lat, lng: at.lng, source: "google", types: [], pending: true };
    if (S.starting) return considerStartPlace(p);
    setMySpot(at);
    pickPlace(p);
  }

  // A click anywhere else: explore around it, or, while choosing the start,
  // make that spot the candidate.
  function mapClicked(at) {
    if (S.starting) return considerStartSpot(at);
    setMySpot(at);
    exploreAt(at);
  }

  const NEARBY = [
    ["tourist_attraction", "Attractions"],
    ["restaurant", "Restaurants"],
    ["cafe", "Cafés"],
    ["museum", "Museums"],
    ["shopping_mall", "Shopping"],
    ["lodging", "Hotels"],
  ];

  async function exploreAt(at) {
    S.place = null;
    S.placeDetails = null;
    S.results = [];
    S.explore = { lat: at.lat, lng: at.lng, label: null, type: "tourist_attraction", results: [], source: null, loading: false, error: null, cache: new Map() };
    const mine = S.explore;
    renderSearch();
    renderMap();
    if (isPhone()) setTab("map");
    api(`/api/geo/reverse?lat=${at.lat}&lng=${at.lng}`)
      .then((r) => { if (S.explore === mine) mine.label = r.label; })
      .catch(() => {})
      .finally(() => { if (S.explore === mine) renderSearch(); });
    loadNearby("tourist_attraction");
  }

  // one request per category per clicked spot; switching back reuses it
  async function loadNearby(type) {
    const ex = S.explore;
    if (!ex) return;
    ex.type = type;
    const hit = ex.cache.get(type);
    if (hit) {
      Object.assign(ex, { results: hit.places, source: hit.source, loading: false, error: null });
      return void (renderSearch(), renderMap());
    }
    Object.assign(ex, { results: [], loading: true, error: null });
    renderSearch();
    renderMap();
    try {
      const res = await api(`/api/places/nearby?lat=${ex.lat}&lng=${ex.lng}&radius=1500&type=${type}&rich=1`);
      ex.cache.set(type, res);
      if (S.explore !== ex || ex.type !== type) return;
      Object.assign(ex, { results: res.places, source: res.source, loading: false });
    } catch (err) {
      if (S.explore !== ex || ex.type !== type) return;
      Object.assign(ex, { loading: false, error: err.message });
    }
    renderSearch();
    renderMap();
  }

  // a timeline stop: highlight it on the map and, for a Google place, open it
  function openStop(a) {
    select(a.id, { focusMap: true });
    if (a.place?.source === "google" && !S.starting) {
      S.explore = null;
      pickPlace({ placeId: a.place.placeId, name: a.title, lat: a.place.lat, lng: a.place.lng, source: "google", types: [] });
    }
  }

  // every stop already planned at this place, on any day
  const visitsOf = (placeId) =>
    S.trip.days.flatMap((d, di) => d.activities.filter((a) => a.place?.placeId === placeId).map((a) => ({ a, day: di + 1 })));

  function renderSearch() {
    // choosing the start by search shows the ordinary results and place card
    const searchingStart = S.starting?.step === "search" && (S.results.length || S.place);
    if (S.starting && !searchingStart) return void ((searchPanel.hidden = false), searchPanel.replaceChildren(startPanel()));
    if (S.replacing && !S.place && !S.explore && !S.results.length) return void ((searchPanel.hidden = false), searchPanel.replaceChildren(replacePanel()));
    if (S.explore && !S.place) return void ((searchPanel.hidden = false), searchPanel.replaceChildren(explorePanel()));
    if (!S.results.length && !S.place) {
      if (S.resultsSource) {
        searchPanel.hidden = false;
        searchPanel.replaceChildren(panelHead("No places found"), h("p", { class: "muted pad" }, "Try a different name or a broader search."));
        S.resultsSource = null;
      }
      return;
    }
    searchPanel.hidden = false;
    if (S.place) return searchPanel.replaceChildren(placeCard(S.place));
    fill(
      searchPanel,
      panelHead(`${S.results.length} place${S.results.length === 1 ? "" : "s"}`),
      S.resultsSource === "demo" &&
        h("p", { class: "demo-note" }, h("strong", {}, "Demo places."), " Google Places isn't configured on this server, so these are a few fixed Sydney landmarks with approximate locations, not search results."),
      h(
        "ul",
        { class: "results" },
        S.results.map((r) =>
          h(
            "li",
            {},
            h(
              "button",
              { type: "button", class: "result", onclick: () => pickPlace(r) },
              h("strong", {}, r.name),
              h("span", { class: "muted" }, [r.category, r.address].filter(Boolean).join(" · ")),
            ),
          ),
        ),
      ),
      S.resultsSource === "google" && h("p", { class: "attrib", translate: "no" }, "Google Maps"),
    );
  }

  const panelHead = (title) =>
    h("div", { class: "panel-head" }, h("strong", {}, title), h("button", { class: "icon-btn", type: "button", "aria-label": "Close search results", onclick: closeSearch }, icon("close")));

  // The place card is for deciding whether a place is worth it: what Google
  // knows about it, and nothing that changes the plan. Adding opens the
  // separate scheduling card.
  function placeCard(p) {
    const d = S.placeDetails;
    const visits = visitsOf(p.placeId);
    const back = S.explore ? "← Nearby places" : S.results.length ? "← Results" : null;
    const credit = (ph) =>
      ph.attributions.length > 0 &&
      h("figcaption", { class: "photo-credit" }, "Photo: ", ph.attributions.map((a, i) => [i > 0 && ", ", a.uri ? h("a", { href: a.uri, target: "_blank", rel: "noopener" }, a.displayName) : a.displayName]));
    const uris = d?.photoUris ?? [];
    const loaded = !d || d.error || d.none ? null : d;
    const about = loaded && p.source === "google"; // shown even when Google has little, saying so
    return h(
      "div",
      { class: "place-card" },
      h(
        "div",
        { class: "panel-head" },
        back ? h("button", { class: "linklike small", type: "button", onclick: () => { S.place = null; S.placeDetails = null; renderSearch(); renderMap(); } }, back) : h("span", { class: "muted small" }, "Place"),
        h("button", { class: "icon-btn", type: "button", "aria-label": "Close", onclick: closeSearch }, icon("close")),
      ),
      uris[0] &&
        h(
          "figure",
          { class: "place-photo" },
          h("img", { src: uris[0], alt: `Photo of ${p.name}`, loading: "lazy", decoding: "async", onerror: (e) => e.currentTarget.closest("figure")?.remove() }),
          credit(d.photos[0]),
        ),
      uris.slice(1).some(Boolean) &&
        h(
          "div",
          { class: "place-photos-more" },
          uris.slice(1).map(
            (u, i) =>
              u &&
              h(
                "figure",
                {},
                h("img", { src: u, alt: `Another photo of ${p.name}`, loading: "lazy", decoding: "async", onerror: (e) => e.currentTarget.closest("figure")?.remove() }),
                credit(d.photos[i + 1]),
              ),
          ),
        ),
      h("h3", {}, p.name),
      h(
        "p",
        { class: "stop-meta" },
        p.category && h("span", { class: "tag" }, p.category),
        loaded?.price && h("span", { class: "tag" }, loaded.price),
        p.source === "demo" && h("span", { class: "tag tag-demo" }, "Demo place"),
        loaded?.openNow === true && h("span", { class: "tag tag-open" }, "Open now"),
        loaded?.openNow === false && h("span", { class: "tag" }, "Closed now"),
      ),
      loaded && typeof loaded.rating === "number" &&
        h("p", { class: "rating" }, h("strong", {}, loaded.rating.toFixed(1)), " ★", loaded.ratingCount ? h("span", { class: "muted" }, ` (${loaded.ratingCount.toLocaleString("en-AU")} Google reviews)`) : null),
      p.address && h("p", { class: "muted" }, p.address),
      visits.length > 0 &&
        h(
          "p",
          { class: "already" },
          icon("check"),
          "Already in your plan: ",
          visits.map((v, i) => [i > 0 && ", ", `Day ${v.day}${v.a.role === "start" ? " (start)" : v.a.startMin !== null ? ` at ${hhmm(v.a.startMin)}` : ""}`]),
        ),
      d === null && p.source === "google" && h("p", { class: "muted small", role: "status" }, "Loading details…"),
      d?.error && h("p", { class: "form-error small" }, d.error),
      p.source === "demo" && h("p", { class: "muted small" }, "A demo place: no Google details, photos or reviews."),

      about &&
        h(
          "section",
          { class: "guide-section" },
          h("h4", {}, "About this place"),
          loaded.summary ? h("p", { class: "guide-summary" }, loaded.summary) : h("p", { class: "muted small" }, "Google has no description of this place."),
          loaded.features?.length > 0 && h("ul", { class: "guide-features", "aria-label": "Reported by Google" }, loaded.features.map((f) => h("li", {}, f))),
          loaded.openingHours &&
            h(
              "details",
              { class: "hours" },
              h("summary", {}, "Opening hours"),
              h("ul", {}, loaded.openingHours.map((line) => h("li", {}, line))),
            ),
          loaded.website && h("p", { class: "small" }, h("a", { href: loaded.website, target: "_blank", rel: "noopener" }, "Official website")),
        ),

      loaded &&
        p.source === "google" &&
        h(
          "section",
          { class: "guide-section" },
          h("h4", {}, "What visitors say"),
          loaded.reviews?.length
            ? h(
                "ul",
                { class: "reviews" },
                loaded.reviews.map((r) => {
                  const long = r.text.length > 260;
                  const body = h("p", { class: "review-text" }, long ? `${r.text.slice(0, 240).trimEnd()}…` : r.text);
                  const more = long && h("button", { class: "linklike small", type: "button", onclick: (e) => { body.textContent = r.text; e.currentTarget.remove(); } }, "Read the whole review");
                  return h(
                    "li",
                    { class: "review" },
                    h(
                      "p",
                      { class: "review-head" },
                      r.authorUri ? h("a", { href: r.authorUri, target: "_blank", rel: "noopener" }, r.author) : h("strong", {}, r.author),
                      typeof r.rating === "number" && h("span", { class: "review-stars", "aria-label": `${r.rating} out of 5` }, "★".repeat(Math.round(r.rating)) + "☆".repeat(5 - Math.round(r.rating))),
                      r.when && h("span", { class: "muted" }, r.when),
                    ),
                    body,
                    more,
                    r.uri && h("a", { class: "small", href: r.uri, target: "_blank", rel: "noopener" }, "View on Google Maps"),
                  );
                }),
              )
            : h("p", { class: "muted small" }, "No Google reviews for this place yet."),
          loaded.reviews?.length > 0 && h("p", { class: "muted tiny" }, "Reviews from Google, unedited; long ones are shortened until opened."),
        ),

      h(
        "div",
        { class: "place-actions" },
        loaded?.googleMapsUri && h("a", { class: "btn btn-ghost btn-sm", href: loaded.googleMapsUri, target: "_blank", rel: "noopener" }, "View on Google Maps"),
        S.starting
          ? h(
              "button",
              { class: "btn btn-primary", type: "button", disabled: Boolean(p.pending), onclick: () => confirmStart({ title: p.name, place: { placeId: p.placeId, source: p.source, lat: p.lat, lng: p.lng } }) },
              icon("pin"),
              "Set as starting point",
            )
          : S.replacing
            ? h(
                "button",
                { class: "btn btn-primary", type: "button", disabled: Boolean(p.pending), onclick: () => confirmReplace({ placeId: p.placeId, source: p.source, lat: p.lat, lng: p.lng }, p.name) },
                icon("pin"),
                `Use for ${S.replacing.title}`,
              )
            : h(
              "button",
              { class: "btn btn-primary add-to-trip", type: "button", disabled: Boolean(p.pending), onclick: () => scheduleCard({ title: p.name, kind: guessKind(p.types), types: p.types, place: { placeId: p.placeId, source: p.source, lat: p.lat, lng: p.lng } }) },
              icon("plus"),
              visits.length ? "Add another visit" : "Add to Itinerary",
            ),
      ),
      p.source === "google" && h("p", { class: "attrib", translate: "no" }, "Google Maps"),
    );
  }

  // The scheduling card: a small dialog over the place card. Nothing is
  // shared until "Confirm & add"; Cancel leaves the plan and the place card as
  // they were. custom: a spot picked on the map, so the name is editable.
  function scheduleCard({ title, kind, place, types = [], custom = false }) {
    const days = S.trip.days;
    const current = day();
    const clientId = uid();
    // places to eat get a meal choice; everything else just a time
    const dining = kind === "food" || types.some((t) => FOOD_TYPES.has(t));
    let meal = null; // chosen meal, or null for a custom time
    const mealPick = dining
      ? h(
          "div",
          { class: "field" },
          h("span", {}, "Meal"),
          h(
            "div",
            { class: "meal-chips", role: "group", "aria-label": "Meal" },
            [...Object.entries(MEAL_LABEL), [null, "Custom time"]].map(([k, label]) =>
              h("button", { type: "button", class: "cat-chip", dataset: { meal: k ?? "" }, "aria-pressed": "false", onclick: () => pickMeal(k) }, label),
            ),
          ),
        )
      : null;
    const prevOf = (d) => [...(d?.activities ?? [])].filter((a) => a.startMin !== null).sort((a, b) => a.startMin + a.durationMin - (b.startMin + b.durationMin)).pop() ?? null;
    const error = h("p", { class: "form-error", role: "alert", hidden: true });
    const hint = h("p", { class: "muted small schedule-hint" });
    const form = h(
      "form",
      { method: "dialog", class: "stack" },
      h("p", { class: "schedule-kicker" }, "Add to itinerary"),
      custom
        ? h("label", { class: "field" }, h("span", {}, "Name"), h("input", { name: "title", required: true, maxlength: 120, value: title, placeholder: "e.g. Meeting point" }))
        : h("h2", {}, title),
      h("label", { class: "field" }, h("span", {}, "Day"), h("select", { name: "dayId" }, days.map((x, i) => h("option", { value: x.id, selected: x.id === current?.id }, `Day ${i + 1} · ${fmtDay(x.date)}`)))),
      mealPick,
      h(
        "div",
        { class: "row-2" },
        h("label", { class: "field" }, h("span", {}, "Arrival"), h("input", { name: "start", type: "time", step: 300, required: true })),
        h("label", { class: "field" }, h("span", {}, "Visit length (min)"), h("input", { name: "duration", type: "number", min: 5, max: 1440, step: 5, required: true, value: KIND_DURATION[kind] ?? 60 })),
      ),
      hint,
      h("label", { class: "field" }, h("span", {}, "Notes (optional)"), h("textarea", { name: "notes", rows: 2, maxlength: 2000, placeholder: "Book ahead, what to try, who's coming…" })),
      error,
      h(
        "div",
        { class: "dialog-actions" },
        h("button", { class: "btn btn-ghost", type: "button", onclick: () => done() }, "Cancel"),
        h("button", { class: "btn btn-primary", type: "submit" }, "Confirm & add"),
      ),
    );
    // a suggestion only: right after the day's last timed stop, without travel
    // time, which isn't known until a route is calculated
    const suggest = () => {
      const d = days.find((x) => x.id === form.dayId.value);
      form.start.value = hhmm(suggestStart(d));
      const prev = prevOf(d);
      hint.textContent = prev ? `Suggested: when ${prev.title} ends (${hhmm(prev.startMin + prev.durationMin)}). Travel time isn't included yet; it appears once the route is calculated.` : "Suggested: 09:00, as nothing on this day has a time yet.";
    };
    // A meal suggests its usual time from the trip's settings. If that overlaps
    // a stop already planned, the nearest free slot inside the meal's range is
    // offered instead; if there is none, the clash is named. Nothing is
    // replaced, and the time stays editable.
    function pickMeal(k) {
      meal = k;
      for (const b of mealPick.querySelectorAll("[data-meal]")) b.setAttribute("aria-pressed", String((b.dataset.meal || null) === k));
      for (const b of mealPick.querySelectorAll("[data-meal]")) b.classList.toggle("on", (b.dataset.meal || null) === k);
      if (!k) return suggest();
      const range = S.trip.mealTimes[k];
      const length = MEAL_MINUTES[k];
      form.duration.value = String(length);
      const d = days.find((x) => x.id === form.dayId.value);
      const busy = (d?.activities ?? []).filter((a) => a.startMin !== null && a.role !== "start");
      const clash = (t) => busy.find((a) => t < a.startMin + a.durationMin && a.startMin < t + length);
      const tries = [range.usual];
      for (let step = 15; step <= 240; step += 15) tries.push(range.usual + step, range.usual - step);
      const free = tries.find((t) => t >= range.from && t + length <= range.to + 60 && t < range.to && !clash(t));
      const at = free ?? range.usual;
      form.start.value = hhmm(at);
      const span = `${hhmm(range.from)}–${hhmm(range.to)}`;
      hint.textContent =
        free === range.usual
          ? `${MEAL_LABEL[k]} usually ${span} on this trip.`
          : free !== undefined
            ? `${hhmm(range.usual)} overlaps ${clash(range.usual).title}, so ${hhmm(at)} is suggested instead (${MEAL_LABEL[k].toLowerCase()} usually ${span}).`
            : `${hhmm(at)} overlaps ${clash(at).title} and there's no free slot ${span}. Adjust the time, or keep both and sort it out on the timeline.`;
    }

    form.dayId.addEventListener("change", () => (meal ? pickMeal(meal) : suggest()));
    suggest();
    // open on the meal that fits the suggested time, if any
    if (dining) {
      const t = parseTime(form.start.value);
      const fits = Object.entries(S.trip.mealTimes).find(([, r]) => t >= r.from && t < r.to);
      pickMeal(fits ? fits[0] : null);
    }
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const btn = form.querySelector("[type=submit]");
      btn.disabled = true;
      error.hidden = true;
      const name = custom ? form.title.value.trim() || "Pinned spot" : title;
      try {
        const res = await act(
          api(`${base}/activities`, {
            method: "POST",
            body: { clientId, dayId: form.dayId.value, title: name, kind: dining ? "food" : kind, meal: dining ? meal : null, startMin: parseTime(form.start.value), durationMin: Number(form.duration.value), notes: form.notes.value.trim(), place },
          }),
          { quiet: true },
        );
        done();
        const dayIndex = days.findIndex((x) => x.id === form.dayId.value);
        if (form.dayId.value !== S.dayId) setDay(form.dayId.value);
        S.selectedId = res.activityId;
        S.hint = false;
        // from a map click: back to the nearby list, so exploring can go on;
        // a custom spot closes the panel; otherwise the place card stays open
        if (custom) closeSearch();
        else if (S.explore) {
          S.place = null;
          S.placeDetails = null;
        }
        render();
        toast(`Added ${name} to Day ${dayIndex + 1}.`, isPhone() ? { action: { label: "View plan", run: () => setTab("plan") } } : {});
      } catch (err) {
        error.textContent = err.message;
        error.hidden = false;
        btn.disabled = false;
      }
    });
    const dialog = openDialog(h("dialog", { class: "dialog schedule-card", "aria-label": `Add ${title} to the itinerary` }, form));
    // gone at once, not on the later "close" event, so a closed card never lingers
    const done = () => {
      dialog.close();
      dialog.remove();
    };
    (custom ? form.title : form.start).focus();
    return dialog;
  }

  function explorePanel() {
    const ex = S.explore;
    const noThumb = () => h("span", { class: "nearby-thumb nearby-thumb-empty", "aria-hidden": "true" }, icon("pin"));
    return h(
      "div",
      { class: "explore-panel" },
      h(
        "div",
        { class: "panel-head" },
        h("strong", {}, !ex.label ? "Around this spot" : /^near /i.test(ex.label) ? ex.label : `Around ${ex.label}`),
        h("button", { class: "icon-btn", type: "button", "aria-label": "Close", onclick: closeSearch }, icon("close")),
      ),
      h(
        "div",
        { class: "cat-chips xp-cats", role: "group", "aria-label": "Place type" },
        NEARBY.map(([t, label]) => h("button", { type: "button", class: `cat-chip${ex.type === t ? " on" : ""}`, "aria-pressed": String(ex.type === t), onclick: () => loadNearby(t) }, label)),
      ),
      ex.loading
        ? h("p", { class: "muted pad", role: "status" }, "Finding places nearby…")
        : ex.error
          ? h("p", { class: "form-error pad" }, ex.error)
          : !ex.results.length
            ? h("p", { class: "muted pad" }, ex.source === "demo" ? "Nearby places need Google Maps configured on the server." : "Nothing of this kind within 1.5 km. Try another category.")
            : h(
                "ul",
                { class: "results nearby" },
                ex.results.map((r) =>
                  h(
                    "li",
                    {},
                    h(
                      "button",
                      { type: "button", class: "result nearby-row", onclick: () => pickPlace(r) },
                      r.thumb
                        ? h("img", { class: "nearby-thumb", src: r.thumb.uri, alt: "", width: 56, height: 56, loading: "lazy", decoding: "async", onerror: (e) => e.currentTarget.replaceWith(noThumb()) })
                        : noThumb(),
                      h(
                        "span",
                        { class: "nearby-text" },
                        h("strong", {}, r.name),
                        h("span", { class: "muted" }, [r.category, typeof r.distanceKm === "number" ? km(r.distanceKm) : null].filter(Boolean).join(" · ")),
                        typeof r.rating === "number" && h("span", { class: "nearby-rating" }, `${r.rating.toFixed(1)} ★`, r.ratingCount ? h("span", { class: "muted" }, ` (${r.ratingCount.toLocaleString("en-AU")})`) : null),
                        r.thumb?.credit.length > 0 && h("small", { class: "photo-credit" }, `Photo: ${r.thumb.credit.join(", ")}`),
                      ),
                      visitsOf(r.placeId).length > 0 && h("span", { class: "tag tag-in" }, "In plan"),
                    ),
                  ),
                ),
              ),
      ex.source === "google" && ex.results.length > 0 && h("p", { class: "attrib", translate: "no" }, "Google Maps"),
      customSpotForm(ex),
    );
  }

  // A spot that isn't a listed place (a viewpoint, a meeting point): only
  // what's known about the location is shown, never business details, and
  // adding stores its coordinates with a custom: id, never a made-up Google id.
  function customSpotForm(ex) {
    return h(
      "div",
      { class: "add-form custom-spot" },
      h("p", { class: "small" }, h("strong", {}, "Not a listed place?"), " Add this exact spot, like a viewpoint or a meeting point."),
      h("p", { class: "muted small" }, ex.label ? `${/^near /i.test(ex.label) ? ex.label : `In ${ex.label}`} · ` : "", `${ex.lat.toFixed(5)}, ${ex.lng.toFixed(5)}`),
      h(
        "button",
        {
          class: "btn btn-ghost btn-sm btn-block",
          type: "button",
          onclick: () => {
            const name = ex.label && !/^near /i.test(ex.label) ? ex.label : "Pinned spot";
            const place = { placeId: `custom:${uid()}`, source: "custom", lat: ex.lat, lng: ex.lng };
            if (S.replacing) confirmReplace(place, name);
            else scheduleCard({ title: name, kind: "custom", custom: true, place });
          },
        },
        icon(S.replacing ? "pin" : "plus"),
        S.replacing ? `Use this spot for ${S.replacing.title}` : "Add this spot",
      ),
    );
  }

  // --- changing a stop's place ---
  // The stop keeps its id, time, length, notes and meal; only where it is
  // changes. Picking happens the usual ways (search, a place on the map, a
  // spot on the map), then the card's button says "Use for …".

  function beginReplace(a) {
    S.replacing = { id: a.id, version: a.version, title: a.title };
    S.starting = null;
    S.place = null;
    S.placeDetails = null;
    S.explore = null;
    S.results = [];
    if (isPhone()) setTab("map");
    renderSearch();
    renderMap();
    searchInput.focus();
  }

  function replacePanel() {
    return h(
      "div",
      { class: "start-panel" },
      h("div", { class: "panel-head" }, h("strong", {}, `New place for ${S.replacing.title}`), h("button", { class: "icon-btn", type: "button", "aria-label": "Cancel", onclick: closeSearch }, icon("close"))),
      h(
        "div",
        { class: "start-body" },
        h("p", {}, "Search above, click a place on the map, or click anywhere to use that exact spot."),
        h("p", { class: "muted small" }, "Its time, length, notes and meal stay as they are."),
      ),
    );
  }

  async function confirmReplace(place, title) {
    const r = S.replacing;
    try {
      const snap = await act(api(`${base}/activities/${r.id}/place`, { method: "PUT", body: { baseVersion: r.version, place, title } }), { quiet: true });
      S.replacing = null;
      closeSearch();
      S.selectedId = r.id;
      render();
      const a = snap.days.flatMap((d) => d.activities).find((x) => x.id === r.id);
      if (a?.place?.lat != null) map.focus(a.place);
      toast(`${r.title} is now ${title}.`);
    } catch (err) {
      if (err.status === 409 && err.data?.current) {
        S.replacing = { ...r, version: err.data.current.version, title: err.data.current.title };
        toast(`${err.message} Their version is on screen; choose again to replace it.`, { kind: "error" });
      } else toast(err.message, { kind: "error" });
      render();
    }
  }

  // --- the starting point ---

  const kmBetween = (a, b) => {
    const rad = Math.PI / 180;
    const x = Math.sin(((b.lat - a.lat) * rad) / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(((b.lng - a.lng) * rad) / 2) ** 2;
    return 12742 * Math.asin(Math.sqrt(x));
  };

  function beginStart() {
    S.starting = { step: "choose" };
    S.startBase = startOf()?.version ?? null;
    S.place = null;
    S.placeDetails = null;
    S.explore = null;
    S.results = [];
    if (isPhone()) setTab("map");
    renderSearch();
    renderMap();
    renderTimeline();
  }

  function startPanel() {
    const st = S.starting;
    const changing = Boolean(startOf());
    const google = map.kind === "google";
    const head = h(
      "div",
      { class: "panel-head" },
      h("strong", {}, changing ? "Change the starting point" : "Where would you like to start?"),
      h("button", { class: "icon-btn", type: "button", "aria-label": changing ? "Cancel" : "Skip for now", onclick: closeSearch }, icon("close")),
    );
    if (st.step === "confirm" && st.candidate) {
      const c = st.candidate;
      const away = S.trip.center && Number.isFinite(c.place.lat) ? kmBetween(c.place, S.trip.center) : 0;
      return h(
        "div",
        { class: "start-panel" },
        head,
        h(
          "div",
          { class: "start-body" },
          h("p", { class: "start-cand" }, h("span", { class: "start-badge" }, "Start"), h("strong", {}, c.title)),
          c.pending && h("p", { class: "muted small", role: "status" }, "Finding the name of this spot…"),
          st.message && h("p", { class: "leg-warn small", role: "alert" }, st.message),
          away > 150 && h("p", { class: "leg-warn small" }, `This is about ${Math.round(away).toLocaleString("en-AU")} km from ${S.trip.destination}. Fine if the trip really starts here; otherwise choose a start in ${S.trip.destination}.`),
          h(
            "div",
            { class: "row-actions" },
            h("button", { class: "btn btn-primary btn-sm", type: "button", disabled: Boolean(c.pending || st.saving), onclick: () => confirmStart(c) }, st.saving ? "Saving…" : "Start here"),
            google && h("button", { class: "btn btn-ghost btn-sm", type: "button", onclick: () => { S.starting = { step: "map" }; renderSearch(); renderMap(); } }, st.via === "map" ? "Choose again" : "Adjust on map"),
            h("button", { class: "btn btn-ghost btn-sm", type: "button", onclick: () => { S.starting = { step: "choose" }; renderSearch(); renderMap(); } }, "Other options"),
          ),
        ),
      );
    }
    if (st.step === "map") {
      return h(
        "div",
        { class: "start-panel" },
        head,
        h(
          "div",
          { class: "start-body" },
          h("p", {}, h("strong", {}, "Click the map where the trip starts."), " Click a place's icon to start there, or anywhere else to use that exact spot."),
          h("button", { class: "linklike small", type: "button", onclick: () => { S.starting = { step: "choose" }; renderSearch(); } }, "← Other options"),
        ),
      );
    }
    return h(
      "div",
      { class: "start-panel" },
      head,
      h(
        "div",
        { class: "start-options" },
        h(
          "button",
          { class: "start-option", type: "button", disabled: Boolean(st.locating), onclick: startFromMyLocation },
          icon("locate"),
          h("span", {}, h("strong", {}, st.locating ? "Finding your location…" : "Use my location"), h("small", {}, "Where you are right now")),
        ),
        h(
          "button",
          { class: "start-option", type: "button", disabled: !google, onclick: () => { S.starting = { step: "map" }; renderSearch(); } },
          icon("pin"),
          h("span", {}, h("strong", {}, "Choose on map"), h("small", {}, google ? "Click the spot on the map" : "Needs the Google map; search instead")),
        ),
        h(
          "button",
          { class: "start-option", type: "button", onclick: () => { S.starting = { step: "search" }; renderSearch(); searchInput.focus(); } },
          icon("search"),
          h("span", {}, h("strong", {}, "Search a location"), h("small", {}, "A hotel, station, airport or address")),
        ),
      ),
      st.message && h("p", { class: "form-error small start-body", role: "alert" }, st.message),
      st.step === "search" && h("p", { class: "muted small start-body" }, "Type in the search box above, then pick a result."),
      !changing && h("p", { class: "start-body" }, h("button", { class: "linklike small", type: "button", onclick: closeSearch }, "Skip for now")),
    );
  }

  async function considerStartSpot(at) {
    const c = { title: "Selected spot", pending: true, place: { placeId: `custom:${uid()}`, source: "custom", lat: at.lat, lng: at.lng } };
    S.starting = { step: "confirm", via: "map", candidate: c };
    renderSearch();
    renderMap();
    try {
      c.title = (await api(`/api/geo/reverse?lat=${at.lat}&lng=${at.lng}`)).label || "Selected spot";
    } catch {}
    c.pending = false;
    if (S.starting?.candidate === c) renderSearch();
  }

  async function considerStartPlace(p) {
    const c = { title: "Loading place…", pending: true, place: { placeId: p.placeId, source: "google", lat: p.lat, lng: p.lng } };
    S.starting = { step: "confirm", via: "map", candidate: c };
    renderSearch();
    renderMap();
    try {
      const b = await api(`/api/places/${encodeURIComponent(p.placeId)}?view=basic`);
      Object.assign(c, { title: b.name });
      Object.assign(c.place, { lat: b.lat, lng: b.lng });
      c.pending = false;
    } catch (err) {
      if (S.starting?.candidate === c) S.starting = { step: "map", message: err.message };
    }
    if (S.starting?.candidate === c || S.starting?.message) {
      renderSearch();
      renderMap();
    }
  }

  // the current location as a start: only on request, through the same
  // remembered permission the homepage uses
  function startFromMyLocation() {
    const say = (message) => {
      S.starting = { step: "choose", message };
      renderSearch();
    };
    let choice = null;
    try {
      choice = JSON.parse(localStorage.getItem("wayline.geo") ?? "null");
    } catch {}
    if (choice === "denied") return say("Location access is off for Wayline in this browser. Choose on the map or search for the start instead.");
    if (!navigator.geolocation) return say("This browser can't share its location. Choose on the map or search for the start instead.");
    S.starting = { step: "choose", locating: true };
    renderSearch();
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        if (!S.starting?.locating) return;
        try {
          localStorage.setItem("wayline.geo", JSON.stringify("allowed"));
        } catch {}
        const at = { lat: pos.coords.latitude, lng: pos.coords.longitude };
        await considerStartSpot(at);
        if (S.starting?.candidate) S.starting.via = "location";
        renderSearch();
        map.focus(at);
      },
      (err) => {
        if (!S.starting?.locating) return;
        if (err.code === 1) {
          try {
            localStorage.setItem("wayline.geo", JSON.stringify("denied"));
          } catch {}
          say("Location permission was denied. Choose on the map or search for the start instead.");
        } else say(err.code === 3 ? "Finding your location took too long. Try again, or choose on the map or search." : "Your location couldn't be determined. Choose on the map or search instead.");
      },
      { enableHighAccuracy: false, timeout: 10_000, maximumAge: 10 * 60_000 },
    );
  }

  async function confirmStart(c) {
    const changed = Boolean(startOf());
    if (S.starting) S.starting = { ...S.starting, saving: true };
    renderSearch();
    try {
      const res = await act(api(`${base}/start`, { method: "PUT", body: { clientId: uid(), title: c.title, place: c.place, baseVersion: S.startBase } }));
      S.starting = null;
      S.place = null;
      S.placeDetails = null;
      S.results = [];
      S.explore = null;
      searchPanel.hidden = true;
      S.hint = true;
      const first = S.trip.days[0];
      if (first && S.dayId !== first.id) setDay(first.id);
      S.selectedId = res.activityId;
      render();
      if (Number.isFinite(c.place.lat)) map.focus(c.place);
      toast(changed ? `Starting from ${c.title}.` : "Starting point set.");
    } catch (err) {
      if (err.status === 409 && S.starting) {
        // their start is now on screen; pressing again replaces it on purpose
        const theirs = err.data?.current;
        S.startBase = theirs?.version ?? null;
        S.starting = { ...S.starting, saving: false, message: theirs ? `A collaborator just set the start to ${theirs.title}. Press "Start here" again to replace it.` : "A collaborator just removed the start. Press \"Start here\" again to set yours." };
      } else if (S.starting) S.starting = { ...S.starting, saving: false };
      renderSearch();
    }
  }

  function suggestStart(d) {
    const timed = (d?.activities ?? []).filter((a) => a.startMin !== null);
    if (!timed.length) return 9 * 60;
    const last = Math.max(...timed.map((a) => a.startMin + a.durationMin));
    return Math.min(Math.ceil(last / 15) * 15, 23 * 60 + 45);
  }

  // --- actions ---

  function select(id, { scroll = false, focusMap = false } = {}) {
    S.selectedId = id;
    render();
    const a = day()?.activities.find((x) => x.id === id);
    if (focusMap && a?.place?.lat != null) {
      map.focus(a.place);
      if (isPhone()) setTab("map");
    }
    if (scroll) timeline.querySelector(`[data-id="${id}"]`)?.scrollIntoView({ block: "center", behavior: "smooth" });
  }

  const move = (id, dayId, index) =>
    act(api(`${base}/activities/${id}/move`, { method: "POST", body: { dayId, index: Math.max(0, index) } })).then(
      () => timeline.querySelector(`[data-id="${id}"] .stop-card`)?.focus({ preventScroll: true }),
      () => {},
    );

  async function removeActivity(a) {
    if (!confirm(`Remove ${a.title} from the itinerary?`)) return;
    await act(api(`${base}/activities/${a.id}`, { method: "DELETE" })).catch(() => {});
  }

  async function calcRoute(prev, next, force) {
    const key = `${prev.id}>${next.id}`;
    S.busyLegs.add(key);
    renderTimeline();
    try {
      await act(api(`${base}/routes`, { method: "POST", body: { fromId: prev.id, toId: next.id, force } }));
    } catch {}
    S.busyLegs.delete(key);
    renderTimeline();
  }

  // --- copilot ---
  // Rule-based checks come from the server's schedule analysis and are
  // always shown. AI answers are this tab's own conversation about one day;
  // each is tied to the day fingerprint it analysed and marked stale when
  // the day changes. Model text is rendered as text, never HTML.

  const EXAMPLES = ["Is this morning too rushed?", "Why is there a conflict before lunch?", "Which fix gives us more time at the first stop?", "Summarize this day."];
  // the page is English; a question in Chinese gets a Chinese answer (decided on the server)
  const pageLang = () => (/^zh/i.test(document.documentElement.lang || "") ? "zh" : "en");
  const convo = (dayId) => {
    if (!S.ai.has(dayId)) S.ai.set(dayId, { turns: [] });
    return S.ai.get(dayId);
  };

  // Facts shown beside AI text: computed from the server snapshot, not the model.
  function dayFacts(d) {
    const timed = d.activities.filter((a) => a.startMin !== null);
    const first = timed[0];
    const last = timed.reduce((m, a) => (m && m.startMin + m.durationMin >= a.startMin + a.durationMin ? m : a), null);
    const { issues, gaps } = d.analysis;
    const parts = [`${d.activities.length} stop${d.activities.length === 1 ? "" : "s"}`];
    if (first && last) parts.push(`${hhmm(first.startMin)}–${hhmm(last.startMin + last.durationMin)}`);
    const conflicts = issues.filter((i) => i.severity === "conflict").length;
    const warnings = issues.length - conflicts;
    parts.push(issues.length ? [conflicts && `${conflicts} conflict${conflicts === 1 ? "" : "s"}`, warnings && `${warnings} warning${warnings === 1 ? "" : "s"}`].filter(Boolean).join(", ") : "no timing issues");
    const unrouted = gaps.filter((g) => g.status === "not_calculated").length;
    const stale = gaps.filter((g) => g.status === "stale").length;
    if (unrouted) parts.push(`${unrouted} route${unrouted === 1 ? "" : "s"} not calculated`);
    if (stale) parts.push(`${stale} route${stale === 1 ? "" : "s"} out of date`);
    return parts.join(" · ");
  }

  function renderCopilot() {
    const d = day();
    if (!d) return copilotPane.replaceChildren();
    const idx = S.trip.days.indexOf(d);
    const { issues, proposals, gaps } = d.analysis;
    const unrouted = gaps.filter((g) => g.status === "not_calculated").length;
    const stale = gaps.filter((g) => g.status === "stale").length;
    const visible = issues.filter((x) => !S.dismissed.has(`${x.id}@${S.trip.rev}`) && !S.dismissed.has(x.id));

    copilotPane.replaceChildren(
      h(
        "div",
        { class: "copilot-head" },
        h("h2", {}, icon("spark"), "Copilot"),
        h("button", { class: "icon-btn hide-phone", type: "button", "aria-label": "Close copilot", onclick: () => { S.copilotOpen = false; render(); } }, icon("close")),
      ),
      h("p", { class: "co-day", "data-testid": "copilot-day" }, "Discussing ", h("b", {}, `Day ${idx + 1} · ${fmtDay(d.date)}`)),
      h(
        "section",
        { class: "co-section" },
        h("h3", {}, "Schedule check ", h("span", { class: "tag tag-rule" }, "Rule-based")),
        h("p", { class: "muted small co-facts" }, dayFacts(d)),
        visible.length === 0 &&
          h(
            "p",
            { class: "co-ok" },
            issues.length ? "Every issue on this day has been kept as planned." : d.activities.length < 2 ? "Add at least two stops to check the timing between them." : "No timing conflicts on this day.",
          ),
        unrouted > 0 && h("p", { class: "muted small" }, `${unrouted} connection${unrouted === 1 ? " hasn't" : "s haven't"} been routed yet, so travel time isn't checked there.`),
        stale > 0 && h("p", { class: "muted small" }, `${stale} route${stale === 1 ? " was" : "s were"} calculated for different times. Recalculate to check them properly.`),
        visible.map((x) =>
          h(
            "div",
            { class: `issue issue-${x.severity}` },
            h("p", { class: "issue-msg" }, x.message),
            h(
              "div",
              { class: "proposals" },
              proposals.filter((p) => p.issueId === x.id).map((p) => proposalCard(d, p, { basedOn: d.fingerprint })),
              h("button", { class: "btn btn-ghost btn-sm", type: "button", onclick: () => { S.dismissed.add(x.id); renderCopilot(); } }, "Keep the plan as it is"),
            ),
          ),
        ),
      ),
      aiSection(d),
    );
    const log = copilotPane.querySelector(".co-log");
    if (log && S.aiScroll) {
      log.lastElementChild?.scrollIntoView({ block: "nearest" });
      S.aiScroll = false;
    }
  }

  // basedOn: the day fingerprint this preview was built from; the server
  // refuses (409) if the day has changed since.
  function proposalCard(d, p, { rationale = null, basedOn, staleNote = null, keyPrefix = "rule" } = {}) {
    const nameOf = (id) => d.activities.find((a) => a.id === id)?.title ?? "Activity";
    const seg = (id) => d.segments.find((s) => s.id === id);
    const key = `${keyPrefix}:${basedOn}:${p.id}`;
    const preview = p.changes.map((c) =>
      c.type === "activity"
        ? h(
            "li",
            {},
            `${nameOf(c.activityId)}: ${c.field === "startMin" ? "start" : "duration"} `,
            h("s", {}, c.field === "startMin" ? hhmm(c.from) : dur(c.from)),
            " → ",
            h("b", {}, c.field === "startMin" ? hhmm(c.to) : dur(c.to)),
          )
        : h(
            "li",
            {},
            `${nameOf(seg(c.segmentId)?.fromId)} → ${nameOf(seg(c.segmentId)?.toId)}: `,
            h("s", {}, MODE_LABEL[c.from] ?? "none"),
            " → ",
            h("b", {}, MODE_LABEL[c.to]),
          ),
    );
    const confirming = S.confirming === key;
    const apply = async (e) => {
      e.currentTarget.disabled = true;
      try {
        await act(api(`${base}/proposals/apply`, { method: "POST", body: { dayId: d.id, proposalId: p.id, basedOn } }), { quiet: true });
        toast("Change applied.");
      } catch (err) {
        toast(err.status === 409 ? "The plan changed since this was shown, so nothing was applied. Check the updated day." : err.message, { kind: "error" });
      }
      S.confirming = null;
      renderCopilot();
    };
    return h(
      "div",
      { class: `proposal${rationale ? " proposal-ai" : ""}`, "data-proposal": p.id },
      rationale && h("p", { class: "ai-badge" }, icon("spark"), "Suggested by AI"),
      h("p", { class: "proposal-label" }, p.label),
      h("ul", { class: "change-preview", "aria-label": "Changes this will make" }, preview),
      rationale && h("p", { class: "ai-text" }, rationale),
      staleNote
        ? h("p", { class: "small leg-warn" }, staleNote)
        : confirming
          ? h(
              "div",
              { class: "row-actions", role: "group", "aria-label": "Confirm change" },
              h("span", { class: "small" }, "Apply this for everyone on the trip?"),
              h("button", { class: "btn btn-primary btn-sm", type: "button", "data-confirm": "yes", onclick: apply }, "Confirm change"),
              h("button", { class: "btn btn-ghost btn-sm", type: "button", onclick: () => { S.confirming = null; renderCopilot(); } }, "Cancel"),
            )
          : h("button", { class: "btn btn-primary btn-sm", type: "button", "data-apply": p.id, onclick: () => { S.confirming = key; renderCopilot(); } }, "Apply this change…"),
    );
  }

  function aiSection(d) {
    const cfg = ctx.config.ai;
    const head = h("h3", {}, "Ask about this day ", h("span", { class: "tag tag-ai" }, cfg.configured ? "AI" : "Unavailable"));
    if (!cfg.configured) {
      return h("section", { class: "co-section" }, head, h("p", { class: "muted small" }, "AI answers aren't available on this server. The schedule check above works without it, and so does editing."));
    }
    const c = convo(d.id);
    const pending = S.aiPending?.dayId === d.id ? S.aiPending : null;
    const busy = Boolean(S.aiPending);
    const input = h("textarea", {
      class: "co-input",
      name: "question",
      rows: 2,
      maxlength: 500,
      placeholder: "Ask about this day, e.g. “Is this morning too rushed?”",
      "aria-label": `Ask the copilot about Day ${S.trip.days.indexOf(d) + 1}`,
      disabled: busy,
    });
    input.value = S.aiDraft;
    input.addEventListener("input", () => (S.aiDraft = input.value));
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey && !e.isComposing) {
        e.preventDefault();
        form.requestSubmit();
      }
    });
    const form = h(
      "form",
      { class: "co-ask" },
      input,
      h("div", { class: "co-ask-row" }, h("span", { class: "tiny muted" }, "Only this day’s plan is sent to the AI. It can’t change anything."), h("button", { class: "btn btn-dark btn-sm", type: "submit", disabled: busy }, "Ask")),
    );
    form.addEventListener("submit", (e) => {
      e.preventDefault();
      const q = input.value.trim();
      if (q) askAi(d, q);
    });

    return h(
      "section",
      { class: "co-section co-ai" },
      head,
      h(
        "div",
        { class: "row-actions" },
        h("button", { class: "btn btn-dark btn-sm", type: "button", disabled: busy, "data-ai": "review", onclick: () => askAi(d, "") }, icon("spark"), "Review this day"),
        c.turns.length > 0 && h("button", { class: "btn btn-ghost btn-sm", type: "button", disabled: busy, onclick: () => { c.turns = []; renderCopilot(); } }, "Clear conversation"),
      ),
      c.turns.length === 0 && !pending && h("div", { class: "co-examples" }, EXAMPLES.map((q) => h("button", { class: "chip chip-soft", type: "button", disabled: busy, onclick: () => askAi(d, q) }, q))),
      h("ol", { class: "co-log", "aria-live": "polite" }, c.turns.map((t) => turnView(d, t, c))),
      pending &&
        h(
          "div",
          { class: "co-pending", role: "status" },
          h("span", { class: "spinner", "aria-hidden": "true" }),
          h("span", {}, pending.question ? "Thinking about your question…" : "Reviewing this day…"),
          h("button", { class: "btn btn-ghost btn-sm", type: "button", "data-ai": "cancel", onclick: () => pending.controller.abort() }, "Cancel"),
        ),
      form,
    );
  }

  function turnView(d, t, c) {
    const q = h("p", { class: "co-q" }, t.question || "Review this day");
    if (t.error) {
      return h(
        "li",
        { class: "co-turn" },
        q,
        h(
          "div",
          { class: "co-err", role: "alert" },
          h("p", { class: "form-error small" }, t.error),
          t.retry && h("button", { class: "btn btn-ghost btn-sm", type: "button", "data-ai": "retry", disabled: Boolean(S.aiPending), onclick: () => { c.turns.splice(c.turns.indexOf(t), 1); askAi(d, t.question); } }, "Try again"),
        ),
      );
    }
    const r = t.res;
    const isStale = r.fingerprint !== d.fingerprint;
    const byId = (id) => d.activities.find((a) => a.id === id);
    const issueById = (id) => d.analysis.issues.find((i) => i.id === id);
    const proposalById = (id) => d.analysis.proposals.find((p) => p.id === id);
    return h(
      "li",
      { class: `co-turn${isStale ? " ai-stale" : ""}`, "data-stale": String(isStale) },
      q,
      h(
        "div",
        { class: "ai-card" },
        isStale && h("p", { class: "small leg-warn", role: "status" }, "The plan has changed since this answer. It may be out of date; ask again for a fresh one."),
        h("p", { class: "ai-label tiny" }, icon("spark"), "AI interpretation"),
        h("p", { class: "ai-summary", lang: r.lang === "zh" ? "zh" : "en" }, r.answer.summary),
        r.answer.activities.length > 0 &&
          h(
            "ul",
            { class: "co-refs", "aria-label": "Stops this answer refers to" },
            r.answer.activities.map((a) => {
              const act = byId(a.activityId);
              return h(
                "li",
                {},
                act
                  ? h("button", { class: "linklike small", type: "button", onclick: () => { select(act.id, { scroll: true }); if (isPhone()) setTab("plan"); } }, act.title, act.startMin !== null ? ` (${hhmm(act.startMin)})` : "")
                  : h("span", { class: "small muted" }, "A stop that's no longer in the plan"),
                h("span", { class: "small" }, ` ${a.note}`),
              );
            }),
          ),
        r.answer.issues.map((i) => {
          const issue = issueById(i.issueId);
          return h("div", { class: "co-issue" }, issue && h("p", { class: "small issue-msg" }, issue.message), h("p", { class: "ai-text" }, i.explanation));
        }),
        r.answer.recommendations.map((rec) => {
          const p = proposalById(rec.proposalId);
          if (!p) return h("p", { class: "small muted" }, "A suggested fix no longer applies to the current plan.");
          return proposalCard(d, p, { rationale: rec.rationale, basedOn: r.fingerprint, keyPrefix: "ai", staleNote: isStale ? "Ask again before applying: the plan changed after this suggestion." : null });
        }),
        r.answer.caveats.length > 0 && h("ul", { class: "small muted" }, r.answer.caveats.map((x) => h("li", {}, x))),
        h("p", { class: "tiny muted" }, `Schedule facts: ${t.facts}. Interpretation by ${r.model}${r.cached ? " (same plan and question as before, so not asked again)" : ""}. AI can be wrong; check before applying.`),
      ),
    );
  }

  async function askAi(d, question) {
    if (S.aiPending) return;
    const c = convo(d.id);
    const history = c.turns.filter((t) => t.res && t.res.fingerprint === d.fingerprint && t.question).slice(-4).map((t) => ({ q: t.question, a: t.res.answer.summary }));
    const controller = new AbortController();
    S.aiPending = { dayId: d.id, question, controller };
    if (question) S.aiDraft = "";
    renderCopilot();
    const facts = dayFacts(d);
    try {
      const res = await fetch(`${base}/copilot`, {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ dayId: d.id, question, history, lang: pageLang() }),
        signal: controller.signal,
      });
      const data = await res.json().catch(() => ({}));
      if (res.status === 401) return ctx.signOut();
      if (!res.ok) c.turns.push({ question, error: data.error ?? "The copilot couldn't answer just now.", retry: data.retry !== false });
      else c.turns.push({ question, res: data, facts });
    } catch {
      if (controller.signal.aborted) {
        if (question) S.aiDraft = question; // give the question back to edit
      } else c.turns.push({ question, error: "You seem to be offline. Try again when you're connected.", retry: true });
    }
    if (c.turns.length > 12) c.turns.splice(0, c.turns.length - 12);
    S.aiPending = null;
    S.aiScroll = true;
    renderCopilot();
  }

  // --- dialogs ---

  // focus: "start" opens on the time (to move a timed stop); note: why it opened
  function activityDialog({ activity, focus = null, note = null }) {
    const isNew = !activity;
    let baseVersion = activity?.version ?? null;
    const d = activity ? S.trip.days.find((x) => x.id === activity.dayId) : day();
    const clientId = uid();
    const banner = h("div", { class: "banner", role: "alert", hidden: true });
    const error = h("p", { class: "form-error", role: "alert", hidden: true });
    const timed = h("input", { type: "checkbox", name: "timed", checked: activity ? activity.startMin !== null : true });
    // which meal, for food stops only
    const mealField = h(
      "label",
      { class: "field" },
      h("span", {}, "Meal"),
      h("select", { name: "meal" }, h("option", { value: "" }, "Not a meal"), Object.entries(MEAL_LABEL).map(([k, v]) => h("option", { value: k, selected: k === activity?.meal }, v))),
    );
    const form = h(
      "form",
      { method: "dialog", class: "stack" },
      h("h2", {}, isNew ? "Add an activity" : "Edit activity"),
      note && h("p", { class: "muted small" }, note),
      banner,
      activity?.place && h("p", { class: "muted small" }, activity.place.source === "demo" ? "Demo place" : "Linked to a Google Maps place"),
      h("label", { class: "field" }, h("span", {}, "Title"), h("input", { name: "title", required: true, maxlength: 120, value: activity?.title ?? "", placeholder: "Picnic in the park" })),
      h(
        "div",
        { class: "row-2" },
        h("label", { class: "field" }, h("span", {}, "Type"), h("select", { name: "kind" }, Object.entries(KIND_LABEL).map(([k, v]) => h("option", { value: k, selected: k === (activity?.kind ?? "custom") }, v)))),
        h("label", { class: "field" }, h("span", {}, "Day"), h("select", { name: "dayId" }, S.trip.days.map((x, i) => h("option", { value: x.id, selected: x.id === d?.id }, `Day ${i + 1} · ${fmtDay(x.date)}`)))),
      ),
      h(
        "div",
        { class: "row-2" },
        h(
          "div",
          { class: "field" },
          h("label", { class: "check" }, timed, h("span", {}, "Set a start time")),
          h("input", { name: "start", type: "time", step: 300, "aria-label": "Start time", value: hhmm(activity?.startMin ?? suggestStart(d)) }),
        ),
        h(
          "label",
          { class: "field" },
          h("span", {}, "Duration (minutes)"),
          h(
            "span",
            { class: "stepper" },
            h("button", { type: "button", class: "icon-btn", "aria-label": "15 minutes shorter", onclick: () => bump(-15) }, "−"),
            h("input", { name: "duration", type: "number", min: 5, max: 1440, step: 5, required: true, value: activity?.durationMin ?? 60 }),
            h("button", { type: "button", class: "icon-btn", "aria-label": "15 minutes longer", onclick: () => bump(15) }, "+"),
          ),
        ),
      ),
      mealField,
      h("label", { class: "field" }, h("span", {}, "Notes"), h("textarea", { name: "notes", rows: 3, maxlength: 2000, placeholder: "Booking reference, what to bring, who's paying…" }, activity?.notes ?? "")),
      error,
      h(
        "div",
        { class: "dialog-actions" },
        !isNew && h("button", { class: "btn btn-ghost btn-danger-text", type: "button", onclick: async () => { dialog.close(); await removeActivity(current() ?? activity); } }, "Remove"),
        h("span", { class: "spacer" }),
        h("button", { class: "btn btn-ghost", type: "button", onclick: () => dialog.close() }, "Cancel"),
        h("button", { class: "btn btn-primary", type: "submit" }, isNew ? "Add" : "Save"),
      ),
    );
    const syncTimed = () => (form.start.disabled = !timed.checked);
    timed.addEventListener("change", syncTimed);
    syncTimed();
    const syncMeal = () => (mealField.hidden = form.kind.value !== "food");
    form.kind.addEventListener("change", syncMeal);
    syncMeal();
    function bump(n) {
      form.duration.value = String(Math.min(1440, Math.max(5, (Number(form.duration.value) || 0) + n)));
    }
    const current = () => S.trip.days.flatMap((x) => x.activities).find((a) => a.id === activity?.id);

    const fill = (a) => {
      form.title.value = a.title;
      form.kind.value = a.kind;
      timed.checked = a.startMin !== null;
      form.start.value = hhmm(a.startMin ?? suggestStart(d));
      form.duration.value = String(a.durationMin);
      form.notes.value = a.notes;
      form.dayId.value = a.dayId;
      form.meal.value = a.meal ?? "";
      syncTimed();
      syncMeal();
    };

    const showConflict = (theirs, message) => {
      banner.hidden = false;
      banner.replaceChildren(
        h("p", {}, message ?? `${memberName(theirs.updatedBy)} changed this activity while you were editing.`),
        h(
          "div",
          { class: "banner-actions" },
          h("button", { class: "btn btn-sm btn-outline", type: "button", onclick: () => { fill(theirs); baseVersion = theirs.version; banner.hidden = true; } }, "Load their version"),
          h("button", { class: "btn btn-sm btn-ghost", type: "button", onclick: () => { baseVersion = theirs.version; banner.hidden = true; form.requestSubmit(); } }, "Save mine over theirs"),
        ),
      );
    };

    const dialog = openDialog(h("dialog", { class: "dialog" }, form));
    if (focus === "start") {
      timed.checked = true;
      syncTimed();
      form.start.focus();
    }
    S.editing = {
      onSnapshot() {
        if (isNew) return;
        const now = current();
        if (!now) {
          banner.hidden = false;
          banner.replaceChildren(h("p", {}, "Someone removed this activity while you were editing it."));
          form.querySelector("[type=submit]").disabled = true;
        } else if (now.version !== baseVersion && now.updatedBy !== me.id) {
          showConflict(now, `${memberName(now.updatedBy)} just changed this activity.`);
        }
      },
    };
    dialog.addEventListener("close", () => (S.editing = null));

    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      error.hidden = true;
      const fields = {
        title: form.title.value,
        kind: form.kind.value,
        startMin: timed.checked ? parseTime(form.start.value) : null,
        durationMin: Number(form.duration.value),
        notes: form.notes.value,
        meal: form.kind.value === "food" ? form.meal.value || null : null,
      };
      const btn = form.querySelector("[type=submit]");
      btn.disabled = true;
      try {
        if (isNew) {
          await act(api(`${base}/activities`, { method: "POST", body: { clientId, dayId: form.dayId.value, ...fields } }), { quiet: true });
          if (form.dayId.value !== S.dayId) setDay(form.dayId.value);
        } else {
          const snap = await act(api(`${base}/activities/${activity.id}`, { method: "PATCH", body: { baseVersion, ...fields } }), { quiet: true });
          baseVersion = snap.days.flatMap((x) => x.activities).find((a) => a.id === activity.id)?.version ?? baseVersion;
          if (form.dayId.value !== activity.dayId) await move(activity.id, form.dayId.value, 9999);
        }
        dialog.close();
      } catch (err) {
        btn.disabled = false;
        if (err.status === 409 && err.data.current) showConflict(err.data.current);
        else {
          error.textContent = err.message;
          error.hidden = false;
        }
      }
    });
  }

  function shareDialog() {
    const isOwner = role() === "owner";
    const linkBox = h("div", { class: "stack" });
    const renderLink = (token) => {
      const t = S.trip;
      linkBox.replaceChildren();
      if (!isOwner) return;
      if (token) {
        const url = `${location.origin}/join/${token}`;
        const input = h("input", { readonly: true, value: url, "aria-label": "Invite link", onfocus: (e) => e.target.select() });
        linkBox.append(
          h("p", { class: "small" }, "Anyone signed in with this link can join as a collaborator. It's shown only now; create a new one later if you need it again (the old link then stops working)."),
          h("div", { class: "copy-row" }, input, h("button", { class: "btn btn-primary btn-sm", type: "button", onclick: async () => { await navigator.clipboard?.writeText(url).catch(() => {}); input.select(); toast("Invite link copied."); } }, "Copy")),
        );
      } else if (t.hasInvite) {
        linkBox.append(h("p", { class: "small muted" }, "An invite link is active. For safety it can't be shown again."));
      } else {
        linkBox.append(h("p", { class: "small muted" }, "Create a private link to invite someone to edit this trip with you."));
      }
      linkBox.append(
        h(
          "div",
          { class: "row-actions" },
          h("button", { class: "btn btn-outline btn-sm", type: "button", onclick: async () => { const { token } = await act(api(`${base}/invite`, { method: "POST", body: {} })); renderLink(token); } }, t.hasInvite || token ? "Create a new link" : "Create invite link"),
          (t.hasInvite || token) && h("button", { class: "btn btn-ghost btn-sm", type: "button", onclick: async () => { await act(api(`${base}/invite`, { method: "DELETE" })); toast("Invite link turned off."); renderLink(null); } }, "Turn off link"),
        ),
      );
    };
    const list = h("ul", { class: "members" });
    const renderMembers = () =>
      list.replaceChildren(
        ...S.trip.members.map((m) =>
          h(
            "li",
            {},
            avatar(m),
            h("span", { class: "grow" }, h("strong", {}, m.displayName), m.id === me.id && " (you)", h("br"), h("small", { class: "muted" }, m.role === "owner" ? "Owner" : "Collaborator")),
            S.presence.some((p) => p.id === m.id) && h("span", { class: "chip chip-live" }, "Here now"),
            m.role !== "owner" &&
              (isOwner || m.id === me.id) &&
              h(
                "button",
                {
                  class: "btn btn-ghost btn-sm btn-danger-text",
                  type: "button",
                  onclick: async () => {
                    if (!confirm(m.id === me.id ? "Leave this trip?" : `Remove ${m.displayName} from this trip?`)) return;
                    await act(api(`${base}/members/${m.id}`, { method: "DELETE" })).catch(() => {});
                    if (m.id === me.id) ctx.navigate("/", { replace: true });
                    else renderMembers();
                  },
                },
                m.id === me.id ? "Leave" : "Remove",
              ),
          ),
        ),
      );
    renderMembers();
    renderLink(null);

    // --- invite by username: search, choose, then an explicit Invite ---
    const STATUS = { you: "You", member: "Already a member", invited: "Invited", available: null };
    const nameInput = h("input", { type: "search", class: "invitee-input", placeholder: "Search by username", "aria-label": "Search by username", autocomplete: "off", spellcheck: "false", autocapitalize: "none", maxlength: 33 });
    const results = h("ul", { class: "invitee-results", role: "listbox", "aria-label": "Matching accounts" });
    const searchNote = h("p", { class: "small muted", role: "status", "aria-live": "polite" }, "Type at least 2 characters of their username.");
    const sent = h("ul", { class: "invitations" });
    let chosen = null;
    let seq = 0;
    let timer = null;
    const inviteBtn = h("button", { class: "btn btn-primary btn-sm", type: "button", "data-share": "invite", disabled: true }, "Invite");
    const choose = (r) => {
      chosen = r;
      for (const li of results.children) li.setAttribute("aria-selected", String(li.dataset.user === r?.id));
      inviteBtn.disabled = !r || r.status !== "available";
      inviteBtn.textContent = r ? (r.status === "available" ? `Invite @${r.username}` : STATUS[r.status]) : "Invite";
    };
    const resultRow = (r) =>
      h(
        "li",
        {
          class: "invitee",
          role: "option",
          tabindex: 0,
          "aria-selected": "false",
          "data-user": r.id,
          "aria-disabled": String(r.status !== "available"),
          onclick: () => choose(r),
          onkeydown: (e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), choose(r)),
        },
        avatar(r, "sm"),
        h("span", { class: "grow" }, h("strong", {}, r.displayName), h("br"), h("small", { class: "muted" }, `@${r.username}`)),
        STATUS[r.status] && h("span", { class: `chip ${r.status === "invited" ? "chip-soft" : ""}` }, STATUS[r.status]),
      );
    const search = () => {
      clearTimeout(timer);
      choose(null);
      const q = nameInput.value.trim().replace(/^@/, "");
      if (q.length < 2) {
        seq++;
        results.replaceChildren();
        searchNote.textContent = "Type at least 2 characters of their username.";
        return;
      }
      searchNote.textContent = "Searching…";
      timer = setTimeout(async () => {
        const mine = ++seq;
        try {
          const r = await api(`${base}/invitees?${new URLSearchParams({ q })}`);
          if (mine !== seq) return; // a newer search is on its way
          results.replaceChildren(...r.results.map(resultRow));
          searchNote.textContent = r.results.length ? "Choose an account, then press Invite." : `No account matches “${q}”.`;
        } catch (err) {
          if (mine !== seq) return;
          results.replaceChildren();
          searchNote.textContent = err.message;
        }
      }, 300);
    };
    nameInput.addEventListener("input", search);
    const LABEL = { pending: "Invited", accepted: "Accepted", declined: "Declined", cancelled: "Cancelled" };
    const loadSent = async () => {
      try {
        const { invitations } = await api(`${base}/invitations`);
        sent.replaceChildren(
          ...invitations.map((i) =>
            h(
              "li",
              { "data-invitation": i.id },
              avatar(i.user, "sm"),
              h("span", { class: "grow" }, h("strong", {}, i.user.displayName), h("br"), h("small", { class: "muted" }, `@${i.user.username}`)),
              h("span", { class: `chip ${i.status === "accepted" ? "chip-live" : "chip-soft"}`, "data-status": i.status }, LABEL[i.status]),
              i.status === "pending" &&
                h(
                  "button",
                  {
                    class: "btn btn-ghost btn-sm",
                    type: "button",
                    "data-share": "cancel",
                    "aria-label": `Cancel the invitation to @${i.user.username}`,
                    onclick: async (e) => {
                      e.target.disabled = true;
                      await api(`${base}/invitations/${i.id}`, { method: "DELETE" }).catch((err) => toast(err.message, { kind: "error" }));
                      loadSent();
                      if (nameInput.value.trim().length >= 2) search();
                    },
                  },
                  "Cancel",
                ),
            ),
          ),
        );
      } catch {
        // the list is a convenience; the invitations themselves are safe
      }
    };
    inviteBtn.addEventListener("click", async () => {
      if (!chosen || chosen.status !== "available") return;
      const who = chosen;
      inviteBtn.disabled = true;
      try {
        await api(`${base}/invitations`, { method: "POST", body: { userId: who.id } });
        // the search is done with; the sent list below keeps the "Invited" state
        seq++;
        nameInput.value = "";
        results.replaceChildren();
        choose(null);
        searchNote.textContent = `Invitation sent to ${who.displayName} (@${who.username}). They'll see it in My Trips.`;
        await loadSent();
      } catch (err) {
        searchNote.textContent = err.message;
        if (err.status === 409) search();
        else inviteBtn.disabled = false;
      }
    });
    const byName = isOwner && h(
      "section",
      { class: "share-method", "aria-labelledby": "share-by-name" },
      h("h3", { id: "share-by-name" }, "Invite by username"),
      h("p", { class: "small muted" }, "Send an invitation to someone who already has a Wayline account. They join when they accept it in My Trips."),
      h("div", { class: "invitee-search" }, nameInput, inviteBtn),
      searchNote,
      results,
      sent,
    );
    const byLink = isOwner && h(
      "section",
      { class: "share-method", "aria-labelledby": "share-by-link" },
      h("h3", { id: "share-by-link" }, "Invite by link"),
      linkBox,
    );
    if (isOwner) loadSent();
    // someone accepted while this was open: their status and the member list follow
    const onSnap = () => {
      if (!dialog.open) return events.removeEventListener("snapshot", onSnap);
      renderMembers();
      if (isOwner) loadSent();
    };
    events.addEventListener("snapshot", () => setTimeout(onSnap, 0));

    const dialog = openDialog(
      h(
        "dialog",
        { class: "dialog dialog-share" },
        h(
          "div",
          { class: "stack" },
          h("h2", {}, "People on this trip"),
          list,
          h("p", { class: "small muted", "data-share": "view-note" }, "While others have this trip open, they see roughly where your map is looking (its centre and zoom, never your location), and you see theirs. Your “My spot” stays on your screen only."),
          isOwner ? byName : h("p", { class: "small muted" }, "Only the owner can invite people."),
          byLink,
          h("div", { class: "dialog-actions" }, h("button", { class: "btn btn-primary", type: "button", onclick: () => dialog.close() }, "Done")),
        ),
      ),
    );
  }

  function settingsDialog() {
    const t = S.trip;
    const error = h("p", { class: "form-error", role: "alert", hidden: true });
    const form = h(
      "form",
      { method: "dialog", class: "stack" },
      h("h2", {}, "Trip settings"),
      h("label", { class: "field" }, h("span", {}, "Trip name"), h("input", { name: "title", required: true, maxlength: 80, value: t.title })),
      h("label", { class: "field" }, h("span", {}, "Destination"), h("input", { name: "destination", required: true, maxlength: 120, value: t.destination })),
      h(
        "div",
        { class: "row-2" },
        h("label", { class: "field" }, h("span", {}, "From"), h("input", { name: "startDate", type: "date", required: true, value: t.startDate })),
        h("label", { class: "field" }, h("span", {}, "To"), h("input", { name: "endDate", type: "date", required: true, value: t.endDate })),
      ),
      h("p", { class: "small muted" }, `Time zone: ${t.timezone}`),
      // usual meal times for this trip: suggestions when adding somewhere to eat
      h(
        "details",
        { class: "meal-times" },
        h("summary", {}, "Meal times"),
        h("p", { class: "small muted" }, "Used to suggest a time when someone adds a place to eat. Times stay editable when adding."),
        h(
          "table",
          { class: "meal-table" },
          h("thead", {}, h("tr", {}, h("th", {}, ""), h("th", {}, "From"), h("th", {}, "Usual"), h("th", {}, "To"))),
          h(
            "tbody",
            {},
            Object.entries(MEAL_LABEL).map(([k, label]) =>
              h(
                "tr",
                {},
                h("th", { scope: "row" }, label),
                ...["from", "usual", "to"].map((f) => h("td", {}, h("input", { type: "time", step: 300, name: `meal-${k}-${f}`, required: true, "aria-label": `${label} ${f}`, value: hhmm(t.mealTimes[k][f]) }))),
              ),
            ),
          ),
        ),
      ),
      error,
      h(
        "div",
        { class: "dialog-actions" },
        h(
          "button",
          {
            class: "btn btn-ghost btn-danger-text",
            type: "button",
            onclick: async () => {
              if (!confirm(`Delete "${t.title}" for everyone? This can't be undone.`)) return;
              await api(base, { method: "DELETE" }).catch((err) => toast(err.message, { kind: "error" }));
              dialog.close();
              ctx.navigate("/", { replace: true });
            },
          },
          "Delete trip",
        ),
        h("span", { class: "spacer" }),
        h("button", { class: "btn btn-ghost", type: "button", onclick: () => dialog.close() }, "Cancel"),
        h("button", { class: "btn btn-primary", type: "submit" }, "Save"),
      ),
    );
    const dialog = openDialog(h("dialog", { class: "dialog" }, form));
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      try {
        const mealTimes = Object.fromEntries(Object.keys(MEAL_LABEL).map((k) => [k, Object.fromEntries(["from", "usual", "to"].map((f) => [f, parseTime(form[`meal-${k}-${f}`].value)]))]));
        await act(api(base, { method: "PATCH", body: { ...Object.fromEntries(["title", "destination", "startDate", "endDate"].map((k) => [k, form[k].value])), mealTimes } }), { quiet: true });
        dialog.close();
      } catch (err) {
        error.textContent = err.message;
        error.hidden = false;
      }
    });
  }

  render();
  if (isPhone() && !S.trip.days.some((d) => d.activities.length)) setTab("map");

  return () => {
    clearInterval(prune);
    S.aiPending?.controller.abort();
    voice.destroy();
    events.close();
    map.destroy();
    S.editing = null;
  };
}
