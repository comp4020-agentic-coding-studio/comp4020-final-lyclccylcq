// The gym as a place: its layout, who is standing where, and the camera.
//
// The server says what each person is doing (an exercise, training or
// resting). Everything visual follows from that here: which machine they're
// on, the route they walk to get there, and which animation plays. Nothing
// about position or frames is stored; reloading derives the same picture.

import { DECOR, KINDS, PERSON, T, decorSprite, paintAisleEdges, paintFloor, paintText, paintWalls, personSprite, stationSprite } from "./sprites.js";

export const W = 60;
export const H = 38;
const DOOR = { x: 5, w: 3 };
const SPAWN = [6, H - 2];

const ZONES = [
  { name: "CARDIO", floor: "cardio", x: 1, y: 3, w: 20, h: 10 },
  { name: "MACHINES", floor: "machines", x: 21, y: 3, w: 19, h: 10 },
  { name: "FREE WEIGHTS", floor: "free", x: 40, y: 3, w: 19, h: 10 },
  { floor: "aisle", x: 1, y: 13, w: 58, h: 2, edges: true },
  { name: "LOBBY", floor: "lobby", x: 1, y: 15, w: 12, h: 22 },
  { floor: "aisle", x: 13, y: 15, w: 1, h: 22, edges: true },
  { name: "BENCH", floor: "bench", x: 14, y: 15, w: 21, h: 11 },
  { name: "SQUAT RACKS", floor: "legs", x: 35, y: 15, w: 24, h: 11 },
  { floor: "aisle", x: 14, y: 26, w: 45, h: 2, edges: true },
  { name: "STRETCH & RECOVERY", floor: "recovery", x: 14, y: 28, w: 45, h: 9 },
  { floor: "wood", x: 36, y: 16, w: 5, h: 5 },
  { floor: "wood", x: 42, y: 16, w: 5, h: 5 },
  { floor: "wood", x: 48, y: 17, w: 6, h: 4 },
];

const WALL = [
  { kind: "window", x: 2, w: 5 },
  { kind: "window", x: 8, w: 5 },
  { kind: "window", x: 14, w: 5 },
  { kind: "poster", x: 23, w: 2, colour: "#e2574c" },
  { kind: "clock", x: 29, w: 1 },
  { kind: "poster", x: 36, w: 2, colour: "#3fa7a0" },
  { kind: "mirror", x: 40, w: 19 },
];

// Furniture: [kind, tile x, tile y] of each footprint's top-left.
const FURNITURE = [
  ["rower", 3, 10], ["rower", 8, 10], ["elliptical", 14, 9], ["elliptical", 17, 9],
  ["cableCrossover", 30, 5], ["seatedRow", 36, 5],
  ["legPress", 22, 9], ["legExtension", 27, 9], ["chestPress", 31, 9], ["legExtension", 35, 9],
  ["dumbbellRack", 41, 5], ["dumbbellRack", 50, 5], ["kettlebells", 46, 11], ["flatBench", 52, 11],
  ["inclineBench", 31, 18], ["plateTree", 15, 23], ["flatBench", 17, 23], ["plateTree", 21, 23],
  ["kettlebells", 23, 23], ["barbell", 28, 23],
  ["barbell", 49, 18], ["plateTree", 55, 17], ["plateTree", 55, 21], ["plateTree", 41, 23],
  ["barbell", 36, 23], ["dumbbellRack", 46, 23],
  ["rollers", 37, 29], ["ball", 33, 30], ["ball", 34, 32], ["ball", 32, 34], ["rollers", 37, 33],
  ["cooler", 43, 29], ["cooler", 44, 29], ["plant", 46, 29], ["bench", 42, 34],
  ["vending", 53, 29], ["sofa", 48, 33], ["plant", 57, 29], ["plant", 57, 34], ["plant", 14, 35],
  ...[17, 19, 21, 23, 25, 27].map((y) => ["lockers", 1, y]),
  ["desk", 7, 31], ["cooler", 11, 16], ["bench", 5, 22], ["bench", 8, 28], ["plant", 11, 22], ["plant", 1, 34],
];

// Where each station's exercise is done: the top-left tile of each machine,
// or of each spot on the rubber. A station's id matches the server's.
const STATION_SLOTS = {
  treadmill: { kind: "treadmill", at: [[2, 5], [6, 5], [10, 5]] },
  bike: { kind: "bike", at: [[14, 5], [18, 5]] },
  pulldown: { kind: "pulldown", at: [[22, 5], [26, 5]] },
  dumbbells: { kind: "dumbbells", at: [[44, 8], [49, 8], [54, 8]] },
  bench: { kind: "bench", at: [[16, 18], [21, 18], [26, 18]] },
  rack: { kind: "rack", at: [[37, 18], [43, 18]] },
  mats: { kind: "mats", at: [[18, 31], [23, 31], [28, 31]] },
};

// Where you stand when you've walked in but not picked anything yet.
const LOBBY_SPOTS = [[5, 18], [9, 18], [5, 26], [9, 26]];

// ---- derived geometry ----

const feet = ([tx, ty]) => ({ x: tx * T + 8, y: ty * T + 13 });

const slots = {};
for (const [station, { kind, at }] of Object.entries(STATION_SLOTS)) {
  const k = KINDS[kind];
  slots[station] = at.map(([tx, ty], i) => {
    const stand = k.inPlace ? [tx, ty] : [tx + Math.floor(k.fw / 2), ty + k.fh];
    const anchor = k.inPlace ? { x: feet(stand).x, y: feet(stand).y + 1 } : { x: tx * T + (k.fw * T) / 2, y: (ty + k.fh) * T - 1 };
    return { key: `${station}:${i}`, station, kind, tx, ty, stand, anchor };
  });
}

const blocked = new Uint8Array(W * H);
const block = (tx, ty, w, h) => {
  for (let y = ty; y < ty + h; y++) for (let x = tx; x < tx + w; x++) blocked[y * W + x] = 1;
};
block(0, 0, W, 3);
block(0, 0, 1, H);
block(W - 1, 0, 1, H);
block(0, H - 1, W, 1);
for (const [kind, x, y] of FURNITURE) block(x, y, DECOR[kind].fw, DECOR[kind].fh);
for (const list of Object.values(slots)) for (const s of list) if (!KINDS[s.kind].inPlace) block(s.tx, s.ty, KINDS[s.kind].fw, KINDS[s.kind].fh);

// Breadth-first over the tile grid, then only the corners are kept, so people
// walk the aisles in straight lines and turn where the floor turns.
function route(from, to) {
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

const tileOf = (e) => [Math.round((e.x - 8) / T), Math.round((e.y - 13) / T)];

const hashId = (id) => {
  let h = 2166136261;
  for (const c of id) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return h >>> 0;
};

// ---- the world ----

export function createWorld({ scroller, sizer, world, canvas, layer, panel, onStation }) {
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
  let seen = false; // first setPeople places people; later arrivals walk in
  let meId = null;
  let follow = null;
  const entities = new Map();

  // ---- scale and layout ----

  function rescale() {
    const base = narrow.matches ? 2 : 3;
    S = Math.max(1, Math.round(base * devicePixelRatio)) / devicePixelRatio;
    world.style.width = `${W * T * S}px`;
    world.style.height = `${H * T * S}px`;
    world.style.setProperty("--s", S);
    for (const btn of world.querySelectorAll(".hotspot")) {
      const list = slots[btn.dataset.station];
      if (!list) {
        btn.hidden = true;
        continue;
      }
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      for (const s of list) {
        const k = KINDS[s.kind];
        x0 = Math.min(x0, s.tx);
        y0 = Math.min(y0, s.ty - (k.inPlace ? 1 : 0));
        x1 = Math.max(x1, s.tx + k.fw);
        y1 = Math.max(y1, s.stand[1] + 1);
      }
      Object.assign(btn.style, {
        left: `${x0 * T * S}px`,
        top: `${y0 * T * S}px`,
        width: `${(x1 - x0) * T * S}px`,
        height: `${(y1 - y0) * T * S}px`,
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

  function targetsFor(people) {
    const out = new Map();
    const byStation = new Map();
    for (const p of people) {
      const key = p.station && slots[p.station] ? p.station : null;
      if (!byStation.has(key)) byStation.set(key, []);
      byStation.get(key).push(p);
    }
    for (const [station, group] of byStation) {
      const spots = station ? slots[station] : LOBBY_SPOTS.map((t, i) => ({ key: `lobby:${i}`, stand: t }));
      const taken = new Array(spots.length).fill(false);
      const waiting = [];
      // whoever already has a spot here keeps it, so nobody is bumped
      for (const p of group) {
        const i = spots.findIndex((s) => s.key === entities.get(p.id)?.slot?.key);
        if (i >= 0 && !taken[i]) {
          taken[i] = true;
          out.set(p.id, spots[i]);
        } else waiting.push(p);
      }
      waiting.sort((a, b) => (a.id < b.id ? -1 : 1));
      let overflow = 0;
      for (const p of waiting) {
        const start = hashId(p.id) % spots.length;
        const free = spots.findIndex((_, k) => !taken[(start + k) % spots.length]);
        if (free >= 0) {
          const i = (start + free) % spots.length;
          taken[i] = true;
          out.set(p.id, spots[i]);
        } else {
          // more people than machines: wait in line beside the station
          const s = spots[overflow % spots.length];
          const stand = [s.stand[0] + 1 + Math.floor(overflow / spots.length), s.stand[1]];
          out.set(p.id, { key: `${s.key}:wait${overflow++}`, stand, waiting: true });
        }
      }
    }
    return out;
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

  // people: the public floor; label(p) gives each person's name tag.
  function setPeople(people, me, label) {
    meId = me;
    const targets = targetsFor(people);
    const present = new Set();
    for (const p of people) {
      present.add(p.id);
      const slot = targets.get(p.id);
      let e = entities.get(p.id);
      if (!e) {
        const at = feet(seen ? SPAWN : slot.stand);
        e = { id: p.id, ...at, path: [], phase: hashId(p.id) % 1000, facing: "down", el: document.createElement("div") };
        e.el.className = "person";
        layer.append(e.el);
        entities.set(p.id, e);
        if (seen) walkTo(e, slot.stand);
      } else if (e.leaving || e.slot?.key !== slot.key) {
        walkTo(e, slot.stand);
      }
      Object.assign(e, { person: p, slot, leaving: false });
      e.el.classList.toggle("is-you", p.id === me);
      e.el.dataset.user = p.id;
      e.el.dataset.station = p.station ?? "lobby";
      const html = label(p);
      if (html !== e.html) e.el.innerHTML = e.html = html;
    }
    for (const e of entities.values()) {
      if (present.has(e.id) || e.leaving) continue;
      e.leaving = true;
      walkTo(e, SPAWN);
    }
    seen = true;
  }

  // What someone is doing right now, from what the server says and whether
  // they've finished walking over.
  function modeOf(e) {
    if (e.path.length) return "walk";
    if (e.leaving) return "gone";
    const { state } = e.person;
    if (state === "training" && e.slot.waiting) return "wait";
    if (state === "training" && e.slot.kind) return "use";
    if (state === "resting") return "rest";
    return "idle";
  }

  // ---- camera ----

  // Keep someone in the middle of the part of the gym that isn't under the panel.
  function aim(e) {
    const r = panel.hidden ? null : panel.getBoundingClientRect();
    const vw = scroller.clientWidth - (r && !narrow.matches ? r.width + 32 : 0);
    const vh = scroller.clientHeight - (r && narrow.matches ? r.height : 0);
    return { left: e.x * S - vw / 2, top: (e.y - 16) * S - vh / 2 };
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
    const btn = ev.target.closest(".hotspot");
    if (btn) onStation(btn.dataset.station);
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
    }

    g.drawImage(ground, 0, 0);
    const items = [];
    const users = new Map();
    for (const e of entities.values()) if (modeOf(e) === "use") users.set(e.slot.key, e);
    const tick = (ms, e) => (still ? 0 : Math.floor((now + (e?.phase ?? 0)) / ms) % 2);

    for (const list of Object.values(slots)) {
      for (const s of list) {
        const k = KINDS[s.kind];
        const user = users.get(s.key);
        // a mat or rubber spot lies under whoever rests on it
        items.push({ y: s.anchor.y - (k.inPlace ? 3 : 0), z: 0, img: stationSprite(s.kind, user?.person.colour ?? null, tick(k.ms, user)), x: s.anchor.x });
      }
    }
    for (const e of entities.values()) {
      const mode = modeOf(e);
      e.el.dataset.mode = mode;
      e.el.classList.toggle("is-walking", mode === "walk");
      let labelY = e.y - PERSON.label;
      if (mode === "use") {
        const k = KINDS[e.slot.kind];
        labelY = e.slot.anchor.y - k.label;
      } else {
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
    for (const z of ZONES) if (z.name) paintText(gg, z.name, z.x * T + 6, z.y * T + 4, z.floor === "lobby" ? "rgba(60,50,40,0.35)" : "rgba(255,255,255,0.22)");
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
    focusDoor() {
      const { left, top } = aim(feet(SPAWN));
      scroller.scrollTo(left, top - 120);
    },
    relayout: pad,
  };
}
