// The gym page. The server holds everything that matters (who you are, your
// visits, your sets, which machine you're at and what you're doing); this
// browser only keeps the gym pass that lets it act as you. world.js turns what
// people are doing into where they stand and how they move.
//
// The three places have three jobs. Reception (reception.js) gets you in.
// The gym floor (this file and world.js) is what you're doing now: tap a
// machine and walk over to it; once you're there, set it up and Start set;
// Finish set records it. Your locker (locker.js) is what the gym remembers.

import { lockerDoorHtml, lockerHtml } from "./locker.js";
import { checkInCard, doorHtml } from "./reception.js";
import { esc, pad } from "./util.js";
import { createWorld } from "./world.js";

const PASS_KEY = "same-gym.pass";
// Set while this tab is in the gym. A refresh keeps it, so you stay where you
// were; a new tab or another day doesn't, so you start at the entrance.
const HERE_KEY = "same-gym.here";

const $ = (sel) => document.querySelector(sel);

function stored(storage, key) {
  try {
    return storage.getItem(key);
  } catch {
    return null;
  }
}

function store(storage, key, value) {
  try {
    if (value) storage.setItem(key, value);
    else storage.removeItem(key);
  } catch {
    // private window: you stay you until the tab closes, and the pass gets you back
  }
}

let pass = stored(localStorage, PASS_KEY);
let me = null; // GET /api/me
let floor = null; // GET /api/floor
let clockOffset = 0; // server clock minus ours, so timers agree across devices
let panelOpen = true; // the card in the corner; closing it never changes what you're doing
let walkingTo = null; // a machine you're walking over to; its setup opens when you get there
let note = null; // a machine you tapped that you can't use right now (taken, or you're mid-set)
let leaving = null; // a machine you tapped while resting at another: asks before you walk off
const choice = new Map(); // machine id → the exercise picked for it
let showPass = false; // reception's card: shown once on checking in, and on request
let lockerView = null; // a locker you've opened: yours (with what's in it) or someone else's door

async function api(path, data) {
  const res = await fetch(path, {
    method: data === undefined ? "GET" : "POST",
    headers: {
      ...(data === undefined ? {} : { "content-type": "application/json" }),
      ...(pass ? { authorization: `Bearer ${pass}` } : {}),
    },
    body: data === undefined ? undefined : JSON.stringify(data),
  });
  const out = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(out.error ?? "Something went wrong."), { status: res.status });
  if (out.now) clockOffset = out.now - Date.now();
  return out;
}

const now = () => Date.now() + clockOffset;
const inGym = () => me && me.presence.state !== "away";
const machineOf = (id) => floor?.machines.find((m) => m.id === id);
const kindOf = (id) => floor?.kinds.find((k) => k.id === id);
const exerciseOf = (name) => floor?.kinds.flatMap((k) => k.exercises).find((e) => e.name === name);
const holderOf = (id) => floor?.people.find((p) => p.machine === id && (p.state === "training" || p.state === "resting"));

function clock(ms) {
  const s = Math.max(0, Math.floor(ms / 1000));
  const mm = String(Math.floor(s / 60) % 60).padStart(2, "0");
  const ss = String(s % 60).padStart(2, "0");
  return s >= 3600 ? `${Math.floor(s / 3600)}:${mm}:${ss}` : `${mm}:${ss}`;
}

// One set, the way its exercise measures it (see src/equipment.ts).
function describe(exercise, set) {
  const ex = exerciseOf(exercise);
  if (ex?.metric === "time") {
    const dial = ex.setting && set.setting != null ? ` · ${ex.setting.label.toLowerCase()} ${set.setting}${ex.setting.unit ? ` ${ex.setting.unit}` : ""}` : "";
    return `${set.amount} min${dial}`;
  }
  if (ex?.metric === "assist") return `${set.amount} reps${set.setting != null ? ` · ${set.setting} kg assist` : ""}`;
  return `${set.weightKg ? `${set.weightKg} kg` : "Bodyweight"} × ${set.amount}`;
}

// The number of the next set: sets of this exercise already done this visit, plus one.
const setNumber = (exercise) => (me.session?.sets ?? []).filter((s) => s.exercise === exercise).length + 1;

// ---- the world ----

const world = createWorld({
  scroller: $("#world-scroll"),
  sizer: $("#world-size"),
  world: $("#world"),
  canvas: $("#world-canvas"),
  layer: $("#people"),
  panel: $("#panel"),
  onLocker(number) {
    if (!inGym()) return;
    note = leaving = null;
    panelOpen = true;
    if (number !== me.locker) {
      lockerView = { number, taken: floor.lockers.find((l) => l.number === number)?.taken };
      return drawPanel();
    }
    openLocker();
  },
  onMachine(id) {
    if (!inGym()) return;
    lockerView = note = leaving = null;
    const { presence } = me;
    panelOpen = true;
    if (id === presence.machine) return drawPanel(); // your own machine: its panel again
    const holder = holderOf(id);
    if ((holder && holder.id !== me.user.id) || presence.state === "training") {
      note = id;
      return drawPanel();
    }
    if (presence.state === "resting") {
      leaving = id;
      return drawPanel();
    }
    walkOver(id);
  },
});

// Walk to a machine: the server notes you're standing there (nothing held,
// nothing recorded), your character walks, and the setup opens on arrival.
function walkOver(id) {
  return act(async () => {
    const next = await api("/api/approach", { machine: id });
    walkingTo = id;
    panelOpen = false;
    await refresh(next);
    world.focus(me.user.id);
    world.whenArrived(id, () => {
      walkingTo = null;
      panelOpen = true;
      drawPanel();
    });
  });
}

// Your own numbers, on your own name tag only: the public floor carries no
// weights or reps, so nobody's numbers sit next to anyone else's.
function ownNumbers(p) {
  const { presence } = me;
  if (p.state === "training" && presence.plan) return `<span class="set">${esc(describe(presence.exercise, presence.plan))}</span>`;
  const last = me.session?.sets.at(-1);
  if (p.state === "resting" && last?.exercise === p.exercise) return `<span class="set">${esc(describe(last.exercise, last))}</span>`;
  return "";
}

function nameTag(p) {
  const you = me && p.id === me.user.id;
  const status =
    p.state === "training" ? "Training" : p.state === "resting" ? `Resting <time data-since="${p.since}">${clock(now() - p.since)}</time>` : "";
  const doing = p.state === "training" || p.state === "resting";
  return `<span class="tag is-${esc(p.state)}" style="--c:${esc(p.colour)}"><b>${esc(p.name)}${you ? " <i>you</i>" : ""}</b>${
    doing && p.exercise ? `<span class="what">${esc(p.exercise)}</span>` : ""
  }${you && doing ? ownNumbers(p) : ""}${status ? `<span class="status">${status}</span>` : ""}</span>`;
}

function drawWorld() {
  const people = floor?.people ?? [];
  world.setPeople(people, me?.user.id ?? null, nameTag, (exercise) => exerciseOf(exercise)?.pose ?? "");
  world.setLockers(floor?.lockers ?? [], me?.locker ?? null, me?.user.colour ?? null);
  const others = people.filter((p) => !me || p.id !== me.user.id).length;
  $("#headcount").textContent =
    others === 0
      ? inGym() ? "Just you in the gym so far" : "The gym is quiet right now"
      : `${others} ${others === 1 ? "other" : "others"} ${inGym() ? "training with you" : "training now"}`;
}

// ---- the panel over the gym ----

function visit() {
  const sets = me.session?.sets ?? [];
  const list = sets.length
    ? `<ol class="log">${sets
        .slice()
        .reverse()
        .map((s) => `<li><span>${esc(s.exercise)}</span><span>${esc(describe(s.exercise, s))}</span></li>`)
        .join("")}</ol>`
    : `<p class="muted">No sets yet this visit.</p>`;
  return `<div class="foot">
    <details class="visit"><summary>This visit · ${sets.length} ${sets.length === 1 ? "set" : "sets"}</summary>${list}</details>
    <div class="foot-links">${me.locker ? `<button type="button" class="leave" data-act="find-locker">Locker ${pad(me.locker)}</button>` : ""}<button type="button" class="leave" data-act="leave">Leave the gym</button></div>
  </div>`;
}

const passCard = () => (showPass ? checkInCard(me) : "");

// Open your locker: walk over to it if you're not on a machine, and read
// what's inside from the server.
async function openLocker() {
  lockerView = { number: me.locker, mine: true, data: null };
  world.goToLocker(me.locker, me.user.id);
  drawPanel();
  await act(async () => {
    const data = await api("/api/locker");
    if (lockerView?.mine) lockerView.data = data;
    drawPanel();
  });
}

function stepper(name, label, value, step, unit, hint = "") {
  return `<label class="field"><span>${label}${hint ? ` <em>${hint}</em>` : ""}</span>
    <span class="stepper">
      <button type="button" data-step="${name}" data-by="${-step}" aria-label="Less ${label.toLowerCase()}">−</button>
      <input name="${name}" inputmode="decimal" value="${esc(value ?? "")}" autocomplete="off" />
      <span class="unit">${unit}</span>
      <button type="button" data-step="${name}" data-by="${step}" aria-label="More ${label.toLowerCase()}">+</button>
    </span></label>`;
}

// The inputs one exercise needs, prefilled from `prev` (a planned or done set).
function fields(ex, prev, done = false) {
  const reps = done ? "Reps done" : "Target reps";
  if (ex.metric === "time") {
    return `${stepper("amount", done ? "Minutes done" : "Time", prev?.amount ?? 20, 5, "min")}${
      ex.setting ? stepper("setting", ex.setting.label, prev?.setting ?? "", ex.setting.step, ex.setting.unit || "", "optional") : ""
    }`;
  }
  if (ex.metric === "assist") {
    return `${stepper("assistKg", "Assistance", prev?.setting ?? 25, 2.5, "kg", "more is easier")}${stepper("amount", reps, prev?.amount ?? 8, 1, "reps")}`;
  }
  return `${stepper("weightKg", "Weight", prev?.weightKg ?? 20, 2.5, "kg")}${stepper("amount", reps, prev?.amount ?? 10, 1, "reps")}`;
}

function head(machine, title, eyebrow = machine.name) {
  return `<div class="panel-head"><div><p class="eyebrow">${esc(eyebrow)}</p><h2>${esc(title)}</h2></div>
    <button type="button" class="close" data-act="hide-panel" aria-label="Close panel">×</button></div>`;
}

// Which exercise a machine is set to: what you picked, what you're doing on
// it, what you last did on it, or its first.
function exerciseFor(machine) {
  const kind = kindOf(machine.kind);
  if (choice.has(machine.id)) return choice.get(machine.id);
  if (me.presence.machine === machine.id && me.presence.exercise) return me.presence.exercise;
  const done = kind.exercises.filter((e) => me.lastByExercise[e.name]).sort((a, b) => me.lastByExercise[b.name].doneAt - me.lastByExercise[a.name].doneAt);
  return (done[0] ?? kind.exercises[0]).name;
}

function chips(machine, current) {
  const kind = kindOf(machine.kind);
  if (kind.exercises.length < 2) return "";
  return `<div class="chips" role="group" aria-label="Exercise">${kind.exercises
    .map(
      (e) =>
        `<button type="button" class="chip${e.name === current ? " is-on" : ""}" data-choose="${esc(e.name)}" data-machine="${esc(machine.id)}" aria-pressed="${e.name === current}">${esc(e.name)}</button>`,
    )
    .join("")}</div>`;
}

// Setting up the next set at the machine you're standing at: prefilled from
// the set you just did here, else your last set of this exercise, and every
// value open to change.
function startForm(machine, exercise) {
  const ex = exerciseOf(exercise);
  const { presence } = me;
  const prev = presence.machine === machine.id && presence.exercise === exercise && presence.plan ? presence.plan : me.lastByExercise[exercise];
  const n = setNumber(exercise);
  return `<form class="set-form" id="start-form" data-machine="${esc(machine.id)}" data-exercise="${esc(exercise)}" novalidate>
    <p class="set-no">Set ${n}</p>
    <div class="fields">${fields(ex, prev)}</div>
    <p class="error" id="set-error" role="alert"></p>
    <button type="submit" class="primary">Start set ${n}</button>
  </form>`;
}

function panelHtml() {
  const { presence } = me;
  const mine = presence.machine && machineOf(presence.machine);

  if (note) {
    const m = machineOf(note);
    const holder = holderOf(m.id);
    return holder && holder.id !== me.user.id
      ? `${head(m, kindOf(m.kind).name)}<p class="note">${esc(holder.name)} is on this one right now. Try another ${esc(kindOf(m.kind).name.toLowerCase())}.</p>`
      : `${head(m, kindOf(m.kind).name)}<p class="note">You're mid-set on the ${esc(mine.name)}. Finish or cancel it before walking over.</p>
        <button type="button" class="secondary" data-act="back">Back to my set</button>`;
  }
  if (leaving) {
    const m = machineOf(leaving);
    return `${head(m, "Leave your station?")}
      <p class="note">You're resting at the ${esc(mine.name)}. Walk over to the ${esc(m.name)} instead? Your sets so far are kept.</p>
      <button type="button" class="primary" data-act="walk-over">Walk over</button>
      <button type="button" class="secondary" data-act="back">Stay here</button>`;
  }
  if (presence.state === "training") {
    const ex = exerciseOf(presence.exercise);
    const n = setNumber(presence.exercise);
    return `${head(mine, presence.exercise)}
      <div class="status-bar is-training"><span>Set ${n} in progress</span><time data-since="${presence.since}">${clock(now() - presence.since)}</time></div>
      <p class="plan"><span>Target</span> ${esc(describe(presence.exercise, presence.plan))}</p>
      <form class="set-form" id="finish-form" novalidate>
        <div class="fields">${fields(ex, presence.plan, true)}</div>
        <p class="error" id="set-error" role="alert"></p>
        <button type="submit" class="primary">Finish set ${n}</button>
      </form>
      <button type="button" class="secondary" data-act="cancel">Cancel set (not recorded)</button>`;
  }
  if (presence.state === "resting") {
    const exercise = exerciseFor(mine);
    const last = me.session?.sets.at(-1);
    return `${head(mine, exercise)}
      ${last ? `<p class="plan is-done"><span>Set ${setNumber(last.exercise) - 1}</span> ${esc(describe(last.exercise, last))} <i>done</i></p>` : ""}
      <div class="status-bar is-resting"><span>Rest</span><time data-since="${presence.since}">${clock(now() - presence.since)}</time></div>
      ${chips(mine, exercise)}${startForm(mine, exercise)}
      <button type="button" class="secondary" data-act="step-off">Leave station</button>`;
  }
  if (mine) {
    // standing at a machine: just walked over, or cancelled a set
    const exercise = exerciseFor(mine);
    return `${head(mine, exercise)}${chips(mine, exercise)}${startForm(mine, exercise)}
      <button type="button" class="secondary" data-act="step-off">Leave station</button>`;
  }
  return `<div class="panel-head"><h2>Pick a machine</h2><button type="button" class="close" data-act="hide-panel" aria-label="Close panel">×</button></div>
    <p class="hint">Tap any free machine and you'll walk over to it. Free ones are marked at the corners.</p>`;
}

// The small button in the top bar that brings the panel back, saying what
// you're doing in the meantime.
function drawActivity() {
  const b = $("#activity-button");
  const show = inGym() && (!panelOpen || walkingTo) && $("#door").hidden;
  b.hidden = !show;
  if (!show) return;
  const { presence } = me;
  b.dataset.state = walkingTo ? "walking" : presence.state;
  b.innerHTML = walkingTo
    ? `Walking to ${esc(machineOf(walkingTo)?.name ?? "")}`
    : presence.state === "training"
      ? `Set in progress <time data-since="${presence.since}">${clock(now() - presence.since)}</time>`
      : presence.state === "resting"
        ? `Resting <time data-since="${presence.since}">${clock(now() - presence.since)}</time>`
        : "Your visit";
}

function drawPanel() {
  const panel = $("#panel");
  world.select(lockerView ? `locker:${lockerView.number}` : (walkingTo ?? note ?? leaving ?? me?.presence.machine ?? null));
  document.body.classList.toggle("is-walking", Boolean(walkingTo));
  document.body.classList.toggle("is-choosing", Boolean(inGym() && me.presence.state === "idle" && !me.presence.machine && !walkingTo));
  const open = inGym() && panelOpen && !walkingTo;
  panel.hidden = !open;
  panel.classList.toggle("is-locker", Boolean(open && lockerView));
  drawActivity();
  if (!open) return world.relayout();
  if (lockerView) {
    panel.dataset.view = "locker";
    panel.innerHTML = lockerView.mine
      ? lockerView.data
        ? lockerHtml(lockerView.data, me, describe)
        : `<p class="locker-empty">Opening locker ${pad(lockerView.number)}…</p>`
      : lockerDoorHtml(lockerView.number, lockerView.taken);
    return world.relayout();
  }
  const { presence } = me;
  panel.dataset.view = note ? "note" : leaving ? "leave" : presence.state === "idle" && presence.machine ? "setup" : presence.state;
  panel.innerHTML = passCard() + panelHtml() + visit();
  world.relayout();
}

function draw() {
  drawWorld();
  drawPanel();
  $("#pass-button").hidden = !me;
}

// ---- the door ----

function door(view, message = "") {
  $("#door").hidden = false;
  const box = $("#door-body");
  box.innerHTML = doorHtml(view, { colours: floor?.colours ?? [], me, message });
  box.querySelector("input, .primary")?.focus();
  drawActivity();
}

function closeDoor() {
  $("#door").hidden = true;
  store(sessionStorage, HERE_KEY, "1");
  drawActivity();
}

// ---- what you can do ----

async function refresh(next) {
  if (next) me = next;
  floor = await api("/api/floor");
  draw();
}

function forget(ask = true) {
  if (ask && me && !confirm(`Forget ${me.user.name} on this device? You'll need the gym pass ${me.pass} to come back as them.`)) return;
  pass = null;
  me = null;
  note = leaving = walkingTo = lockerView = null;
  showPass = false;
  world.cancelArrival();
  store(localStorage, PASS_KEY, null);
  store(sessionStorage, HERE_KEY, null);
  draw();
  door("new");
}

async function act(fn) {
  try {
    await fn();
  } catch (err) {
    if (err.status === 401) return forget(false);
    const slot = document.querySelector("#set-error") ?? document.querySelector("#door:not([hidden]) .error");
    if (slot) slot.textContent = err.message;
    else alert(err.message);
    // someone else may have taken the machine; show the gym as it is now
    if (err.status === 409) await refresh().catch(() => {});
  }
}

// What a set form says, ready to send: only the fields it has.
function setValues(form) {
  const out = {};
  for (const [k, v] of new FormData(form)) {
    const value = String(v).trim().replace(",", ".");
    if (k === "setting" && value === "") continue;
    out[k] = k === "amount" ? Number(value) : value;
  }
  return out;
}

document.addEventListener("click", (e) => {
  const t = e.target.closest("button");
  if (!t || t.classList.contains("hotspot")) return;

  if (t.dataset.door) return door(t.dataset.door);
  if (t.dataset.step) {
    const input = t.closest(".stepper").querySelector("input");
    const v = Number(input.value.replace(",", ".")) || 0;
    input.value = String(Math.max(0, Math.round((v + Number(t.dataset.by)) * 100) / 100));
    return;
  }
  if (t.dataset.choose) {
    choice.set(t.dataset.machine, t.dataset.choose);
    return drawPanel();
  }
  if (t.id === "pass-button") {
    showPass = panelOpen = true;
    return drawPanel();
  }
  if (t.id === "activity-button") {
    panelOpen = true;
    return drawPanel();
  }

  switch (t.dataset.act) {
    case "hide-panel":
      panelOpen = false;
      note = leaving = lockerView = null;
      return drawPanel();
    case "back":
      note = leaving = null;
      return drawPanel();
    case "walk-over": {
      const id = leaving;
      leaving = null;
      return walkOver(id);
    }
    case "close-locker":
      lockerView = null;
      return drawPanel();
    case "find-locker":
      world.focusLocker(me.locker);
      return world.select(`locker:${me.locker}`);
    case "hide-pass":
      showPass = false;
      return drawPanel();
    case "forget":
      return forget();
    case "cancel":
      return act(async () => refresh(await api("/api/cancel", {})));
    case "step-off":
      return act(async () => {
        await refresh(await api("/api/step-off", {}));
        world.focus(me.user.id);
      });
    case "leave":
      return act(async () => {
        await refresh(await api("/api/leave", {}));
        note = leaving = walkingTo = lockerView = null;
        world.cancelArrival();
        store(sessionStorage, HERE_KEY, null);
        door("welcome");
      });
    case "enter":
      return act(async () => {
        await refresh(await api("/api/enter", {}));
        panelOpen = true;
        closeDoor();
        world.focus(me.user.id);
      });
  }
});

addEventListener("keydown", (e) => {
  if (e.key !== "Escape" || !inGym() || !$("#door").hidden) return;
  panelOpen = false;
  note = leaving = lockerView = null;
  drawPanel();
});

document.addEventListener("submit", (e) => {
  e.preventDefault();
  const form = e.target;
  const data = Object.fromEntries(new FormData(form));

  if (form.id === "join-form") {
    return act(async () => {
      const out = await api("/api/identity", { name: data.name, colour: data.colour });
      pass = out.pass;
      store(localStorage, PASS_KEY, pass);
      showPass = panelOpen = true;
      await refresh(out);
      closeDoor();
      world.focus(me.user.id);
    });
  }
  if (form.id === "pass-form") {
    return act(async () => {
      pass = data.pass.trim();
      try {
        me = await api("/api/me");
      } catch (err) {
        pass = stored(localStorage, PASS_KEY);
        if (err.status === 401) return door("pass", "That pass doesn't match anyone here.");
        throw err;
      }
      pass = me.pass;
      store(localStorage, PASS_KEY, pass);
      if (me.presence.state === "away") {
        await refresh();
        return door("welcome");
      }
      await refresh(await api("/api/arrive", {}));
      closeDoor();
      world.focus(me.user.id, { instant: true });
    });
  }
  if (form.id === "start-form") {
    return act(async () => {
      const next = await api("/api/start", { machine: form.dataset.machine, exercise: form.dataset.exercise, ...setValues(form) });
      lockerView = null;
      await refresh(next);
      world.focus(me.user.id);
    });
  }
  if (form.id === "finish-form") {
    return act(async () => refresh(await api("/api/finish", setValues(form))));
  }
});

// Timers count on their own between redraws.
setInterval(() => {
  for (const t of document.querySelectorAll("time[data-since]")) t.textContent = clock(now() - Number(t.dataset.since));
}, 1000);

// ---- arriving ----

async function arrive() {
  try {
    floor = await api("/api/floor");
  } catch {
    $("#headcount").textContent = "Can't reach the gym right now";
    return;
  }
  world.name(new Map(floor.machines.map((m) => [m.id, m.name])));
  if (pass) {
    try {
      me = await api("/api/me");
      // opening the gym afresh starts you at the entrance; a refresh doesn't
      if (inGym() && !stored(sessionStorage, HERE_KEY)) me = await api("/api/arrive", {});
    } catch (err) {
      if (err.status === 401) store(localStorage, PASS_KEY, (pass = null));
    }
  }
  if (inGym()) {
    floor = await api("/api/floor");
    store(sessionStorage, HERE_KEY, "1");
  }
  draw();
  if (inGym()) world.focus(me.user.id, { instant: true });
  else {
    world.focusDoor();
    door(me ? "welcome" : "new");
  }
}

arrive();
