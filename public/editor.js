import { createMap } from "/map.js";
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
  KIND_DURATION,
  KIND_LABEL,
  km,
  openDialog,
  parseTime,
  relTime,
  toast,
  uid,
} from "/ui.js";

const MODE_LABEL = { WALK: "Walk", TRANSIT: "Transit", DRIVE: "Drive" };
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
    ai: new Map(), // dayId -> copilot answer
    aiLoading: false,
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
  };
  const params = new URLSearchParams(location.search);
  if (params.has("new")) history.replaceState(history.state, "", location.pathname);
  const startOf = () => S.trip.days.flatMap((d) => d.activities).find((a) => a.role === "start") ?? null;
  if (params.has("new") && !startOf()) S.starting = { step: "choose" };
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
  });

  const isPhone = () => matchMedia("(max-width: 899px)").matches;

  // --- server state ---

  function applySnapshot(snap) {
    if (!snap || typeof snap.rev !== "number" || snap.rev < S.trip.rev) return;
    S.trip = snap;
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

  const events = new EventSource(`${base}/events`);
  events.addEventListener("snapshot", (e) => applySnapshot(JSON.parse(e.data)));
  events.addEventListener("presence", (e) => {
    S.presence = JSON.parse(e.data);
    renderBar();
  });
  events.addEventListener("revoked", (e) => {
    const { reason } = JSON.parse(e.data);
    events.close();
    toast(reason === "deleted" ? "This trip was deleted." : "You no longer have access to this trip.", { kind: "error" });
    ctx.navigate("/", { replace: true });
  });
  events.onopen = () => {
    S.live = true;
    renderBar();
  };
  events.onerror = () => {
    S.live = false;
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

  function stopItem(a, i, d) {
    const n = d.activities.length;
    const isStart = a.role === "start";
    const first = d.activities[0]?.role === "start" ? 1 : 0; // nothing moves above the start
    const end = a.startMin === null ? null : a.startMin + a.durationMin;
    const li = h(
      "li",
      { class: `stop kind-${a.kind}${isStart ? " stop-start" : ""}${a.id === S.selectedId ? " selected" : ""}`, dataset: { id: a.id }, draggable: isStart ? "false" : "true" },
      h("div", { class: "stop-rail" }, h("span", { class: "stop-num" }, isStart ? "S" : String(i + 1 - first))),
      h(
        "article",
        { class: "stop-card", tabindex: "-1" },
        h(
          "div",
          { class: "stop-top" },
          isStart
            ? h("span", { class: "stop-time" }, h("span", { class: "start-badge" }, "Start"), a.startMin === null ? "" : ` · leave ${hhmm(a.startMin)}`)
            : h("span", { class: "stop-time" }, a.startMin === null ? "No time set" : `${hhmm(a.startMin)} – ${hhmm(end)}`),
          !isStart && h("span", { class: "grip", "aria-hidden": "true", title: "Drag to reorder" }, icon("grip")),
        ),
        h("h3", {}, h("button", { class: "linklike", type: "button", onclick: () => openStop(a) }, a.title)),
        h(
          "p",
          { class: "stop-meta" },
          !isStart && h("span", { class: `tag tag-${a.kind}` }, KIND_LABEL[a.kind]),
          !isStart && h("span", {}, dur(a.durationMin)),
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
            : [
                h("button", { class: "icon-btn", type: "button", "aria-label": `Move ${a.title} earlier`, disabled: i <= first, onclick: () => move(a.id, d.id, i - 1) }, icon("up")),
                h("button", { class: "icon-btn", type: "button", "aria-label": `Move ${a.title} later`, disabled: i === n - 1, onclick: () => move(a.id, d.id, i + 1) }, icon("down")),
              ],
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

  function legItem(d, prev, next) {
    const gap = d.analysis.gaps.find((g) => g.fromId === prev.id && g.toId === next.id);
    const seg = d.segments.find((s) => s.fromId === prev.id && s.toId === next.id);
    const issues = d.analysis.issues.filter((x) => x.fromId === prev.id && x.toId === next.id);
    const key = `${prev.id}>${next.id}`;
    const busy = S.busyLegs.has(key);
    const free =
      gap?.availableMin === null || gap?.availableMin === undefined
        ? null
        : gap.availableMin >= 0
          ? `${dur(gap.availableMin || 0)} free`.replace(/^0 min free$/, "No time between")
          : null;

    const body = [];
    if (gap?.status === "no_places") {
      body.push(h("p", { class: "leg-line muted" }, "Travel not planned: ", !prev.place ? prev.title : next.title, " has no place on the map."));
    } else if (gap?.status === "not_calculated") {
      body.push(
        h(
          "div",
          { class: "leg-line" },
          h("span", { class: "muted" }, "Route not calculated"),
          routeButton(prev, next, busy, "Calculate route"),
        ),
      );
    } else if (seg) {
      body.push(modeChips(seg, prev));
      const sel = seg.options.find((o) => o.mode === seg.selectedMode);
      if (sel) body.push(routeSummary(sel, prev, key));
      else body.push(h("p", { class: "leg-line muted" }, seg.options.map((o) => o.message).filter(Boolean)[0] ?? "No route was found."));
      if (seg.stale) {
        body.push(h("div", { class: "leg-line leg-warn" }, "Times changed since this route was calculated.", routeButton(prev, next, busy, "Recalculate", true)));
      }
      body.push(h("p", { class: "leg-attrib", translate: "no" }, `Google Maps · calculated ${relTime(seg.computedAt)}`));
    }

    return h(
      "li",
      { class: `leg${issues.some((x) => x.severity === "conflict") ? " leg-bad" : ""}`, "aria-label": `Travel from ${prev.title} to ${next.title}` },
      h(
        "div",
        { class: "leg-head" },
        h("span", { class: "leg-label" }, "Travel"),
        free && h("span", { class: "chip chip-soft" }, free),
        issues.map((x) => h("span", { class: "chip chip-danger" }, x.kind === "overlap" ? `Overlaps by ${dur(x.minutes)}` : `${dur(x.minutes)} short`)),
      ),
      ...body,
      issues.map((x) => h("p", { class: "leg-issue" }, x.message, " ", h("button", { class: "linklike", type: "button", onclick: openCopilot }, "See options"))),
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

  function modeChips(seg, prev) {
    return h(
      "div",
      { class: "modes", role: "group", "aria-label": "Transport mode" },
      seg.options.map((o) => {
        const ok = o.status === "ok";
        return h(
          "button",
          {
            type: "button",
            class: `mode${seg.selectedMode === o.mode ? " on" : ""}`,
            "aria-pressed": String(seg.selectedMode === o.mode),
            disabled: !ok,
            title: ok ? `Use ${MODE_LABEL[o.mode].toLowerCase()}` : o.message ?? "Not available",
            onclick: () => seg.selectedMode !== o.mode && act(api(`${base}/segments/${seg.id}/mode`, { method: "POST", body: { mode: o.mode } })).catch(() => {}),
          },
          icon(MODE_ICON[o.mode]),
          h("span", {}, MODE_LABEL[o.mode]),
          h("b", {}, ok ? dur(Math.ceil(o.durationSec / 60)) : "n/a"),
        );
      }),
    );
  }

  function routeSummary(o, prev, key) {
    const mins = Math.ceil(o.durationSec / 60);
    const leave = prev.startMin === null ? null : prev.startMin + prev.durationMin;
    const transit = (o.steps ?? []).filter((s) => s.kind === "transit");
    const open = S.openLegs.has(key);
    const parts = [
      `${MODE_LABEL[o.mode]} · ${dur(mins)}`,
      o.distanceM ? `${(o.distanceM / 1000).toFixed(o.distanceM < 10_000 ? 1 : 0)} km` : null,
      o.mode === "TRANSIT" && transit.length ? `${transit.length - 1} transfer${transit.length === 2 ? "" : "s"}` : null,
      leave !== null ? `leave ${hhmm(leave)}, arrive ≈ ${hhmm(leave + mins)}` : null,
    ].filter(Boolean);
    return h(
      "div",
      { class: "route" },
      h("p", { class: "leg-line" }, parts.join(" · ")),
      o.mode === "TRANSIT" && transit.length > 0 && h("p", { class: "lines" }, transit.map((s) => lineChip(s))),
      o.steps?.length > 0 &&
        h(
          "button",
          { class: "linklike small", type: "button", "aria-expanded": String(open), onclick: () => { open ? S.openLegs.delete(key) : S.openLegs.add(key); renderTimeline(); } },
          open ? "Hide steps" : "Show steps",
        ),
      open &&
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
    map.update({ stops, results: shownResults(), temp, center: S.trip.center, selectedPlaceId: S.place?.placeId ?? null });
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
      const details = await api(`/api/places/${encodeURIComponent(p.placeId)}`);
      if (S.place?.placeId === p.placeId) {
        S.place = { ...S.place, name: details.name, address: details.address, category: details.category, types: details.types, lat: details.lat, lng: details.lng, pending: false };
        S.placeDetails = details;
        renderSearch();
        renderMap();
        if (details.photo) {
          const { uri } = await api(`/api/places/photo?name=${encodeURIComponent(details.photo.name)}`).catch(() => ({ uri: null }));
          if (uri && S.placeDetails === details) {
            details.photoUri = uri;
            renderSearch();
          }
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
    pickPlace(p);
  }

  // A click anywhere else: explore around it, or, while choosing the start,
  // make that spot the candidate.
  function mapClicked(at) {
    if (S.starting) return considerStartSpot(at);
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

  function placeCard(p) {
    const d = S.placeDetails;
    const kind = guessKind(p.types);
    const days = S.trip.days;
    const current = day();
    const form = h(
      "form",
      { class: "add-form" },
      h(
        "div",
        { class: "row-2" },
        h("label", { class: "field" }, h("span", {}, "Day"), h("select", { name: "dayId" }, days.map((x, i) => h("option", { value: x.id, selected: x.id === current?.id }, `Day ${i + 1} · ${fmtDay(x.date)}`)))),
        h("label", { class: "field" }, h("span", {}, "Type"), h("select", { name: "kind" }, Object.entries(KIND_LABEL).map(([k, v]) => h("option", { value: k, selected: k === kind }, v)))),
      ),
      h(
        "div",
        { class: "row-2" },
        h("label", { class: "field" }, h("span", {}, "Start"), h("input", { name: "start", type: "time", step: 300, value: hhmm(suggestStart(current)) })),
        h("label", { class: "field" }, h("span", {}, "Duration (min)"), h("input", { name: "duration", type: "number", min: 5, max: 1440, step: 5, value: KIND_DURATION[kind] })),
      ),
      h("button", { class: "btn btn-primary btn-block", type: "submit", disabled: Boolean(p.pending) }, icon("plus"), visitsOf(p.placeId).length ? "Add another visit" : "Add to itinerary"),
    );
    form.kind.addEventListener("change", () => (form.duration.value = KIND_DURATION[form.kind.value]));
    form.dayId.addEventListener("change", () => (form.start.value = hhmm(suggestStart(days.find((x) => x.id === form.dayId.value)))));
    const clientId = uid();
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const btn = form.querySelector("[type=submit]");
      btn.disabled = true;
      try {
        const res = await act(
          api(`${base}/activities`, {
            method: "POST",
            body: {
              clientId,
              dayId: form.dayId.value,
              title: p.name,
              kind: form.kind.value,
              startMin: parseTime(form.start.value),
              durationMin: Number(form.duration.value),
              place: { placeId: p.placeId, source: p.source, lat: p.lat, lng: p.lng },
            },
          }),
        );
        const dayIndex = days.findIndex((x) => x.id === form.dayId.value);
        if (form.dayId.value !== S.dayId) setDay(form.dayId.value);
        S.selectedId = res.activityId;
        S.hint = false;
        // from a map click: back to the nearby list, so exploring can go on
        if (S.explore) {
          S.place = null;
          S.placeDetails = null;
        } else closeSearch();
        render();
        toast(`Added ${p.name} to Day ${dayIndex + 1}.`, isPhone() ? { action: { label: "View plan", run: () => setTab("plan") } } : {});
      } catch {
        btn.disabled = false;
      }
    });

    const visits = visitsOf(p.placeId);
    const back = S.explore ? "← Nearby places" : S.results.length ? "← Results" : null;
    return h(
      "div",
      { class: "place-card" },
      h(
        "div",
        { class: "panel-head" },
        back ? h("button", { class: "linklike small", type: "button", onclick: () => { S.place = null; S.placeDetails = null; renderSearch(); renderMap(); } }, back) : h("span", { class: "muted small" }, "Place"),
        h("button", { class: "icon-btn", type: "button", "aria-label": "Close", onclick: closeSearch }, icon("close")),
      ),
      d?.photoUri &&
        h(
          "figure",
          { class: "place-photo" },
          h("img", { src: d.photoUri, alt: `Photo of ${p.name}`, loading: "lazy", decoding: "async", onerror: (e) => e.currentTarget.closest("figure")?.remove() }),
          d.photo.attributions.length > 0 &&
            h("figcaption", { class: "photo-credit" }, "Photo: ", d.photo.attributions.map((a, i) => [i > 0 && ", ", a.uri ? h("a", { href: a.uri, target: "_blank", rel: "noopener" }, a.displayName) : a.displayName])),
        ),
      h("h3", {}, p.name),
      h(
        "p",
        { class: "stop-meta" },
        p.category && h("span", { class: "tag" }, p.category),
        p.source === "demo" && h("span", { class: "tag tag-demo" }, "Demo place"),
      ),
      d && typeof d.rating === "number" && h("p", { class: "rating" }, h("strong", {}, d.rating.toFixed(1)), " ★", d.ratingCount ? h("span", { class: "muted" }, ` (${d.ratingCount.toLocaleString("en-AU")} Google reviews)`) : null),
      p.address && h("p", { class: "muted" }, p.address),
      visits.length > 0 &&
        h(
          "p",
          { class: "already" },
          icon("check"),
          "Already in your plan: ",
          visits.map((v, i) => [i > 0 && ", ", `Day ${v.day}${v.a.role === "start" ? " (start)" : v.a.startMin !== null ? ` at ${hhmm(v.a.startMin)}` : ""}`]),
        ),
      d === null && p.source === "google" && h("p", { class: "muted small" }, "Loading details…"),
      d?.error && h("p", { class: "form-error small" }, d.error),
      d?.openingHours &&
        h(
          "details",
          { class: "hours" },
          h("summary", {}, d.openNow === true ? "Open now · opening hours" : d.openNow === false ? "Closed now · opening hours" : "Opening hours"),
          h("ul", {}, d.openingHours.map((line) => h("li", {}, line))),
        ),
      d && !d.error && !d.openingHours && h("p", { class: "muted small" }, p.source === "demo" ? "Demo places have no opening hours." : "No opening hours available for this place."),
      d?.googleMapsUri && h("p", {}, h("a", { href: d.googleMapsUri, target: "_blank", rel: "noopener" }, "Open in Google Maps")),
      S.starting
        ? h(
            "button",
            { class: "btn btn-primary btn-block", type: "button", disabled: Boolean(p.pending), onclick: () => confirmStart({ title: p.name, place: { placeId: p.placeId, source: p.source, lat: p.lat, lng: p.lng } }) },
            icon("pin"),
            "Set as starting point",
          )
        : form,
      p.source === "google" && h("p", { class: "attrib", translate: "no" }, "Google Maps"),
    );
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

  // A spot that isn't a listed place (a viewpoint, a meeting point): stored
  // with its coordinates and a custom: id, never a made-up Google id.
  function customSpotForm(ex) {
    const name = h("input", { name: "title", maxlength: 120, value: ex.customName ?? ex.label ?? "", placeholder: "e.g. Meeting point", oninput: (e) => (ex.customName = e.target.value) });
    const daySel = h("select", { name: "dayId" }, S.trip.days.map((x, i) => h("option", { value: x.id, selected: x.id === day()?.id }, `Day ${i + 1} · ${fmtDay(x.date)}`)));
    const btn = h("button", { class: "btn btn-ghost btn-sm btn-block", type: "submit" }, icon("plus"), "Add this spot");
    const clientId = uid();
    return h(
      "form",
      {
        class: "add-form custom-spot",
        onsubmit: async (e) => {
          e.preventDefault();
          const title = name.value.trim() || "Pinned spot";
          btn.disabled = true;
          try {
            const res = await act(
              api(`${base}/activities`, {
                method: "POST",
                body: {
                  clientId,
                  dayId: daySel.value,
                  title,
                  kind: "custom",
                  startMin: suggestStart(S.trip.days.find((x) => x.id === daySel.value)),
                  durationMin: 30,
                  place: { placeId: `custom:${clientId}`, source: "custom", lat: ex.lat, lng: ex.lng },
                },
              }),
            );
            if (daySel.value !== S.dayId) setDay(daySel.value);
            S.selectedId = res.activityId;
            S.hint = false;
            closeSearch();
            render();
            toast(`Added ${title} to the plan.`, isPhone() ? { action: { label: "View plan", run: () => setTab("plan") } } : {});
          } catch {
            btn.disabled = false;
          }
        },
      },
      h("p", { class: "small" }, h("strong", {}, "Not a listed place?"), " Add this exact spot, like a viewpoint or a meeting point."),
      h("div", { class: "row-2" }, h("label", { class: "field" }, h("span", {}, "Name"), name), h("label", { class: "field" }, h("span", {}, "Day"), daySel)),
      btn,
    );
  }

  // --- the starting point ---

  const kmBetween = (a, b) => {
    const rad = Math.PI / 180;
    const x = Math.sin(((b.lat - a.lat) * rad) / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(((b.lng - a.lng) * rad) / 2) ** 2;
    return 12742 * Math.asin(Math.sqrt(x));
  };

  function beginStart() {
    S.starting = { step: "choose" };
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
      const res = await act(api(`${base}/start`, { method: "PUT", body: { clientId: uid(), title: c.title, place: c.place } }));
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
    } catch {
      if (S.starting) S.starting = { ...S.starting, saving: false };
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

  function renderCopilot() {
    const d = day();
    if (!d) return copilotPane.replaceChildren();
    const idx = S.trip.days.indexOf(d);
    const { issues, proposals, gaps } = d.analysis;
    const unrouted = gaps.filter((g) => g.status === "not_calculated").length;
    const stale = gaps.filter((g) => g.status === "stale").length;
    const ai = S.ai.get(d.id);
    const aiStale = ai && ai.rev !== S.trip.rev;
    const recommended = new Map((ai && !aiStale ? ai.answer?.recommendations ?? [] : []).map((r) => [r.proposalId, r.rationale]));
    const explained = new Map((ai && !aiStale ? ai.answer?.issues ?? [] : []).map((r) => [r.issueId, r.explanation]));
    const visible = issues.filter((x) => !S.dismissed.has(`${x.id}@${S.trip.rev}`) && !S.dismissed.has(x.id));

    copilotPane.replaceChildren(
      h(
        "div",
        { class: "copilot-head" },
        h("h2", {}, icon("spark"), "Copilot"),
        h("button", { class: "icon-btn hide-phone", type: "button", "aria-label": "Close copilot", onclick: () => { S.copilotOpen = false; render(); } }, icon("close")),
      ),
      h("p", { class: "muted small" }, `Day ${idx + 1} · ${fmtDay(d.date)}`),
      h(
        "section",
        { class: "co-section" },
        h("h3", {}, "Schedule check ", h("span", { class: "tag tag-rule" }, "Rule-based")),
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
            explained.has(x.id) && h("p", { class: "ai-text" }, icon("spark"), explained.get(x.id)),
            h(
              "div",
              { class: "proposals" },
              proposals
                .filter((p) => p.issueId === x.id)
                .sort((a, b) => (recommended.has(b.id) ? 1 : 0) - (recommended.has(a.id) ? 1 : 0))
                .map((p) => proposalCard(d, p, recommended.get(p.id))),
              h("button", { class: "btn btn-ghost btn-sm", type: "button", onclick: () => { S.dismissed.add(x.id); renderCopilot(); } }, "Keep the plan as it is"),
            ),
          ),
        ),
      ),
      aiSection(d, ai, aiStale),
    );
  }

  function proposalCard(d, p, rationale) {
    const nameOf = (id) => d.activities.find((a) => a.id === id)?.title ?? "Activity";
    const seg = (id) => d.segments.find((s) => s.id === id);
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
    return h(
      "div",
      { class: `proposal${rationale ? " proposal-ai" : ""}` },
      rationale && h("p", { class: "ai-badge" }, icon("spark"), "Recommended by AI"),
      h("p", { class: "proposal-label" }, p.label),
      h("ul", { class: "preview", "aria-label": "Changes this will make" }, preview),
      rationale && h("p", { class: "ai-text" }, rationale),
      h(
        "button",
        {
          class: "btn btn-primary btn-sm",
          type: "button",
          onclick: async (e) => {
            e.currentTarget.disabled = true;
            await act(api(`${base}/proposals/apply`, { method: "POST", body: { dayId: d.id, proposalId: p.id } }))
              .then(() => toast("Change applied."))
              .catch(() => {});
          },
        },
        "Apply this change",
      ),
    );
  }

  function aiSection(d, ai, aiStale) {
    const cfg = ctx.config.ai;
    const head = h("h3", {}, "AI explanation ", h("span", { class: "tag tag-ai" }, cfg.configured ? `AI · ${cfg.model}` : "Not configured"));
    if (!cfg.configured) {
      return h(
        "section",
        { class: "co-section" },
        head,
        h("p", { class: "muted small" }, "AI suggestions aren't available because no AI provider is configured on this server (ANTHROPIC_API_KEY). The schedule check above is rule-based and works without it."),
      );
    }
    const ask = h(
      "button",
      { class: "btn btn-dark btn-sm", type: "button", disabled: S.aiLoading || !d.analysis.issues.length, onclick: () => askAi(d) },
      icon("spark"),
      S.aiLoading ? "Thinking…" : ai ? "Ask again" : "Explain and recommend",
    );
    return h(
      "section",
      { class: "co-section" },
      head,
      !d.analysis.issues.length && h("p", { class: "muted small" }, "Nothing to explain: the rule-based check found no problems on this day."),
      d.analysis.issues.length > 0 && !ai && h("p", { class: "muted small" }, "Ask the AI to explain these conflicts and recommend which option fits best. It only sees this day's plan and the routes Google returned, and it can't change anything: you choose what to apply."),
      ai?.error && h("p", { class: "form-error small" }, ai.error),
      ai?.note && h("p", { class: "muted small" }, ai.note),
      ai?.answer &&
        h(
          "div",
          { class: `ai-card${aiStale ? " ai-stale" : ""}` },
          aiStale && h("p", { class: "small leg-warn" }, "The plan has changed since this was written. Ask again for an up-to-date answer."),
          h("p", {}, ai.answer.summary),
          ai.answer.caveats.length > 0 && h("ul", { class: "small muted" }, ai.answer.caveats.map((c) => h("li", {}, c))),
          h("p", { class: "tiny muted" }, `Generated by ${ai.model}${ai.cached ? " (same plan as last time, so not asked again)" : ""}. AI can be wrong: check before applying.`),
        ),
      ask,
    );
  }

  async function askAi(d) {
    S.aiLoading = true;
    renderCopilot();
    try {
      const res = await api(`${base}/copilot`, { method: "POST", body: { dayId: d.id } });
      S.ai.set(d.id, res);
    } catch (err) {
      S.ai.set(d.id, { rev: S.trip.rev, error: err.message });
    }
    S.aiLoading = false;
    renderCopilot();
  }

  // --- dialogs ---

  function activityDialog({ activity }) {
    const isNew = !activity;
    let baseVersion = activity?.version ?? null;
    const d = activity ? S.trip.days.find((x) => x.id === activity.dayId) : day();
    const clientId = uid();
    const banner = h("div", { class: "banner", role: "alert", hidden: true });
    const error = h("p", { class: "form-error", role: "alert", hidden: true });
    const timed = h("input", { type: "checkbox", name: "timed", checked: activity ? activity.startMin !== null : true });
    const form = h(
      "form",
      { method: "dialog", class: "stack" },
      h("h2", {}, isNew ? "Add an activity" : "Edit activity"),
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
      syncTimed();
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
    const dialog = openDialog(
      h(
        "dialog",
        { class: "dialog" },
        h(
          "div",
          { class: "stack" },
          h("h2", {}, "People on this trip"),
          list,
          isOwner ? h("h3", {}, "Invite someone") : h("p", { class: "small muted" }, "Only the owner can invite people."),
          linkBox,
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
        await act(api(base, { method: "PATCH", body: Object.fromEntries(["title", "destination", "startDate", "endDate"].map((k) => [k, form[k].value])) }), { quiet: true });
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
    events.close();
    map.destroy();
    S.editing = null;
  };
}
