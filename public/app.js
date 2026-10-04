// The gym page. The server holds everything that matters (who you are, your
// visits, your sets, which machine you're on and what you're doing); this
// browser only keeps the gym pass that lets it act as you. world.js turns what
// people are doing into where they stand and how they move.
//
// You start a set from the equipment: tap a machine, set it up, Start set.
// Finish set records it and you rest beside the machine until the next one.

import { createWorld } from "./world.js";

const PASS_KEY = "same-gym.pass";

const $ = (sel) => document.querySelector(sel);
const esc = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

function storedPass() {
  try {
    return localStorage.getItem(PASS_KEY);
  } catch {
    return null;
  }
}

function storePass(pass) {
  try {
    if (pass) localStorage.setItem(PASS_KEY, pass);
    else localStorage.removeItem(PASS_KEY);
  } catch {
    // private window: you stay you until the tab closes, and the pass gets you back
  }
}

let pass = storedPass();
let me = null; // GET /api/me
let floor = null; // GET /api/floor
let clockOffset = 0; // server clock minus ours, so timers agree across devices
let selected = null; // a machine you've tapped and are setting up, not yet started
const choice = new Map(); // machine id → the exercise picked for it
let showPass = false; // the pass card, shown once on joining and on request

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

function describe(exercise, weightKg, amount) {
  const ex = exerciseOf(exercise);
  if (ex?.measure === "min") return `${amount} min`;
  if (!ex?.weighted) return `${amount} reps`;
  return `${weightKg ? `${weightKg} kg` : "Bodyweight"} × ${amount}`;
}

// ---- the world ----

const world = createWorld({
  scroller: $("#world-scroll"),
  sizer: $("#world-size"),
  world: $("#world"),
  canvas: $("#world-canvas"),
  layer: $("#people"),
  panel: $("#panel"),
  onMachine(id) {
    if (!inGym()) return;
    selected = id === me.presence.machine && me.presence.state !== "idle" ? null : id;
    drawPanel();
    world.focusMachine(id);
  },
});

// Your own numbers, on your own name tag only: the public floor carries no
// weights or reps, so nobody's numbers sit next to anyone else's.
function ownNumbers(p) {
  const { presence } = me;
  if (p.state === "training" && presence.plan) return `<span class="set">${esc(describe(presence.exercise, presence.plan.weightKg, presence.plan.amount))}</span>`;
  const last = me.session?.sets.at(-1);
  if (p.state === "resting" && last?.exercise === p.exercise) return `<span class="set">${esc(describe(last.exercise, last.weightKg, last.amount))}</span>`;
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
  world.select(selected);
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
        .map((s) => `<li><span>${esc(s.exercise)}</span><span>${esc(describe(s.exercise, s.weightKg, s.amount))}</span></li>`)
        .join("")}</ol>`
    : `<p class="muted">No sets yet this visit.</p>`;
  return `<div class="foot">
    <details class="visit"><summary>This visit · ${sets.length} ${sets.length === 1 ? "set" : "sets"}</summary>${list}</details>
    <button type="button" class="leave" data-act="leave">Leave the gym</button>
  </div>`;
}

function passCard() {
  if (!showPass) return "";
  return `<div class="pass-card">
    <p>Your gym pass</p>
    <code>${esc(me.pass)}</code>
    <p class="muted">This browser remembers you. On another device, use this pass to come back as yourself.</p>
    <div class="row"><button type="button" class="link" data-act="hide-pass">Got it</button><button type="button" class="link" data-act="forget">Forget this device</button></div>
  </div>`;
}

function stepper(name, label, value, step, unit) {
  return `<label class="field"><span>${label}</span>
    <span class="stepper">
      <button type="button" data-step="${name}" data-by="${-step}" aria-label="Less">−</button>
      <input name="${name}" inputmode="decimal" value="${esc(value)}" autocomplete="off" />
      <span class="unit">${unit}</span>
      <button type="button" data-step="${name}" data-by="${step}" aria-label="More">+</button>
    </span></label>`;
}

function head(machine, title, close = true) {
  return `<div class="panel-head"><div><p class="eyebrow">${esc(machine.name)}</p><h2>${esc(title)}</h2></div>${
    close ? `<button type="button" class="link" data-act="close">Close</button>` : ""
  }</div>`;
}

// Which exercise a machine is set to: what you picked, what you last did on
// it, or its first.
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

// The inputs for a set, prefilled from the plan you just did, else your last
// set of this exercise.
function setForm(machine, exercise, label) {
  const ex = exerciseOf(exercise);
  const { presence } = me;
  const prev = presence.machine === machine.id && presence.exercise === exercise && presence.plan ? presence.plan : me.lastByExercise[exercise];
  const minutes = ex.measure === "min";
  return `<form class="set-form" id="start-form" data-machine="${esc(machine.id)}" data-exercise="${esc(exercise)}" novalidate>
    <div class="fields">
      ${ex.weighted ? stepper("weightKg", "Weight", prev?.weightKg ?? 20, 2.5, "kg") : ""}
      ${stepper("amount", minutes ? "Time" : "Reps", prev?.amount ?? (minutes ? 20 : 10), minutes ? 5 : 1, minutes ? "min" : "reps")}
    </div>
    <p class="error" id="set-error" role="alert"></p>
    <button type="submit" class="primary">${label}</button>
  </form>`;
}

function drawPanel() {
  const panel = $("#panel");
  world.select(selected);
  document.body.classList.toggle("is-choosing", Boolean(inGym() && me.presence.state === "idle" && !selected));
  if (!inGym()) {
    panel.hidden = true;
    world.relayout();
    return;
  }
  panel.hidden = false;
  const { presence } = me;
  const mine = presence.machine && machineOf(presence.machine);
  let html;

  if (selected && selected !== presence.machine) {
    // setting up a machine you aren't on
    const m = machineOf(selected);
    const holder = holderOf(m.id);
    const exercise = exerciseFor(m);
    if (holder && holder.id !== me.user.id) {
      html = `${head(m, kindOf(m.kind).name)}<p class="note">${esc(holder.name)} is on this one right now. Try another ${esc(kindOf(m.kind).name.toLowerCase())}.</p>`;
    } else if (presence.state === "training") {
      html = `${head(m, exercise)}<p class="note">You're mid-set on the ${esc(mine.name)}. Finish or cancel it before starting here.</p>
        <button type="button" class="secondary" data-act="close">Back to my set</button>`;
    } else {
      html = `${head(m, exercise)}${chips(m, exercise)}${setForm(m, exercise, "Start set")}`;
    }
  } else if (presence.state === "training") {
    html = `${head(mine, presence.exercise, false)}
      <div class="status-bar is-training"><span>Set in progress</span><time data-since="${presence.since}">${clock(now() - presence.since)}</time></div>
      <p class="plan">${esc(describe(presence.exercise, presence.plan.weightKg, presence.plan.amount))}</p>
      <button type="button" class="primary" data-act="finish">Finish set</button>
      <button type="button" class="secondary" data-act="cancel">Cancel set</button>`;
  } else if (presence.state === "resting") {
    const exercise = exerciseFor(mine);
    html = `${head(mine, exercise, false)}
      <p class="plan is-done">${esc(describe(presence.exercise, presence.plan.weightKg, presence.plan.amount))} <span>completed</span></p>
      <div class="status-bar is-resting"><span>Rest</span><time data-since="${presence.since}">${clock(now() - presence.since)}</time></div>
      ${chips(mine, exercise)}${setForm(mine, exercise, "Start next set")}
      <button type="button" class="secondary" data-act="step-off">Leave station</button>`;
  } else if (mine) {
    // back by a machine after cancelling a set
    const exercise = exerciseFor(mine);
    html = `${head(mine, exercise, false)}${chips(mine, exercise)}${setForm(mine, exercise, "Start set")}
      <button type="button" class="secondary" data-act="step-off">Leave station</button>`;
  } else {
    html = `<h2>Pick a machine</h2>
      <p class="hint">Tap any free machine in the gym to set up a set. Free ones are marked at the corners.</p>`;
  }
  panel.innerHTML = passCard() + html + visit();
  panel.dataset.view = selected && selected !== presence.machine ? "setup" : presence.state;
  world.relayout();
}

function draw() {
  drawWorld();
  drawPanel();
  $("#pass-button").hidden = !me;
}

// ---- the door ----

function door(view, message = "") {
  const box = $("#door-body");
  $("#door").hidden = false;
  const colours = floor?.colours ?? [];
  if (view === "new") {
    box.innerHTML = `<h1 id="door-title">Walk into the gym</h1>
      <p class="lede">A shared gym floor. Train on your own, alongside whoever else is in.</p>
      <form id="join-form">
        <label class="field"><span>Your name in the gym</span><input name="name" maxlength="24" autocomplete="nickname" required /></label>
        <fieldset class="swatches"><legend>Your shirt</legend>${colours
          .map((c, i) => `<label style="--c:${c}"><input type="radio" name="colour" value="${c}"${i === 0 ? " checked" : ""} /><span class="sr">${c}</span></label>`)
          .join("")}</fieldset>
        <p class="error" role="alert">${esc(message)}</p>
        <button type="submit" class="primary">Walk in</button>
      </form>
      <button type="button" class="link" data-door="pass">Been here before? Use your gym pass</button>`;
  } else if (view === "pass") {
    box.innerHTML = `<h1 id="door-title">Come back in</h1>
      <p class="lede">Enter the gym pass you were given on your first visit.</p>
      <form id="pass-form">
        <label class="field"><span>Gym pass</span><input name="pass" placeholder="XXXX-XXXX-XXXX" autocomplete="off" autocapitalize="characters" required /></label>
        <p class="error" role="alert">${esc(message)}</p>
        <button type="submit" class="primary">Come back in</button>
      </form>
      <button type="button" class="link" data-door="new">I'm new here</button>`;
  } else {
    const v = me.lastVisit;
    const when = v ? new Date(v.endedAt).toLocaleDateString(document.documentElement.lang, { weekday: "long", day: "numeric", month: "short" }) : "";
    box.innerHTML = `<h1 id="door-title">Welcome back, ${esc(me.user.name)}</h1>
      <p class="lede">${v ? `Last visit ${esc(when)}, ${v.sets} ${v.sets === 1 ? "set" : "sets"}. ` : ""}Walk back in and pick up where you like.</p>
      <p class="error" role="alert">${esc(message)}</p>
      <button type="button" class="primary" data-act="enter">Walk in</button>
      <button type="button" class="link" data-act="forget">Not ${esc(me.user.name)}? Start fresh</button>`;
  }
  box.querySelector("input, .primary")?.focus();
}

const closeDoor = () => ($("#door").hidden = true);

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
  selected = null;
  showPass = false;
  storePass(null);
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

document.addEventListener("click", (e) => {
  const t = e.target.closest("button");
  if (!t || t.classList.contains("hotspot")) return;

  if (t.dataset.door) return door(t.dataset.door);
  if (t.dataset.step) {
    const input = t.closest(".stepper").querySelector("input");
    const v = Number(input.value) || 0;
    input.value = String(Math.max(0, Math.round((v + Number(t.dataset.by)) * 100) / 100));
    return;
  }
  if (t.dataset.choose) {
    choice.set(t.dataset.machine, t.dataset.choose);
    return drawPanel();
  }
  if (t.id === "pass-button") {
    showPass = true;
    return drawPanel();
  }

  switch (t.dataset.act) {
    case "close":
      selected = null;
      return drawPanel();
    case "hide-pass":
      showPass = false;
      return drawPanel();
    case "forget":
      return forget();
    case "finish":
      return act(async () => refresh(await api("/api/finish", {})));
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
        selected = null;
        door("welcome");
      });
    case "enter":
      return act(async () => {
        await refresh(await api("/api/enter", {}));
        closeDoor();
        world.focus(me.user.id);
      });
  }
});

document.addEventListener("submit", (e) => {
  e.preventDefault();
  const form = e.target;
  const data = Object.fromEntries(new FormData(form));

  if (form.id === "join-form") {
    return act(async () => {
      const out = await api("/api/identity", { name: data.name, colour: data.colour });
      pass = out.pass;
      storePass(pass);
      showPass = true;
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
        pass = storedPass();
        if (err.status === 401) return door("pass", "That pass doesn't match anyone here.");
        throw err;
      }
      pass = me.pass;
      storePass(pass);
      await refresh();
      if (me.presence.state === "away") door("welcome");
      else {
        closeDoor();
        world.focus(me.user.id, { instant: true });
      }
    });
  }
  if (form.id === "start-form") {
    return act(async () => {
      const next = await api("/api/start", {
        machine: form.dataset.machine,
        exercise: form.dataset.exercise,
        weightKg: data.weightKg?.trim(),
        amount: Number(data.amount),
      });
      selected = null;
      await refresh(next);
      world.focus(me.user.id);
    });
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
    } catch (err) {
      if (err.status === 401) storePass((pass = null));
    }
  }
  draw();
  // back mid-workout: straight into the gym, where you were
  if (inGym()) world.focus(me.user.id, { instant: true });
  else {
    world.focusDoor();
    door(me ? "welcome" : "new");
  }
}

arrive();
