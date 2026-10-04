// The gym page. The server holds everything that matters (who you are, your
// visits, your sets, what you're doing); this browser only keeps the gym pass
// that lets it act as you. world.js turns what people are doing into where
// they stand and how they move.

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
let clockOffset = 0; // server clock minus ours, so rest timers agree across devices
let picking = false; // the panel is showing where to go next
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
const stations = () => floor?.stations ?? [];
const stationOf = (exercise) => stations().find((s) => s.exercises.includes(exercise));
const inGym = () => me && me.presence.state !== "away";

function clock(ms) {
  const s = Math.max(0, Math.floor(ms / 1000));
  const mm = String(Math.floor(s / 60) % 60).padStart(2, "0");
  const ss = String(s % 60).padStart(2, "0");
  return s >= 3600 ? `${Math.floor(s / 3600)}:${mm}:${ss}` : `${mm}:${ss}`;
}

function describeSet(set) {
  const station = stationOf(set.exercise);
  if (station?.measure === "min") return `${set.amount} min`;
  const weight = set.weightKg ? `${set.weightKg} kg` : "Bodyweight";
  return `${weight} × ${set.amount}`;
}

// ---- the world ----

const world = createWorld({
  scroller: $("#world-scroll"),
  sizer: $("#world-size"),
  world: $("#world"),
  canvas: $("#world-canvas"),
  layer: $("#people"),
  panel: $("#panel"),
  onStation(id) {
    if (!inGym()) return;
    const station = stations().find((s) => s.id === id);
    if (!station) return;
    if (station.exercises.includes(me.presence.exercise)) {
      picking = false;
      return drawPanel();
    }
    choose(station.exercises[0]);
  },
});

function statusLine(p) {
  if (p.state === "resting") return `Resting <time data-since="${p.since}">${clock(now() - p.since)}</time>`;
  if (p.state === "training") return "Training";
  return "Just arrived";
}

// Your own last set, on your own name tag only: the public floor carries no
// numbers, so nobody's weights sit next to anyone else's.
function ownSet(p) {
  if (p.state !== "resting") return "";
  const last = me.session?.sets.at(-1);
  return last && last.exercise === p.exercise ? `<span class="set">${esc(describeSet(last))}</span>` : "";
}

function nameTag(p) {
  const you = me && p.id === me.user.id;
  return `<span class="tag" style="--c:${esc(p.colour)}"><b>${esc(p.name)}${you ? " <i>you</i>" : ""}</b>${
    p.exercise ? `<span class="what">${esc(p.exercise)}</span>` : ""
  }${you ? ownSet(p) : ""}<span class="status">${statusLine(p)}</span></span>`;
}

function drawWorld() {
  const people = floor?.people ?? [];
  world.setPeople(people, me?.user.id ?? null, nameTag);
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
        .map((s) => `<li><span>${esc(s.exercise)}</span><span>${esc(describeSet(s))}</span></li>`)
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

function drawPanel() {
  const panel = $("#panel");
  document.body.classList.toggle("is-picking", Boolean(inGym() && (picking || !stationOf(me.presence.exercise))));
  if (!inGym()) {
    panel.hidden = true;
    world.relayout();
    return;
  }
  panel.hidden = false;
  const { presence } = me;
  const station = stationOf(presence.exercise);

  if (picking || !station) {
    panel.innerHTML = `${passCard()}
      <div class="panel-head"><h2>Where to?</h2>${station ? `<button type="button" class="link" data-act="close">Back</button>` : ""}</div>
      <p class="hint">Tap any machine in the gym, or pick one here. You'll walk over to it.</p>
      <div class="picks">${stations()
        .flatMap((s) =>
          s.exercises.map(
            (e) =>
              `<button type="button" class="pick${e === presence.exercise ? " is-on" : ""}" data-exercise="${esc(e)}"><b>${esc(e)}</b><span>${esc(s.name)}</span></button>`,
          ),
        )
        .join("")}</div>
      ${visit()}`;
    world.relayout();
    return;
  }

  const exercise = presence.exercise;
  const last = me.lastByExercise[exercise];
  const minutes = station.measure === "min";
  panel.innerHTML = `${passCard()}
    <div class="panel-head"><h2>${esc(exercise)}</h2><button type="button" class="link" data-act="pick">Change</button></div>
    ${
      presence.state === "resting"
        ? `<div class="status-bar is-resting"><span>Resting</span><time data-since="${presence.since}">${clock(now() - presence.since)}</time><button type="button" class="link" data-act="next">Start next set</button></div>`
        : `<div class="status-bar"><span>Training</span><b>at the ${esc(station.name)}</b></div>`
    }
    <form class="set-form" id="set-form" novalidate>
      <div class="fields">
        ${station.weighted ? stepper("weightKg", "Weight", last?.weightKg ?? 20, 2.5, "kg") : ""}
        ${stepper("amount", minutes ? "Time" : "Reps", last?.amount ?? 10, 1, minutes ? "min" : "reps")}
      </div>
      <p class="error" id="set-error" role="alert"></p>
      <button type="submit" class="primary">Finish set</button>
    </form>
    ${visit()}`;
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

async function choose(exercise) {
  await act(async () => {
    await refresh(await api("/api/activity", { exercise }));
    picking = false;
    drawPanel();
    world.focus(me.user.id);
  });
}

function forget(ask = true) {
  if (ask && me && !confirm(`Forget ${me.user.name} on this device? You'll need the gym pass ${me.pass} to come back as them.`)) return;
  pass = null;
  me = null;
  picking = false;
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
  if (t.dataset.exercise) return choose(t.dataset.exercise);
  if (t.id === "pass-button") {
    showPass = true;
    return drawPanel();
  }

  switch (t.dataset.act) {
    case "pick":
      picking = true;
      return drawPanel();
    case "close":
      picking = false;
      return drawPanel();
    case "hide-pass":
      showPass = false;
      return drawPanel();
    case "forget":
      return forget();
    case "next":
      return act(async () => refresh(await api("/api/activity", { exercise: me.presence.exercise })));
    case "leave":
      return act(async () => {
        await refresh(await api("/api/leave", {}));
        picking = false;
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
  if (form.id === "set-form") {
    return act(async () => {
      await refresh(
        await api("/api/sets", {
          exercise: me.presence.exercise,
          weightKg: data.weightKg?.trim(),
          amount: Number(data.amount),
        }),
      );
    });
  }
});

// Rest timers count on their own between redraws.
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
