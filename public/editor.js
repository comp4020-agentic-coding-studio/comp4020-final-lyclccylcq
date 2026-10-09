import { createMap } from "/map.js";
import {
  api,
  avatar,
  dur,
  fmtDay,
  fmtRange,
  guessKind,
  h,
  hhmm,
  icon,
  KIND_DURATION,
  KIND_LABEL,
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
  };
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

  const map = await createMap(mapHost, {
    config: ctx.config,
    onSelectStop: (id) => {
      select(id, { scroll: true });
      if (isPhone()) setTab("plan");
    },
    onSelectResult: (placeId) => pickPlace(S.results.find((r) => r.placeId === placeId)),
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
    bar.replaceChildren(
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

    if (!d.activities.length) {
      timeline.replaceChildren(
        h(
          "li",
          { class: "timeline-empty" },
          h("h3", {}, "Start by searching for somewhere you want to visit"),
          h("p", {}, "Search a place on the map and add it to this day, or add your own activity below. Wayline works out the travel time between consecutive stops."),
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
    timeline.replaceChildren(...items);
  }

  function stopItem(a, i, d) {
    const n = d.activities.length;
    const end = a.startMin === null ? null : a.startMin + a.durationMin;
    const li = h(
      "li",
      { class: `stop kind-${a.kind}${a.id === S.selectedId ? " selected" : ""}`, dataset: { id: a.id }, draggable: "true" },
      h("div", { class: "stop-rail" }, h("span", { class: "stop-num" }, String(i + 1))),
      h(
        "article",
        { class: "stop-card", tabindex: "-1" },
        h(
          "div",
          { class: "stop-top" },
          h("span", { class: "stop-time" }, a.startMin === null ? "No time set" : `${hhmm(a.startMin)} – ${hhmm(end)}`),
          h("span", { class: "grip", "aria-hidden": "true", title: "Drag to reorder" }, icon("grip")),
        ),
        h("h3", {}, h("button", { class: "linklike", type: "button", onclick: () => select(a.id, { focusMap: true }) }, a.title)),
        h(
          "p",
          { class: "stop-meta" },
          h("span", { class: `tag tag-${a.kind}` }, KIND_LABEL[a.kind]),
          h("span", {}, dur(a.durationMin)),
          a.place?.source === "demo" && h("span", { class: "tag tag-demo", title: "Demo fixture, not data from Google" }, "Demo place"),
          a.place?.source === "curated" && h("span", { class: "tag tag-demo", title: "From Wayline's curated sample data, not matched to a Google place" }, "Approximate location"),
          !a.place && h("span", { class: "muted" }, "No place"),
        ),
        a.notes && h("p", { class: "stop-notes" }, a.notes),
        a.updatedBy && a.updatedBy !== me.id && Date.now() - a.updatedAt < 120_000 && h("p", { class: "stop-touched" }, `Changed by ${memberName(a.updatedBy)} ${relTime(a.updatedAt)}`),
        h(
          "div",
          { class: "stop-actions" },
          h("button", { class: "icon-btn", type: "button", "aria-label": `Move ${a.title} earlier`, disabled: i === 0, onclick: () => move(a.id, d.id, i - 1) }, icon("up")),
          h("button", { class: "icon-btn", type: "button", "aria-label": `Move ${a.title} later`, disabled: i === n - 1, onclick: () => move(a.id, d.id, i + 1) }, icon("down")),
          h("button", { class: "btn btn-ghost btn-sm", type: "button", onclick: () => activityDialog({ activity: a }) }, icon("edit"), "Edit"),
          h("button", { class: "icon-btn icon-btn-danger", type: "button", "aria-label": `Remove ${a.title}`, onclick: () => removeActivity(a) }, icon("trash")),
        ),
      ),
    );
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

  function routeButton(prev, next, busy, label, force = false) {
    const unverified = prev.place?.source !== "google" || next.place?.source !== "google";
    const disabledWhy = !ctx.config.routes
      ? "Routes need Google Maps configured on the server"
      : unverified
        ? "Only places matched to Google Maps can be routed"
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

  function renderMap() {
    const d = day();
    const stops = (d?.activities ?? [])
      .filter((a) => a.place && a.place.lat !== null)
      .map((a) => ({ id: a.id, title: a.title, kind: a.kind, lat: a.place.lat, lng: a.place.lng, selected: a.id === S.selectedId }));
    map.update({ stops, results: S.results, center: S.trip.center, selectedPlaceId: S.place?.placeId ?? null });
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
    searchPanel.hidden = true;
    renderMap();
  }

  async function pickPlace(p) {
    if (!p) return;
    S.place = p;
    S.placeDetails = null;
    renderSearch();
    renderMap();
    map.focus(p);
    try {
      const details = await api(`/api/places/${encodeURIComponent(p.placeId)}`);
      if (S.place?.placeId === p.placeId) {
        S.placeDetails = details;
        renderSearch();
      }
    } catch (err) {
      if (S.place?.placeId === p.placeId) {
        S.placeDetails = { error: err.message };
        renderSearch();
      }
    }
  }

  function renderSearch() {
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
    searchPanel.replaceChildren(
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
      h("button", { class: "btn btn-primary btn-block", type: "submit" }, icon("plus"), "Add to itinerary"),
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
        closeSearch();
        render();
        toast(`Added ${p.name} to Day ${dayIndex + 1}.`, isPhone() ? { action: { label: "View plan", run: () => setTab("plan") } } : {});
      } catch {
        btn.disabled = false;
      }
    });

    return h(
      "div",
      { class: "place-card" },
      h(
        "div",
        { class: "panel-head" },
        h("button", { class: "linklike small", type: "button", onclick: () => { S.place = null; renderSearch(); renderMap(); } }, "← Results"),
        h("button", { class: "icon-btn", type: "button", "aria-label": "Close", onclick: closeSearch }, icon("close")),
      ),
      h("h3", {}, p.name),
      h(
        "p",
        { class: "stop-meta" },
        p.category && h("span", { class: "tag" }, p.category),
        p.source === "demo" && h("span", { class: "tag tag-demo" }, "Demo place"),
      ),
      p.address && h("p", { class: "muted" }, p.address),
      d === null && p.source === "google" && h("p", { class: "muted small" }, "Loading opening hours…"),
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
      form,
      p.source === "google" && h("p", { class: "attrib", translate: "no" }, "Google Maps"),
    );
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
