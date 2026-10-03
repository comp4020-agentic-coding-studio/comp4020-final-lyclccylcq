// The gym floor. The server holds everything that matters (who you are, your
// visits, your sets, where you're standing); this browser only keeps the gym
// pass that lets it act as you.

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
let openStation = null; // the station whose panel is showing
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

// Each station has a few places to stand, drawn as open spots when nobody's
// in them, so even an empty floor reads as a room for several people. Phones
// get fewer, staggered spots so labels don't collide in a narrow zone.
const SPOTS = {
  wide: { station: [[25, 44], [75, 44], [50, 72]], rest: [[16, 50], [39, 74], [62, 50], [85, 74]] },
  narrow: { station: [[28, 45], [72, 69]], rest: [[18, 46], [50, 69], [82, 46]] },
};
const narrow = matchMedia("(max-width: 760px)");

const hash = (id) => {
  let h = 2166136261;
  for (const c of id) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return h >>> 0;
};

// Who stands where: each person has a preferred spot (stable, so the room
// doesn't reshuffle on every redraw) and takes the next free one if it's
// taken. More people than spots spill onto the floor between them.
function placeAll(stationId, people) {
  const spots = SPOTS[narrow.matches ? "narrow" : "wide"][stationId === "rest" ? "rest" : "station"];
  const taken = new Array(spots.length).fill(null);
  const placed = [];
  for (const p of [...people].sort((a, b) => (a.id < b.id ? -1 : 1))) {
    const start = hash(p.id) % spots.length;
    const free = spots.findIndex((_, i) => taken[(start + i) % spots.length] === null);
    if (free === -1) {
      const h = hash(p.id);
      placed.push({ p, x: 15 + (h % 70), y: 40 + ((h >>> 8) % 25) });
      continue;
    }
    const i = (start + free) % spots.length;
    taken[i] = p;
    placed.push({ p, x: spots[i][0], y: spots[i][1] });
  }
  const open = spots.filter((_, i) => taken[i] === null);
  return { placed, open };
}

function statusLine(p) {
  if (p.state === "resting") return `Resting <time data-since="${p.since}">${clock(now() - p.since)}</time>`;
  if (p.state === "training") return "Training";
  return "Just arrived";
}

// Your own last set, on your own label only: the public floor carries no
// numbers, so nobody's weights sit next to anyone else's.
function ownSet(p) {
  if (p.state !== "resting") return "";
  const last = me.session?.sets.at(-1);
  return last && last.exercise === p.exercise ? `<span class="set">${esc(describeSet(last))}</span>` : "";
}

// ---- the floor ----

function drawFloor() {
  const people = floor?.people ?? [];
  for (const zone of document.querySelectorAll(".zone")) {
    const here = people.filter((p) => p.station === zone.dataset.station);
    const { placed, open } = placeAll(zone.dataset.station, here);
    zone.classList.toggle("is-busy", here.length > 0);
    zone.classList.toggle("is-open", openStation === zone.dataset.station);
    zone.querySelector(".crowd").innerHTML =
      open.map(([x, y]) => `<span class="spot" style="--x:${x}%;top:${y}%"></span>`).join("") +
      placed
        .map(({ p, x, y }) => {
          const you = me && p.id === me.user.id;
          return `<div class="person is-${p.state}${you ? " is-you" : ""}" style="--c:${esc(p.colour)};--x:${x}%;top:${y}%">
          <span class="body" aria-hidden="true">${esc(p.name.slice(0, 1).toUpperCase())}</span>
          <span class="tag"><b>${esc(p.name)}${you ? " <i>you</i>" : ""}</b>${p.exercise ? `<span class="what">${esc(p.exercise)}</span>` : ""}${you ? ownSet(p) : ""}<span class="status">${statusLine(p)}</span></span>
        </div>`;
        })
        .join("");
  }
  const others = people.filter((p) => !me || p.id !== me.user.id).length;
  const inGym = me && me.presence.state !== "away";
  $("#headcount").textContent =
    others === 0
      ? inGym ? "Just you on the floor so far" : "The floor is quiet right now"
      : `${others} ${others === 1 ? "other" : "others"} ${inGym ? "training with you" : "training now"}`;
}

narrow.addEventListener("change", drawFloor);

// ---- the panel beside (or below) the floor ----

function sessionList() {
  const sets = me.session?.sets ?? [];
  if (!sets.length) return `<p class="muted">No sets yet this visit.</p>`;
  return `<ol class="log">${sets
    .slice()
    .reverse()
    .map((s) => `<li><span>${esc(s.exercise)}</span><span>${esc(describeSet(s))}</span></li>`)
    .join("")}</ol>`;
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
  if (!me || me.presence.state === "away") {
    panel.innerHTML = `<p class="muted">Walk in to take a spot on the floor.</p>`;
    return;
  }
  const { presence } = me;
  const station = stations().find((s) => s.id === openStation);

  if (!station) {
    panel.innerHTML = `${passCard()}
      <h2>Pick a station</h2>
      <p class="muted">Tap a station on the floor to train there. The open spots are where other people stand when they're in.</p>
      <h3>This visit</h3>${sessionList()}
      <button type="button" class="leave" data-act="leave">Leave the gym</button>`;
    return;
  }

  const current = presence.exercise && station.exercises.includes(presence.exercise) ? presence.exercise : null;
  const last = current ? me.lastByExercise[current] : null;
  const resting = presence.state === "resting" && current;
  const weighted = station.weighted;
  const minutes = station.measure === "min";

  panel.innerHTML = `${passCard()}
    <div class="panel-head"><h2>${esc(station.name)}</h2><button type="button" class="link" data-act="close">Back to floor</button></div>
    <div class="chips" role="group" aria-label="Exercise">${station.exercises
      .map((e) => `<button type="button" class="chip${e === current ? " is-on" : ""}" data-exercise="${esc(e)}" aria-pressed="${e === current}">${esc(e)}</button>`)
      .join("")}</div>
    ${
      !current
        ? `<p class="muted">Choose what you're doing. You'll move to this station on the floor.</p>`
        : `${resting ? `<div class="rest"><span>Resting</span><time data-since="${presence.since}">${clock(now() - presence.since)}</time><button type="button" class="link" data-act="next">Start next set</button></div>` : `<div class="rest is-training"><span>Training</span><b>${esc(current)}</b></div>`}
      <form class="set-form" id="set-form" novalidate>
        <div class="fields">
          ${weighted ? stepper("weightKg", "Weight", last?.weightKg ?? 20, 2.5, "kg") : ""}
          ${stepper("amount", minutes ? "Time" : "Reps", last?.amount ?? (minutes ? 10 : 10), 1, minutes ? "min" : "reps")}
        </div>
        <p class="error" id="set-error" role="alert"></p>
        <button type="submit" class="primary">Finish set</button>
      </form>`
    }
    <h3>This visit</h3>${sessionList()}
    <button type="button" class="leave" data-act="leave">Leave the gym</button>`;
}

function draw() {
  drawFloor();
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
      <p class="lede">A small shared floor. Train on your own, alongside whoever else is in.</p>
      <form id="join-form">
        <label class="field"><span>Your name on the floor</span><input name="name" maxlength="24" autocomplete="nickname" required /></label>
        <fieldset class="swatches"><legend>Your colour</legend>${colours
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
  openStation = null;
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
  if (!t) return;

  if (t.classList.contains("zone-hit")) {
    if (!me || me.presence.state === "away") return;
    openStation = t.closest(".zone").dataset.station;
    draw();
    if (matchMedia("(max-width: 760px)").matches) $("#panel").scrollIntoView({ behavior: "smooth", block: "start" });
    return;
  }
  if (t.dataset.door) return door(t.dataset.door);
  if (t.dataset.step) {
    const input = t.closest(".stepper").querySelector("input");
    const v = Number(input.value) || 0;
    input.value = String(Math.max(0, Math.round((v + Number(t.dataset.by)) * 100) / 100));
    return;
  }
  if (t.dataset.exercise) return act(async () => refresh(await api("/api/activity", { exercise: t.dataset.exercise })));
  if (t.id === "pass-button") {
    showPass = true;
    return drawPanel();
  }

  switch (t.dataset.act) {
    case "close":
      openStation = null;
      return draw();
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
        openStation = null;
        door("welcome");
      });
    case "enter":
      return act(async () => {
        await refresh(await api("/api/enter", {}));
        closeDoor();
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
      storePass(pass);
      await refresh();
      if (me.presence.state === "away") door("welcome");
      else closeDoor();
    });
  }
  if (form.id === "set-form") {
    return act(async () => {
      const exercise = me.presence.exercise;
      await refresh(
        await api("/api/sets", {
          exercise,
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
  // back mid-workout: straight onto the floor, where you were
  if (me && me.presence.state !== "away") openStation = stationOf(me.presence.exercise)?.id ?? null;
  draw();
  if (!me) door("new");
  else if (me.presence.state === "away") door("welcome");
}

arrive();
