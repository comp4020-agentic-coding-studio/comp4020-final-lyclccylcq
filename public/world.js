// The gym as a place: its layout, who is on which machine, and the camera.
//
// The server says what each person is doing: which machine, which exercise,
// and whether they're mid-set, resting or not on anything. Everything visual
// follows from that here: where they stand, the route they walk, which
// animation plays. Nothing about position or frames is stored; reloading
// derives the same picture.

import { DECOR, KINDS, LOCKER, PERSON, T, decorSprite, lockerSprite, paintAisleEdges, paintFloor, paintInnerWall, paintLight, paintText, paintWalls, personSprite, stationSprite } from "./sprites.js";

export const W = 72;
export const H = 46;
const DOOR = { x: 6, w: 3 };
const SPAWN = [7, H - 2];

const ZONES = [
  { name: "CARDIO", floor: "cardio", x: 1, y: 3, w: 24, h: 12 },
  { name: "BACK & ARMS", floor: "machines", x: 25, y: 3, w: 24, h: 12 },
  { name: "FREE WEIGHTS", floor: "free", x: 49, y: 3, w: 22, h: 12 },
  { floor: "aisle", x: 1, y: 15, w: 70, h: 2, edges: true },
  { floor: "locker", x: 1, y: 18, w: 13, h: 14 },
  { name: "RECEPTION", floor: "lobby", x: 1, y: 33, w: 13, h: 12 },
  { floor: "entry", x: 5, y: 40, w: 5, h: 5 },
  { floor: "aisle", x: 15, y: 17, w: 1, h: 28, edges: true },
  { name: "CHEST", floor: "bench", x: 16, y: 17, w: 23, h: 12 },
  { name: "LEGS", floor: "legs", x: 39, y: 17, w: 32, h: 12 },
  { floor: "wood", x: 40, y: 18, w: 5, h: 5 },
  { floor: "wood", x: 46, y: 18, w: 5, h: 5 },
  { floor: "wood", x: 50, y: 23, w: 6, h: 4 },
  { floor: "wood", x: 56, y: 23, w: 6, h: 4 },
  { floor: "aisle", x: 16, y: 29, w: 55, h: 2, edges: true },
  { name: "STRETCH", floor: "recovery", x: 16, y: 31, w: 29, h: 14 },
  { name: "WATER & REST", floor: "lounge", x: 45, y: 31, w: 26, h: 14 },
];

const WALL = [
  { kind: "window", x: 2, w: 5 },
  { kind: "tv", x: 8, w: 3 },
  { kind: "window", x: 12, w: 5 },
  { kind: "window", x: 18, w: 5 },
  { kind: "poster", x: 26, w: 2, colour: "#e2574c" },
  { kind: "clock", x: 33, w: 1 },
  { kind: "poster", x: 39, w: 2, colour: "#3fa7a0" },
  { kind: "poster", x: 45, w: 2, colour: "#f1c13b" },
  { kind: "mirror", x: 49, w: 22 },
];
const LIGHT = [[2, 5], [12, 5], [18, 5]];

// Walls inside the building, with their doorways: the locker room sits
// between reception and the gym floor. [x, y, length, across?, gaps]
const INNER_WALLS = [
  [1, 17, 13, true, []],
  [1, 32, 13, true, [[11, 2]]],
  [14, 17, 28, false, [[19, 2], [36, 2]]],
];
const wallTiles = INNER_WALLS.flatMap(([x, y, n, across, gaps]) =>
  Array.from({ length: n }, (_, i) => (across ? [x + i, y] : [x, y + i]))
    .filter(([tx, ty]) => !gaps.some(([g, len]) => (across ? tx : ty) >= g && (across ? tx : ty) < g + len))
    .map(([tx, ty]) => [tx, ty, across]),
);

// The locker room: three banks of twelve along the room, numbered from 1.
export const LOCKER_SPOTS = Array.from({ length: 36 }, (_, i) => {
  const [tx, ty] = [2 + (i % 12), 18 + Math.floor(i / 12) * 5];
  return { number: i + 1, tx, ty, stand: [tx, ty + 2] };
});

// Where each machine stands: the top-left tile of its footprint, in the
// order of the server's machines (bench A, bench B, …).
const MACHINES_AT = {
  treadmill: [[2, 5], [6, 5], [10, 5], [14, 5]],
  bike: [[3, 10], [7, 10], [11, 10]],
  rower: [[15, 11], [20, 11]],
  stairs: [[19, 5], [22, 5]],
  pulldown: [[26, 5], [30, 5]],
  row: [[34, 5]],
  pullup: [[38, 5]],
  shoulder: [[42, 5]],
  preacher: [[45, 5]],
  cable: [[26, 10], [32, 10]],
  dumbbells: [[53, 8], [58, 8], [63, 8]],
  dbbench: [[51, 11], [57, 11]],
  bench: [[17, 19], [22, 19], [27, 19]],
  incline: [[17, 24], [22, 24]],
  rack: [[41, 19], [47, 19]],
  legpress: [[53, 19], [58, 19]],
  platform: [[51, 24], [57, 24]],
  legcurl: [[63, 19]],
  legext: [[67, 19]],
  mats: [[19, 34], [25, 34], [19, 39], [25, 39]],
};

// Furniture: [kind, tile x, tile y] of each footprint's top-left.
const FURNITURE = [
  ["towels", 16, 9], ["bin", 22, 9], ["plant", 23, 9],
  ["kettlebells", 38, 11], ["plateTree", 43, 11], ["towels", 45, 11],
  ["dumbbellRack", 50, 5], ["dumbbellRack", 60, 5], ["kettlebells", 63, 12], ["bin", 68, 12],
  ["barRack", 32, 19], ["plateTree", 36, 19], ["plateTree", 36, 24], ["plateRack", 28, 25], ["bin", 37, 27],
  ["plateTree", 41, 25], ["plateTree", 47, 25], ["plateRack", 64, 24], ["kettlebells", 66, 25], ["bin", 69, 27],
  ["rollers", 31, 33], ["ball", 36, 33], ["ball", 37, 36], ["rollers", 31, 39], ["towels", 40, 33], ["plant", 43, 43], ["bin", 41, 39],
  ["water", 60, 32], ["bin", 64, 33], ["sofa", 55, 33], ["vending", 66, 32], ["plant", 69, 36],
  ["bench", 48, 38], ["bench", 56, 38], ["plant", 62, 41], ["towels", 64, 38],
  // the locker room
  ["lockerBench", 3, 21], ["lockerBench", 9, 21], ["lockerBench", 3, 26], ["lockerBench", 9, 26],
  ["shoes", 7, 22], ["shoes", 13, 27], ["laundry", 13, 21], ["sink", 6, 26], ["towelRail", 12, 26],
  // reception
  ["counter", 6, 34], ["stool", 9, 33], ["board", 11, 33], ["kiosk", 12, 38],
  ["turnstile", 5, 39], ["turnstile", 9, 39], ["plant", 2, 42], ["plant", 12, 42],
];

// Where you stand on walking in: just past the turnstiles.
const ENTRANCE = [[7, 37], [5, 37], [9, 37], [3, 37], [11, 37], [7, 36]];

// Where you wait when you've stepped away from a machine: by the water.
const LOUNGE = [[49, 35], [53, 36], [57, 36], [61, 35], [51, 41], [55, 41], [60, 40], [64, 36]];

// ---- derived geometry ----

const LETTERS = "abcdefgh";
const feet = ([tx, ty]) => ({ x: tx * T + 8, y: ty * T + 13 });

export const STATIONS = Object.entries(MACHINES_AT).flatMap(([kind, list]) => {
  const k = KINDS[kind];
  return list.map(([tx, ty], i) => {
    const stand = k.inPlace ? [tx, ty] : [tx + Math.floor(k.fw / 2), ty + k.fh];
    const anchor = k.inPlace ? { x: feet(stand).x, y: feet(stand).y + 1 } : { x: tx * T + (k.fw * T) / 2, y: (ty + k.fh) * T - 1 };
    // the part of the world you click: the machine and the spot in front of it
    const box = k.inPlace
      ? { x: tx - 1, y: ty - 1, w: k.fw + 1, h: 2 }
      : { x: tx, y: ty - Math.ceil((k.h - 2 - k.fh * T) / T), w: k.fw, h: k.fh + Math.ceil((k.h - 2 - k.fh * T) / T) };
    return { id: `${kind}-${LETTERS[i]}`, kind, tx, ty, stand, anchor, box };
  });
});
const stationById = new Map(STATIONS.map((s) => [s.id, s]));

const blocked = new Uint8Array(W * H);
const block = (tx, ty, w, h) => {
  for (let y = ty; y < ty + h; y++) for (let x = tx; x < tx + w; x++) blocked[y * W + x] = 1;
};
block(0, 0, W, 3);
block(0, 0, 1, H);
block(W - 1, 0, 1, H);
block(0, H - 1, W, 1);
for (const [x, y] of wallTiles) block(x, y, 1, 1);
for (const l of LOCKER_SPOTS) block(l.tx, l.ty, 1, 2);
for (const [kind, x, y] of FURNITURE) if (!DECOR[kind].walk) block(x, y, DECOR[kind].fw, DECOR[kind].fh);
for (const s of STATIONS) if (!KINDS[s.kind].inPlace) block(s.tx, s.ty, KINDS[s.kind].fw, KINDS[s.kind].fh);

// Breadth-first over the tile grid, then only the corners are kept, so people
// walk the aisles in straight lines and turn where the floor turns.
export function route(from, to) {
  const start = from[1] * W + from[0];
  const goal = to[1] * W + to[0];
  const prev = new Int32Array(W * H).fill(-1);
  prev[start] = start;
  const queue = [start];
  for (let head = 0; head < queue.length && prev[goal] === -1; head++) {
    const i = queue[head];
    const x = i % W;
    const y = (i - x) / W;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx;
      const ny = y + dy;
      const n = ny * W + nx;
      if (nx < 0 || ny < 0 || nx >= W || ny >= H || prev[n] !== -1 || (blocked[n] && n !== goal)) continue;
      prev[n] = i;
      queue.push(n);
    }
  }
  if (prev[goal] === -1) return [to];
  const tiles = [];
  for (let i = goal; i !== start; i = prev[i]) tiles.unshift([i % W, Math.floor(i / W)]);
  return tiles.filter((t, i) => {
    const a = tiles[i - 1] ?? from;
    const b = tiles[i + 1];
    return !b || (a[0] === t[0]) !== (t[0] === b[0]);
  });
}

// for the layout check in spec/
export const LAYOUT = { FURNITURE, LOUNGE, ENTRANCE, SPAWN, blocked, wallTiles };

const tileOf = (e) => [Math.round((e.x - 8) / T), Math.round((e.y - 13) / T)];

const hashId = (id) => {
  let h = 2166136261;
  for (const c of id) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return h >>> 0;
};

// ---- the world ----

export function createWorld({ scroller, sizer, world, canvas, layer, panel, onMachine, onLocker }) {
  const g = canvas.getContext("2d");
  canvas.width = W * T;
  canvas.height = H * T;

  const ground = document.createElement("canvas");
  ground.width = W * T;
  ground.height = H * T;
  paintGround(ground.getContext("2d"));

  const reduced = matchMedia("(prefers-reduced-motion: reduce)");
  const narrow = matchMedia("(max-width: 760px)");
  let S = 3;
  let seen = false; // the first setPeople places people; later arrivals walk in
  let meId = null;
  let follow = null;
  let poseOf = () => "";
  const entities = new Map();
  let lockerState = new Map(); // number → "free" | "taken" | "mine"
  let mineColour = null;
  let visiting = null; // your locker, if you've walked over to it
  let arrival = null; // { key, done }: call done once you're standing at that machine

  // One button per machine, over the machine itself.
  const hotspots = new Map();
  const spots = world.querySelector(".hotspots");
  for (const s of STATIONS) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "hotspot is-free";
    b.dataset.machine = s.id;
    b.dataset.kind = s.kind;
    b.innerHTML = `<span></span>`;
    spots.append(b);
    hotspots.set(s.id, b);
  }
  const lockerButtons = new Map();
  for (const l of LOCKER_SPOTS) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "hotspot locker-spot is-free";
    b.dataset.locker = l.number;
    b.setAttribute("aria-label", `Locker ${l.number}`);
    b.innerHTML = `<span>Locker ${String(l.number).padStart(2, "0")}</span>`;
    spots.append(b);
    lockerButtons.set(l.number, b);
  }

  // ---- scale and layout ----

  function rescale() {
    const base = narrow.matches ? 2 : 3;
    S = Math.max(1, Math.round(base * devicePixelRatio)) / devicePixelRatio;
    world.style.width = `${W * T * S}px`;
    world.style.height = `${H * T * S}px`;
    world.style.setProperty("--s", S);
    for (const s of STATIONS) {
      Object.assign(hotspots.get(s.id).style, {
        left: `${s.box.x * T * S}px`,
        top: `${s.box.y * T * S}px`,
        width: `${s.box.w * T * S}px`,
        height: `${s.box.h * T * S}px`,
      });
    }
    for (const l of LOCKER_SPOTS) {
      Object.assign(lockerButtons.get(l.number).style, {
        left: `${l.tx * T * S}px`,
        top: `${l.ty * T * S}px`,
        width: `${T * S}px`,
        height: `${2 * T * S}px`,
      });
    }
    pad();
  }

  // Room to scroll the far edge of the gym out from under the panel.
  function pad() {
    const r = panel.hidden ? null : panel.getBoundingClientRect();
    const right = r && !narrow.matches ? r.width + 32 : 0;
    const bottom = r && narrow.matches ? r.height : 0;
    sizer.style.width = `${W * T * S + right}px`;
    sizer.style.height = `${H * T * S + bottom}px`;
  }
  new ResizeObserver(pad).observe(panel);
  narrow.addEventListener("change", rescale);
  matchMedia(`(resolution: ${devicePixelRatio}dppx)`).addEventListener("change", rescale);

  // ---- people ----

  // Where each person stands. A machine is held by whoever is training or
  // resting on it. Anyone not at a machine stands at the entrance (just
  // arrived) or by the water (stepped away), keeping the spot they had.
  function placesFor(people) {
    const out = new Map();
    const held = new Map();
    for (const p of people) {
      if (p.machine && stationById.has(p.machine) && (p.state === "training" || p.state === "resting") && !held.has(p.machine)) {
        held.set(p.machine, p.id);
      }
    }
    const waiting = { entrance: [], lounge: [] };
    for (const p of people) {
      const s = p.machine && stationById.get(p.machine);
      if (s && (!held.has(s.id) || held.get(s.id) === p.id)) out.set(p.id, { key: s.id, stand: s.stand, station: s });
      else waiting[p.spot === "entrance" ? "entrance" : "lounge"].push(p);
    }
    for (const [name, spots] of [["entrance", ENTRANCE], ["lounge", LOUNGE]]) {
      const taken = new Set();
      const rest = [];
      for (const p of waiting[name].sort((a, b) => (a.id < b.id ? -1 : 1))) {
        const mine = entities.get(p.id)?.place;
        if (mine?.key.startsWith(`${name}:`) && !taken.has(mine.key)) {
          taken.add(mine.key);
          out.set(p.id, mine);
        } else rest.push(p);
      }
      let extra = 0;
      for (const p of rest) {
        const start = hashId(p.id) % spots.length;
        const i = spots.findIndex((_, k) => !taken.has(`${name}:${(start + k) % spots.length}`));
        if (i >= 0) {
          const n = (start + i) % spots.length;
          taken.add(`${name}:${n}`);
          out.set(p.id, { key: `${name}:${n}`, stand: spots[n] });
        } else {
          const [x, y] = spots[extra % spots.length];
          out.set(p.id, { key: `${name}:x${extra}`, stand: [x, y + 1 + Math.floor(extra++ / spots.length)] });
        }
      }
    }
    return { out, held };
  }

  function walkTo(e, tile) {
    if (reduced.matches) {
      Object.assign(e, feet(tile));
      e.path = [];
      return;
    }
    e.path = route(tileOf(e), tile).map(feet);
    let total = 0;
    e.path.reduce((a, b) => ((total += Math.abs(b.x - a.x) + Math.abs(b.y - a.y)), b), e);
    e.speed = Math.max(90, total / 2.2); // never more than ~2 s to cross the gym
  }

  // people: the public floor. label(p) gives each person's name tag;
  // pose(exercise) the movement their exercise animates.
  function setPeople(people, me, label, pose) {
    meId = me;
    poseOf = pose;
    const { out, held } = placesFor(people);
    const present = new Set();
    for (const p of people) {
      present.add(p.id);
      let place = out.get(p.id);
      // walking over to your own locker is yours alone to see for now
      if (p.id === me && visiting && p.state === "idle" && !p.machine) place = visiting;
      else if (p.id === me) visiting = null;
      let e = entities.get(p.id);
      if (!e) {
        const at = feet(seen ? SPAWN : place.stand);
        e = { id: p.id, ...at, path: [], phase: hashId(p.id) % 1000, facing: "down", el: document.createElement("div") };
        e.el.className = "person";
        layer.append(e.el);
        entities.set(p.id, e);
        if (seen) walkTo(e, place.stand);
      } else if (e.leaving || e.place?.key !== place.key) {
        walkTo(e, place.stand);
      }
      Object.assign(e, { person: p, place, leaving: false });
      e.el.classList.toggle("is-you", p.id === me);
      e.el.dataset.user = p.id;
      e.el.dataset.machine = place.station?.id ?? "";
      e.el.dataset.kind = place.station?.kind ?? place.key.split(":")[0];
      const html = label(p);
      if (html !== e.html) e.el.innerHTML = e.html = html;
    }
    for (const e of entities.values()) {
      if (present.has(e.id) || e.leaving) continue;
      e.leaving = true;
      walkTo(e, SPAWN);
    }
    for (const [id, b] of hotspots) {
      const holder = held.get(id);
      b.classList.toggle("is-free", !holder);
      b.classList.toggle("is-busy", Boolean(holder) && holder !== me);
      b.classList.toggle("is-mine", Boolean(holder) && holder === me);
    }
    seen = true;
  }

  // What someone is doing right now, from what the server says and whether
  // they've finished walking over.
  function modeOf(e) {
    if (e.path.length) return "walk";
    if (e.leaving) return "gone";
    const { state } = e.person;
    if (state === "training" && e.place.station) return "use";
    if (state === "resting" && e.place.station) return "rest";
    return "idle";
  }

  // ---- camera ----

  // Keep a point in the middle of the part of the gym that isn't under the panel.
  function aim(p) {
    const r = panel.hidden ? null : panel.getBoundingClientRect();
    const vw = scroller.clientWidth - (r && !narrow.matches ? r.width + 32 : 0);
    const vh = scroller.clientHeight - (r && narrow.matches ? r.height : 0);
    return { left: p.x * S - vw / 2, top: (p.y - 16) * S - vh / 2 };
  }

  function focus(id, { instant = false } = {}) {
    const e = entities.get(id);
    if (!e) return;
    if (instant) {
      const { left, top } = aim(e);
      scroller.scrollTo(left, top);
    }
    follow = { id, until: performance.now() + 1500 };
  }

  for (const ev of ["wheel", "touchstart", "keydown"]) scroller.addEventListener(ev, () => (follow = null), { passive: true });

  // Drag the floor with a mouse to look around; a drag never counts as a click.
  let drag = null;
  let dragEnded = 0;
  scroller.addEventListener("pointerdown", (ev) => {
    // the scroll bars belong to the scroller itself; leave those alone
    if (ev.pointerType !== "mouse" || ev.button !== 0 || ev.target === scroller) return;
    drag = { x: ev.clientX, y: ev.clientY, left: scroller.scrollLeft, top: scroller.scrollTop, moved: false };
  });
  addEventListener("pointermove", (ev) => {
    if (!drag) return;
    const dx = ev.clientX - drag.x;
    const dy = ev.clientY - drag.y;
    if (!drag.moved && Math.hypot(dx, dy) < 5) return;
    drag.moved = true;
    follow = null;
    scroller.classList.add("is-dragging");
    scroller.scrollTo(drag.left - dx, drag.top - dy);
  });
  addEventListener("pointerup", () => {
    scroller.classList.remove("is-dragging");
    if (drag?.moved) dragEnded = performance.now();
    drag = null;
  });

  world.addEventListener("click", (ev) => {
    if (performance.now() - dragEnded < 100) return;
    const b = ev.target.closest(".hotspot");
    if (b?.dataset.machine) onMachine(b.dataset.machine);
    else if (b?.dataset.locker) onLocker(Number(b.dataset.locker));
  });

  // ---- drawing ----

  let last = performance.now();
  function frame(now) {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    const still = reduced.matches;

    for (const e of [...entities.values()]) {
      if (e.path.length) {
        const next = e.path[0];
        const dx = next.x - e.x;
        const dy = next.y - e.y;
        const dist = Math.hypot(dx, dy);
        const step = e.speed * dt;
        if (Math.abs(dx) > Math.abs(dy)) e.facing = dx > 0 ? "right" : "left";
        else if (dy) e.facing = dy > 0 ? "down" : "up";
        if (dist <= step) {
          Object.assign(e, next);
          e.path.shift();
        } else {
          e.x += (dx / dist) * step;
          e.y += (dy / dist) * step;
        }
      }
      if (!e.path.length && e.leaving) {
        e.el.remove();
        entities.delete(e.id);
      }
      if (arrival && e.id === meId && !e.path.length && e.place?.key === arrival.key) {
        const { done, key } = arrival;
        arrival = null;
        const b = hotspots.get(key);
        b?.classList.add("is-arrived");
        setTimeout(() => b?.classList.remove("is-arrived"), 700);
        done();
      }
    }

    g.drawImage(ground, 0, 0);
    const items = [];
    const users = new Map();
    for (const e of entities.values()) if (modeOf(e) === "use") users.set(e.place.station.id, e);
    const tick = (ms, e) => (still ? 0 : Math.floor((now + (e?.phase ?? 0)) / ms) % 2);

    for (const s of STATIONS) {
      const k = KINDS[s.kind];
      const user = users.get(s.id);
      const img = user ? stationSprite(s.kind, user.person.colour, tick(k.ms, user), poseOf(user.person.exercise)) : stationSprite(s.kind, null, 0);
      // a mat or rubber spot lies under whoever rests on it
      items.push({ y: s.anchor.y - (k.inPlace ? 3 : 0), z: 0, img, x: s.anchor.x });
    }
    for (const l of LOCKER_SPOTS) {
      const state = lockerState.get(l.number) ?? "free";
      items.push({ y: (l.ty + 2) * T - 1, z: 0, img: lockerSprite(l.number, state, state === "mine" ? mineColour : null), x: l.tx * T + 8 });
    }
    for (const e of entities.values()) {
      const mode = modeOf(e);
      e.el.dataset.mode = mode;
      e.el.classList.toggle("is-walking", mode === "walk");
      let labelY = e.y - PERSON.label;
      if (mode === "use") labelY = e.place.station.anchor.y - KINDS[e.place.station.kind].label;
      else {
        const pose = mode === "walk" ? `walk-${e.facing}` : mode === "rest" ? "rest" : "idle";
        const ms = mode === "walk" ? 160 : mode === "rest" ? 900 : 1600;
        let f = tick(ms, e);
        if (pose === "idle") f = still ? 0 : Math.floor((now + e.phase) / 150) % 24 === 0 ? 1 : 0;
        items.push({ y: e.y, z: 1, img: personSprite(e.person.colour, pose, f), x: e.x, e });
      }
      e.el.style.transform = `translate(${e.x * S}px, ${labelY * S}px) translate(-50%, -100%)`;
    }

    items.sort((a, b) => a.y - b.y || a.z - b.z);
    for (const it of items) {
      if (it.e) {
        g.fillStyle = "rgba(15, 12, 25, 0.35)";
        g.fillRect(Math.round(it.x) - 5, Math.round(it.y) - 1, 10, 3);
        if (it.e.id === meId) {
          g.fillStyle = it.e.person.colour;
          g.fillRect(Math.round(it.x) - 7, Math.round(it.y) + 1, 14, 1);
          g.fillRect(Math.round(it.x) - 8, Math.round(it.y), 1, 1);
          g.fillRect(Math.round(it.x) + 7, Math.round(it.y), 1, 1);
        }
      }
      g.drawImage(it.img, Math.round(it.x - it.img.width / 2), Math.round(it.y - (it.img.height - 2)));
    }

    if (follow) {
      const e = entities.get(follow.id);
      if (!e || (!e.path.length && now > follow.until)) follow = null;
      else {
        const { left, top } = aim(e);
        scroller.scrollTo(scroller.scrollLeft + (left - scroller.scrollLeft) * 0.12, scroller.scrollTop + (top - scroller.scrollTop) * 0.12);
      }
    }
    requestAnimationFrame(frame);
  }

  function paintGround(gg) {
    gg.fillStyle = "#2c2a3f";
    gg.fillRect(0, 0, W * T, H * T);
    for (const z of ZONES) paintFloor(gg, z.floor, z.x, z.y, z.w, z.h);
    for (const z of ZONES) if (z.edges) paintAisleEdges(gg, z.x, z.y, z.w, z.h);
    for (const [x, w] of LIGHT) paintLight(gg, x, w, 7);
    // cardio lanes between the treadmills
    gg.fillStyle = "rgba(255, 255, 255, 0.08)";
    for (const [x] of MACHINES_AT.treadmill.slice(1)) gg.fillRect(x * T - 9, 5 * T, 2, 3 * T);
    for (const [x, y, across] of wallTiles) paintInnerWall(gg, x, y, across);
    paintText(gg, "LOCKER ROOM", 2 * T + 2, 31 * T + 4, "rgba(40, 50, 70, 0.4)");
    for (const z of ZONES) if (z.name) paintText(gg, z.name, z.x * T + 6, z.y * T + 4, z.floor === "lobby" ? "rgba(60,50,40,0.35)" : "rgba(255,255,255,0.22)");
    // the gym's name on the reception floor
    paintText(gg, "SAME GYM", 2 * T + 2, 37 * T + 1, "rgba(255, 107, 74, 0.5)", 3);
    paintWalls(gg, W, H, WALL, DOOR);
    const sorted = [...FURNITURE].sort((a, b) => a[2] + DECOR[a[0]].fh - (b[2] + DECOR[b[0]].fh));
    for (const [kind, tx, ty] of sorted) {
      const d = DECOR[kind];
      const img = decorSprite(kind);
      gg.drawImage(img, tx * T + (d.fw * T - img.width) / 2, (ty + d.fh) * T - img.height + 1);
    }
  }

  rescale();
  requestAnimationFrame(frame);

  return {
    setPeople,
    focus,
    // call done once you're standing at this machine (next frame if you are)
    whenArrived(machineId, done) {
      arrival = { key: machineId, done };
    },
    cancelArrival() {
      arrival = null;
    },
    focusMachine(id) {
      const s = stationById.get(id);
      if (!s) return;
      follow = null;
      scroller.scrollTo({ ...aim(feet(s.stand)), behavior: "smooth" });
    },
    select(id) {
      for (const [mid, b] of hotspots) b.classList.toggle("is-selected", mid === id);
      for (const [n, b] of lockerButtons) b.classList.toggle("is-selected", `locker:${n}` === id);
    },
    // which lockers are taken, and which one is yours
    setLockers(room, mine, colour) {
      mineColour = colour;
      lockerState = new Map(room.map((l) => [l.number, l.number === mine ? "mine" : l.taken ? "taken" : "free"]));
      for (const [n, b] of lockerButtons) {
        const state = lockerState.get(n) ?? "free";
        for (const c of ["free", "taken", "mine"]) b.classList.toggle(`is-${c === "taken" ? "busy" : c}`, c === state);
        b.querySelector("span").textContent = `${state === "mine" ? "Your locker" : "Locker"} ${String(n).padStart(2, "0")}`;
      }
    },
    // walk over to your locker, if you're not on a machine
    goToLocker(number, meId) {
      const l = LOCKER_SPOTS[number - 1];
      const e = entities.get(meId);
      if (!l || !e || e.person.state !== "idle" || e.person.machine) return;
      visiting = { key: `locker:${number}`, stand: l.stand };
      e.place = visiting;
      walkTo(e, l.stand);
      follow = { id: meId, until: performance.now() + 1500 };
    },
    focusLocker(number) {
      const l = LOCKER_SPOTS[number - 1];
      if (!l) return;
      follow = null;
      scroller.scrollTo({ ...aim(feet(l.stand)), behavior: "smooth" });
    },
    name(names) {
      for (const [id, b] of hotspots) {
        b.querySelector("span").textContent = names.get(id) ?? id;
        b.setAttribute("aria-label", names.get(id) ?? id);
      }
    },
    focusDoor() {
      const { left, top } = aim(feet(SPAWN));
      scroller.scrollTo(left, top - 120);
    },
    relayout: pad,
  };
}
