// All of the gym's pixel art. Every sprite is painted from rectangles at one
// world pixel each, then ringed with a 1 px outline, so the room shares one
// grid and one line weight. Nothing is loaded: the art is this file.

export const T = 16; // tile size in world pixels

export const INK = "#1b1622";
export const P = {
  skin: "#f1c19a",
  skinD: "#c98d68",
  hair: "#3b2a24",
  shorts: "#2c2f48",
  shoe: "#1e1d2a",
  metal: "#c3c9d4",
  metalD: "#6f7789",
  iron: "#2f2e3b",
  ironL: "#4c4b5e",
  pad: "#6a3550",
  padL: "#8a4a6c",
  screen: "#7fe0c8",
  screenOff: "#38424f",
  wood: "#a06a44",
  woodL: "#bb8257",
  woodD: "#7b4d31",
  mat: "#3f8f84",
  matL: "#5aac9f",
  white: "#f4efe6",
  water: "#62b6f0",
  locker: "#4f6fa8",
  lockerD: "#3c5687",
  lockerL: "#6a8bc4",
  brass: "#d4b24a",
  green: "#4f9a52",
  greenD: "#3a7740",
  pot: "#b5643c",
  sofa: "#c0564a",
  sofaD: "#9b4138",
};

export function shade(hex, f = 0.72) {
  const n = parseInt(hex.slice(1), 16);
  const c = [n >> 16, (n >> 8) & 255, n & 255].map((v) => Math.round(v * f));
  return `rgb(${c.join(",")})`;
}

function blank(w, h) {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  return c;
}

// Paints with r(x, y, w, h, colour), then outlines every opaque shape in INK.
function make(w, h, draw) {
  const c = blank(w, h);
  const g = c.getContext("2d");
  const r = (x, y, ww, hh, col) => {
    g.fillStyle = col;
    g.fillRect(x, y, ww, hh);
  };
  draw(r);
  const img = g.getImageData(0, 0, w, h);
  const d = img.data;
  const src = new Uint8ClampedArray(d);
  const solid = (x, y) => x >= 0 && y >= 0 && x < w && y < h && src[(y * w + x) * 4 + 3] > 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      if (src[i + 3] === 0 && (solid(x - 1, y) || solid(x + 1, y) || solid(x, y - 1) || solid(x, y + 1))) {
        d[i] = 27;
        d[i + 1] = 22;
        d[i + 2] = 34;
        d[i + 3] = 255;
      }
    }
  }
  g.putImageData(img, 0, 0);
  return c;
}

function mirrored(src) {
  const c = blank(src.width, src.height);
  const g = c.getContext("2d");
  g.scale(-1, 1);
  g.drawImage(src, -src.width, 0);
  return c;
}

const disc = (r, cx, cy, rad, col) => {
  for (let dy = -rad; dy <= rad; dy++) {
    const w = Math.round(Math.sqrt(rad * rad - dy * dy + rad * 0.6));
    r(cx - w, cy + dy, w * 2 + 1, 1, col);
  }
};

const cache = new Map();
function cached(key, build) {
  let s = cache.get(key);
  if (!s) cache.set(key, (s = build()));
  return s;
}

// ---- people ----

// A person seen from the front (or back). fy is the bottom row of the shoes;
// u lowers (positive) or raises the upper body, for squats and sitting.
function front(r, c, o = {}) {
  const { cx = 16, fy = 26, legs = "stand", arms = "down", back = false, u = 0, blink = false, barY = 0, bar = 0 } = o;
  const sh = shade(c);

  if (legs === "squat") {
    r(cx - 6, fy - 4, 3, 3, P.skin);
    r(cx + 3, fy - 4, 3, 3, P.skin);
    r(cx - 7, fy - 1, 4, 2, P.shoe);
    r(cx + 3, fy - 1, 4, 2, P.shoe);
  } else if (legs === "sit") {
    r(cx - 4, fy - 9, 3, 7, P.skin);
    r(cx + 1, fy - 9, 3, 7, P.skin);
    r(cx - 4, fy - 2, 3, 2, P.shoe);
    r(cx + 1, fy - 2, 3, 2, P.shoe);
  } else {
    const a = legs === "walkA" ? 1 : 0;
    const b = legs === "walkB" ? 1 : 0;
    r(cx - 4, fy - 5 - a, 3, 4, P.skin);
    r(cx - 4, fy - 1 - a, 3, 2, P.shoe);
    r(cx + 1, fy - 5 - b, 3, 4, P.skin);
    r(cx + 1, fy - 1 - b, 3, 2, P.shoe);
  }

  const y0 = fy + u;
  const S = y0 - 14; // shoulder line
  r(cx - 4, y0 - 8, 8, 3, P.shorts);
  r(cx - 4, S, 8, 6, c);
  r(cx + 2, S, 2, 6, sh);
  r(cx - 1, S - 1, 2, 1, P.skin);
  r(cx - 3, S - 7, 6, 6, P.skin);
  r(cx - 3, S - 8, 6, 2, P.hair);
  r(cx - 4, S - 7, 1, 3, P.hair);
  r(cx + 3, S - 7, 1, 3, P.hair);
  if (back) r(cx - 3, S - 7, 6, 5, P.hair);
  else if (!blink) {
    r(cx - 2, S - 4, 1, 1, INK);
    r(cx + 1, S - 4, 1, 1, INK);
  }

  const arm = (x, len) => {
    r(x, S, 2, 2, c);
    r(x, S + 2, 2, len - 2, P.skin);
  };
  const sleeves = () => {
    r(cx - 6, S, 2, 2, c);
    r(cx + 4, S, 2, 2, c);
  };
  switch (arms) {
    case "swingA":
      arm(cx - 6, 5);
      arm(cx + 4, 6);
      break;
    case "swingB":
      arm(cx - 6, 6);
      arm(cx + 4, 5);
      break;
    case "rest": // towel over the shoulder, water in hand
      arm(cx - 6, 6);
      arm(cx + 4, 6);
      r(cx - 5, S - 1, 3, 2, P.white);
      r(cx - 4, S + 1, 2, 4, P.white);
      r(cx + 4, S + 6, 2, 4, P.water);
      r(cx + 4, S + 5, 2, 1, P.white);
      break;
    case "up":
      sleeves();
      r(cx - 6, S - 9, 2, 9, P.skin);
      r(cx + 4, S - 9, 2, 9, P.skin);
      break;
    case "out":
      sleeves();
      r(cx - 11, S, 5, 2, P.skin);
      r(cx + 6, S, 5, 2, P.skin);
      break;
    case "curlDown":
      arm(cx - 6, 6);
      arm(cx + 4, 6);
      r(cx - 8, S + 5, 6, 2, P.iron);
      r(cx + 2, S + 5, 6, 2, P.iron);
      break;
    case "curlUp":
      sleeves();
      r(cx - 6, S + 2, 2, 2, P.skin);
      r(cx + 4, S + 2, 2, 2, P.skin);
      r(cx - 8, S - 1, 6, 2, P.iron);
      r(cx + 2, S - 1, 6, 2, P.iron);
      break;
    case "bar": // barbell across the shoulders
      sleeves();
      r(cx - 7, S - 1, 2, 3, P.skin);
      r(cx + 5, S - 1, 2, 3, P.skin);
      r(cx - bar, S, bar * 2, 1, P.metal);
      r(cx - bar, S - 4, 3, 9, P.iron);
      r(cx + bar - 3, S - 4, 3, 9, P.iron);
      break;
    case "goblet": // one dumbbell held upright against the chest
      sleeves();
      r(cx - 5, S + 2, 3, 3, P.skin);
      r(cx + 2, S + 2, 3, 3, P.skin);
      r(cx - 2, S + 1, 4, 2, P.iron);
      r(cx - 1, S + 3, 2, 3, P.metal);
      r(cx - 2, S + 6, 4, 2, P.iron);
      break;
    case "reach": // both hands up on a bar at barY
      sleeves();
      r(cx - 7, barY, 2, S - barY, P.skin);
      r(cx + 5, barY, 2, S - barY, P.skin);
      break;
    default:
      arm(cx - 6, 6);
      arm(cx + 4, 6);
  }
}

// A person in profile, facing right.
function side(r, c, o = {}) {
  const { x = 16, fy = 26, legs = "stand", arm = "down" } = o;
  const sh = shade(c);
  const S = fy - 14;
  switch (legs) {
    case "runA":
      r(x - 3, fy - 5, 2, 2, P.skinD);
      r(x - 5, fy - 4, 2, 2, P.skinD);
      r(x - 7, fy - 3, 3, 2, P.shoe);
      r(x + 1, fy - 5, 2, 2, P.skin);
      r(x + 3, fy - 4, 2, 3, P.skin);
      r(x + 3, fy - 1, 4, 2, P.shoe);
      break;
    case "runB":
      r(x - 2, fy - 5, 2, 4, P.skinD);
      r(x - 2, fy - 1, 4, 2, P.shoe);
      r(x + 1, fy - 6, 3, 2, P.skin);
      r(x + 3, fy - 5, 2, 3, P.skin);
      r(x + 3, fy - 3, 3, 2, P.shoe);
      break;
    case "walkA":
      r(x - 3, fy - 5, 2, 4, P.skinD);
      r(x - 4, fy - 1, 3, 2, P.shoe);
      r(x, fy - 5, 2, 4, P.skin);
      r(x, fy - 1, 4, 2, P.shoe);
      break;
    default:
      r(x - 2, fy - 5, 3, 4, P.skin);
      r(x - 2, fy - 1, 4, 2, P.shoe);
  }
  r(x - 3, fy - 8, 5, 3, P.shorts);
  r(x - 3, S, 5, 6, c);
  r(x - 3, S, 1, 6, sh);
  r(x - 1, S - 1, 2, 1, P.skin);
  r(x - 3, S - 7, 6, 6, P.skin);
  r(x - 3, S - 8, 6, 2, P.hair);
  r(x - 3, S - 7, 2, 4, P.hair);
  r(x + 1, S - 4, 1, 1, INK);
  if (arm === "none") return;
  if (arm === "fwd") {
    r(x - 1, S, 2, 2, sh);
    r(x + 1, S + 2, 3, 2, P.skin);
  } else if (arm === "back") {
    r(x - 2, S, 2, 2, sh);
    r(x - 4, S + 2, 3, 2, P.skin);
  } else {
    r(x - 1, S, 2, 2, sh);
    r(x - 1, S + 2, 2, 4, P.skin);
  }
}

// Standing, walking and resting people, away from any machine. 32×28, feet on
// row 26, centred.
export const PERSON = { w: 32, h: 28, label: 24 };

export function personSprite(colour, pose, frame) {
  return cached(`person:${colour}:${pose}:${frame}`, () => {
    if (pose === "walk-left") return mirrored(personSprite(colour, "walk-right", frame));
    return make(PERSON.w, PERSON.h, (r) => {
      if (pose === "walk-right") side(r, colour, { legs: frame ? "walkA" : "stand", arm: frame ? "fwd" : "back" });
      else if (pose === "walk-down" || pose === "walk-up")
        front(r, colour, { legs: frame ? "walkA" : "walkB", arms: frame ? "swingA" : "swingB", back: pose === "walk-up" });
      else if (pose === "rest") front(r, colour, { arms: "rest", u: frame ? 1 : 0 });
      else front(r, colour, { blink: frame === 1 });
    });
  });
}

// ---- the stations: equipment, with whoever is using it ----
//
// Each kind has a footprint in tiles (fw × fh; blocked for walking unless
// inPlace), a sprite size, how far above its anchor a name tag sits, and its
// two-frame animation speed. draw(r, colour, frame, pose) paints the empty
// machine when colour is null, and otherwise the person on it doing pose (the
// server's name for the movement, so one machine can host several
// exercises). Sprites sit on their footprint's bottom edge; inPlace kinds (a
// mat, a spot on the rubber) sit under the person instead.

// A limb from (x0, y0) to (x1, y1), w pixels thick, stepped like hand-drawn
// pixel art.
const seg = (r, x0, y0, x1, y1, w, col) => {
  const n = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0), 1);
  for (let i = 0; i <= n; i++) r(Math.round(x0 + ((x1 - x0) * i) / n), Math.round(y0 + ((y1 - y0) * i) / n), w, w, col);
};

// a head in profile facing right, its face box's top-left at (x, y)
const headR = (r, x, y) => {
  r(x, y, 6, 6, P.skin);
  r(x, y - 1, 6, 2, P.hair);
  r(x, y, 2, 4, P.hair);
  r(x + 4, y + 3, 1, 1, INK);
};

// Someone sitting upright in profile, facing right, hips at (hx, hy).
// Returns their shoulder.
function seated(r, c, hx, hy) {
  r(hx - 3, hy - 4, 8, 4, P.shorts);
  r(hx - 3, hy - 14, 5, 10, c);
  r(hx - 3, hy - 14, 1, 10, shade(c));
  r(hx - 1, hy - 15, 2, 1, P.skin);
  headR(r, hx - 3, hy - 21);
  return [hx - 1, hy - 12];
}

// Lying on your back on a flat bench, head to the left; the weight goes up on
// frame 1.
function lying(r, c, f, weight) {
  const sh = shade(c);
  r(8, 21, 6, 5, P.skin);
  r(7, 21, 2, 5, P.hair);
  r(11, 21, 1, 1, INK);
  r(14, 21, 11, 5, c);
  r(14, 25, 11, 1, sh);
  r(25, 22, 5, 4, P.shorts);
  r(30, 22, 4, 3, P.skin);
  r(33, 23, 2, 14, P.skin);
  r(33, 37, 4, 2, P.shoe);
  const hand = f ? 12 : 17;
  r(16, hand, 2, 21 - hand, P.skin);
  if (weight === "plate") {
    disc(r, 17, hand - 2, 3, P.iron);
    r(16, hand - 3, 2, 2, P.metal);
  } else {
    r(13, hand - 3, 8, 3, P.iron);
    r(15, hand - 2, 4, 1, P.ironL);
  }
}

// Weight stack with its guide rods, as on every pin-loaded machine.
const stack = (r, x, y, w, h) => {
  r(x, y, w, h, P.iron);
  for (let i = y + 1; i < y + h; i += 3) r(x, i, w, 1, P.ironL);
  r(x + Math.floor(w / 2), y + 4, 1, 2, P.metal);
};

export const KINDS = {
  treadmill: {
    fw: 3, fh: 2, w: 48, h: 40, label: 30, ms: 170,
    draw(r, c, f) {
      r(4, 35, 40, 4, P.metalD);
      r(5, 33, 38, 2, P.iron);
      for (let i = 0; i < 5; i++) r(6 + ((i * 8 + (c ? f * 4 : 0)) % 36), 34, 3, 1, P.ironL);
      r(40, 16, 3, 19, P.metalD);
      r(36, 12, 10, 4, P.metal);
      r(37, 13, 8, 2, c ? P.screen : P.screenOff);
      r(29, 21, 12, 2, P.metal);
      if (c) side(r, c, { x: 22, fy: 32, legs: f ? "runB" : "runA", arm: f ? "fwd" : "back" });
    },
  },
  bike: {
    fw: 2, fh: 2, w: 40, h: 40, label: 38, ms: 230,
    draw(r, c, f) {
      r(6, 36, 28, 3, P.metalD);
      disc(r, 30, 29, 5, P.iron);
      r(29, 28, 3, 3, P.metal);
      r(12, 23, 2, 13, P.metalD);
      const legs = (front) => {
        const [kx, ky, col] = front ? [20, 18, P.skin] : [19, 18, P.skinD];
        if ((f === 0) === front) {
          r(13, ky, kx - 13, 3, col);
          r(kx, ky + 2, 2, 8, col);
          r(kx, ky + 10, 4, 2, P.shoe);
        } else {
          r(13, ky + 1, 5, 3, col);
          r(17, ky + 3, 2, 11, col);
          r(17, ky + 14, 4, 2, P.shoe);
        }
      };
      if (c) legs(false);
      r(8, 21, 8, 2, P.iron);
      r(28, 15, 2, 14, P.metalD);
      if (c) {
        const sh = shade(c);
        r(9, 17, 6, 4, P.shorts);
        r(12, 10, 6, 7, c);
        r(12, 10, 1, 7, sh);
        r(16, 9, 2, 1, P.skin);
        headR(r, 16, 3);
        r(16, 11, 3, 2, sh);
        r(19, 12, 8, 2, P.skin);
        legs(true);
      }
      r(26, 13, 7, 2, P.iron);
      r(30, 11, 4, 2, c ? P.screen : P.screenOff);
    },
  },
  rower: {
    fw: 4, fh: 1, w: 64, h: 34, label: 32, ms: 600,
    draw(r, c, f) {
      r(4, 27, 48, 2, P.metal);
      r(4, 27, 2, 6, P.metalD);
      r(48, 27, 2, 6, P.metalD);
      disc(r, 54, 22, 6, P.iron);
      r(52, 20, 4, 4, P.ironL);
      r(43, 19, 3, 8, P.ironL);
      const sx = c ? (f ? 16 : 28) : 24;
      r(sx, 24, 9, 3, P.iron);
      if (!c) {
        r(47, 17, 2, 5, P.iron);
        return;
      }
      const [hx, hy] = [sx + 4, 23];
      const knee = f ? null : [hx + 9, hy - 9];
      if (knee) {
        seg(r, hx + 3, hy - 2, ...knee, 2, P.skin);
        seg(r, ...knee, 41, 20, 2, P.skin);
      } else seg(r, hx + 3, hy - 2, 41, 20, 2, P.skin);
      r(41, 17, 2, 6, P.shoe);
      const [sx0, sy0] = seated(r, c, hx, hy);
      const hand = f ? [hx + 4, hy - 10] : [39, hy - 8];
      seg(r, sx0, sy0, ...hand, 2, P.skin);
      r(hand[0] + 2, hand[1] - 1, 1, 4, P.iron);
      seg(r, hand[0] + 3, hand[1] + 1, 49, 20, 1, P.metal);
    },
  },
  bench: {
    fw: 3, fh: 2, w: 48, h: 40, label: 32, ms: 650,
    draw(r, c, f) {
      r(9, 10, 2, 29, P.metalD);
      r(11, 18, 3, 1, P.metalD);
      r(13, 30, 2, 9, P.metalD);
      r(30, 30, 2, 9, P.metalD);
      r(7, 26, 30, 4, P.pad);
      r(7, 26, 30, 1, P.padL);
      // plates waiting on the upright's storage horn
      r(4, 30, 3, 8, P.iron);
      r(3, 32, 1, 4, P.ironL);
      if (!c) {
        disc(r, 12, 15, 3, P.iron);
        r(11, 14, 2, 2, P.metal);
        return;
      }
      lying(r, c, f, "plate");
    },
  },
  incline: {
    fw: 3, fh: 2, w: 48, h: 46, label: 38, ms: 650,
    draw(r, c, f) {
      r(8, 6, 2, 38, P.metalD);
      r(10, 12, 3, 1, P.metalD);
      r(10, 42, 28, 2, P.metalD);
      r(30, 34, 2, 8, P.metalD);
      r(14, 34, 2, 8, P.metalD);
      r(26, 32, 11, 3, P.pad);
      for (let i = 0; i < 6; i++) r(12 + i * 3, 16 + i * 3, 5, 4, P.pad);
      r(12, 16, 5, 1, P.padL);
      if (!c) {
        disc(r, 11, 9, 3, P.iron);
        r(10, 8, 2, 2, P.metal);
        return;
      }
      const sh = shade(c);
      headR(r, 10, 10);
      r(14, 16, 6, 6, c);
      r(18, 20, 6, 6, c);
      r(18, 25, 6, 1, sh);
      r(24, 25, 6, 5, P.shorts);
      seg(r, 29, 28, 33, 28, 3, P.skin);
      r(34, 29, 2, 12, P.skin);
      r(34, 41, 4, 2, P.shoe);
      const hand = f ? 5 : 11;
      r(17, hand, 2, 17 - hand, P.skin);
      disc(r, 18, hand - 2, 3, P.iron);
      r(17, hand - 3, 2, 2, P.metal);
    },
  },
  dbbench: {
    fw: 3, fh: 2, w: 48, h: 40, label: 42, ms: 600,
    draw(r, c, f, pose) {
      r(7, 26, 30, 4, P.pad);
      r(7, 26, 30, 1, P.padL);
      r(12, 30, 2, 9, P.metalD);
      r(31, 30, 2, 9, P.metalD);
      r(10, 37, 25, 2, P.metalD);
      if (!c || pose !== "db-press") {
        // a pair of dumbbells waiting on the floor
        for (const x of [0, 39]) {
          r(x + 1, 34, 7, 2, P.metal);
          r(x, 32, 2, 5, P.iron);
          r(x + 6, 32, 2, 5, P.iron);
        }
      }
      if (!c) return;
      if (pose === "db-press") return lying(r, c, f, "db");
      // seated on the end of the bench, pressing overhead
      seg(r, 24, 22, 30, 22, 3, P.skin);
      r(30, 24, 2, 13, P.skin);
      r(30, 37, 4, 2, P.shoe);
      const [sx, sy] = seated(r, c, 21, 26);
      const hand = f ? 1 : 8;
      r(sx, hand, 2, sy - hand, P.skin);
      r(sx - 3, hand - 1, 8, 2, P.iron);
      r(sx - 3, hand - 2, 2, 4, P.iron);
      r(sx + 3, hand - 2, 2, 4, P.iron);
    },
  },
  dumbbells: {
    fw: 1, fh: 1, w: 32, h: 32, label: 26, ms: 550, inPlace: true,
    draw(r, c, f, pose) {
      r(4, 27, 24, 4, P.ironL);
      if (!c) {
        r(7, 27, 6, 2, P.iron);
        r(19, 27, 6, 2, P.iron);
        return;
      }
      if (pose === "lateral") {
        front(r, c, { cx: 16, fy: 29, arms: f ? "out" : "curlDown" });
        if (f) {
          r(3, 14, 3, 4, P.iron);
          r(26, 14, 3, 4, P.iron);
        }
      } else if (pose === "goblet") front(r, c, { cx: 16, fy: 29, legs: f ? "squat" : "stand", u: f ? 4 : 0, arms: "goblet" });
      else front(r, c, { cx: 16, fy: 29, arms: f ? "curlUp" : "curlDown" });
    },
  },
  shoulder: {
    fw: 2, fh: 2, w: 36, h: 52, label: 46, ms: 650,
    draw(r, c, f) {
      r(3, 4, 3, 45, P.metalD);
      r(30, 4, 3, 45, P.metalD);
      r(3, 3, 30, 3, P.metalD);
      r(1, 48, 34, 3, P.metalD);
      stack(r, 26, 28, 3, 18);
      r(12, 14, 12, 22, P.pad);
      r(12, 14, 12, 1, P.padL);
      r(9, 36, 18, 3, P.pad);
      r(17, 39, 2, 9, P.metalD);
      const y = c && f ? 10 : 22;
      if (c) front(r, c, { cx: 18, fy: 50, legs: "sit", u: -4, arms: "reach", barY: y + 1 });
      r(6, y + 1, 4, 2, P.metalD);
      r(26, y + 1, 4, 2, P.metalD);
      r(9, y, 3, 3, P.iron);
      r(24, y, 3, 3, P.iron);
    },
  },
  rack: {
    fw: 3, fh: 2, w: 48, h: 50, label: 26, ms: 700,
    draw(r, c, f) {
      r(5, 6, 3, 43, P.metalD);
      r(40, 6, 3, 43, P.metalD);
      r(5, 4, 38, 3, P.metalD);
      for (let y = 10; y < 44; y += 4) {
        r(6, y, 1, 1, P.iron);
        r(41, y, 1, 1, P.iron);
      }
      r(2, 47, 9, 2, P.metalD);
      r(37, 47, 9, 2, P.metalD);
      r(8, 38, 5, 1, P.metal);
      r(35, 38, 5, 1, P.metal);
      r(8, 35, 2, 1, P.metal);
      r(38, 35, 2, 1, P.metal);
      if (c) front(r, c, { cx: 24, fy: 48, legs: f ? "squat" : "stand", u: f ? 4 : 0, arms: "bar", bar: 23 });
      else {
        r(1, 34, 46, 1, P.metal);
        r(1, 30, 3, 9, P.iron);
        r(44, 30, 3, 9, P.iron);
      }
    },
  },
  legpress: {
    fw: 3, fh: 2, w: 52, h: 50, label: 40, ms: 700,
    draw(r, c, f) {
      r(2, 44, 48, 4, P.metalD);
      for (let i = 0; i < 9; i++) r(16 + i * 3, 42 - i * 4, 4, 3, P.metalD);
      r(4, 23, 6, 14, P.pad);
      r(4, 23, 6, 1, P.padL);
      r(8, 36, 12, 4, P.pad);
      r(12, 40, 2, 4, P.metalD);
      const k = c ? (f ? 6 : 3) : 3;
      const [px, py] = [16 + k * 3, 42 - k * 4];
      if (c) {
        const foot = [px + 1, py - 4];
        if (f) seg(r, 16, 32, ...foot, 3, P.skin);
        else {
          seg(r, 16, 32, 23, 21, 3, P.skin);
          seg(r, 23, 21, ...foot, 2, P.skin);
        }
        r(foot[0] - 1, foot[1] - 2, 3, 5, P.shoe);
        r(9, 30, 9, 6, P.shorts);
        r(5, 20, 6, 11, c);
        r(5, 20, 1, 11, shade(c));
        headR(r, 4, 13);
        seg(r, 9, 23, 13, 34, 2, P.skin);
      }
      r(px + 2, py - 10, 3, 13, P.metal);
      r(px + 5, py - 7, 2, 4, P.metalD);
      r(px + 7, py - 9, 3, 9, P.iron);
      r(px + 10, py - 8, 2, 7, P.iron);
    },
  },
  legext: {
    fw: 2, fh: 2, w: 36, h: 44, label: 36, ms: 650,
    draw(r, c, f) {
      r(3, 40, 30, 3, P.metalD);
      r(27, 8, 4, 32, P.metalD);
      stack(r, 28, 22, 2, 16);
      r(7, 29, 15, 4, P.pad);
      r(7, 29, 15, 1, P.padL);
      r(13, 33, 2, 7, P.metalD);
      r(6, 13, 4, 17, P.pad);
      const ankle = c && f ? [31, 25] : [23, 37];
      seg(r, 22, 31, ...ankle, 1, P.metalD);
      if (c) {
        seg(r, 14, 26, 22, 28, 3, P.skin);
        seg(r, 22, 29, ...ankle, 2, P.skin);
        r(ankle[0] + 1, ankle[1] - 1, 2, 3, P.shoe);
        const [sx, sy] = seated(r, c, 12, 29);
        seg(r, sx, sy, sx + 3, sy + 10, 2, P.skin);
      }
      r(ankle[0] - 2, ankle[1] + 1, 5, 3, P.padL);
      r(21, 29, 3, 3, P.metalD);
    },
  },
  legcurl: {
    fw: 3, fh: 2, w: 48, h: 36, label: 26, ms: 650,
    draw(r, c, f) {
      r(6, 32, 30, 2, P.metalD);
      r(10, 26, 2, 7, P.metalD);
      r(30, 26, 2, 7, P.metalD);
      r(38, 14, 3, 19, P.metalD);
      stack(r, 41, 18, 3, 14);
      r(4, 22, 32, 4, P.pad);
      r(4, 22, 32, 1, P.padL);
      const ankle = c && f ? [38, 10] : [43, 20];
      seg(r, 34, 21, ...ankle, 1, P.metalD);
      if (c) {
        const sh = shade(c);
        r(3, 16, 6, 6, P.skin);
        r(3, 15, 6, 3, P.hair);
        r(9, 17, 13, 5, c);
        r(9, 21, 13, 1, sh);
        r(22, 17, 6, 5, P.shorts);
        r(28, 18, 6, 3, P.skin);
        seg(r, 34, 19, ...ankle, 2, P.skin);
        r(ankle[0] + 1, ankle[1] + 1, 3, 2, P.shoe);
        seg(r, 11, 19, 7, 25, 2, P.skin);
      }
      r(ankle[0] - 1, ankle[1] - 3, 5, 3, P.padL);
      r(33, 20, 3, 3, P.metalD);
    },
  },
  pulldown: {
    fw: 2, fh: 2, w: 40, h: 50, label: 42, ms: 650,
    draw(r, c, f) {
      r(30, 4, 6, 45, P.metalD);
      stack(r, 31, 30, 4, 16);
      r(14, 3, 22, 3, P.metalD);
      r(19, 6, 3, 2, P.metal);
      r(6, 47, 30, 2, P.metalD);
      r(18, 41, 3, 6, P.metalD);
      r(11, 38, 17, 3, P.pad);
      const barY = c ? (f ? 19 : 9) : 13;
      r(20, 8, 1, barY - 8, P.metal);
      if (c) front(r, c, { cx: 20, fy: 48, legs: "sit", u: -4, arms: "reach", barY: barY + 1 });
      r(8, barY, 25, 2, P.metal);
      r(8, barY, 3, 2, P.iron);
      r(30, barY, 3, 2, P.iron);
      r(12, 35, 16, 2, P.padL);
    },
  },
  row: {
    fw: 3, fh: 2, w: 48, h: 42, label: 34, ms: 650,
    draw(r, c, f) {
      r(38, 4, 7, 36, P.metalD);
      stack(r, 39, 21, 5, 15);
      r(36, 23, 3, 3, P.metal);
      r(4, 36, 36, 3, P.metalD);
      r(13, 32, 2, 4, P.metalD);
      r(9, 30, 11, 3, P.pad);
      r(30, 22, 3, 12, P.metal);
      r(30, 33, 5, 3, P.metalD);
      if (!c) {
        r(34, 23, 2, 3, P.iron);
        return;
      }
      seg(r, 16, 28, 24, 22, 3, P.skin);
      seg(r, 24, 23, 28, 27, 2, P.skin);
      r(28, 24, 2, 6, P.shoe);
      const [sx, sy] = seated(r, c, 13, 30);
      let hand;
      if (f) {
        seg(r, sx, sy, sx - 3, sy + 5, 2, P.skin);
        seg(r, sx - 3, sy + 5, sx + 6, sy + 5, 2, P.skin);
        hand = [sx + 6, sy + 5];
      } else {
        hand = [27, 21];
        seg(r, sx, sy, ...hand, 2, P.skin);
      }
      r(hand[0] + 1, hand[1] - 1, 2, 4, P.iron);
      seg(r, hand[0] + 3, hand[1] + 1, 36, 24, 1, P.metal);
    },
  },
  cable: {
    fw: 4, fh: 2, w: 64, h: 58, label: 32, ms: 650,
    draw(r, c, f, pose) {
      r(4, 4, 7, 51, P.metalD);
      r(53, 4, 7, 51, P.metalD);
      stack(r, 5, 32, 5, 20);
      stack(r, 54, 32, 5, 20);
      r(4, 2, 56, 4, P.metalD);
      r(2, 54, 60, 3, P.metalD);
      r(11, 26, 3, 4, P.metal);
      r(11, 30, 1, 5, P.metal);
      r(10, 35, 3, 3, P.iron);
      const py = !c ? 26 : pose === "pushdown" ? 10 : pose === "cable-curl" ? 46 : 30;
      r(50, py, 3, 4, P.metal);
      if (!c) {
        r(51, py + 4, 1, 5, P.metal);
        r(50, py + 9, 3, 3, P.iron);
        return;
      }
      side(r, c, { x: 36, fy: 54, arm: "none" });
      const sh = [36, 41];
      const [elbow, hand] =
        pose === "face-pull"
          ? f
            ? [[33, 37], [41, 35]]
            : [[41, 39], [46, 38]]
          : pose === "cable-curl"
            ? [[37, 46], f ? [41, 40] : [42, 50]]
            : [[37, 46], f ? [42, 50] : [42, 43]];
      seg(r, ...sh, ...elbow, 2, shade(c));
      seg(r, ...elbow, ...hand, 2, P.skin);
      r(hand[0] + 1, hand[1] - 1, 2, 3, P.iron);
      seg(r, hand[0] + 3, hand[1], 50, py + 2, 1, P.metal);
    },
  },
  pullup: {
    fw: 2, fh: 2, w: 36, h: 58, label: 52, ms: 700,
    draw(r, c, f) {
      r(3, 2, 3, 53, P.metalD);
      r(30, 2, 3, 53, P.metalD);
      r(3, 2, 30, 3, P.metalD);
      r(1, 54, 34, 3, P.metalD);
      r(6, 6, 4, 2, P.iron);
      r(26, 6, 4, 2, P.iron);
      stack(r, 15, 34, 6, 18);
      const py = c ? (f ? 34 : 42) : 44;
      r(17, py + 3, 2, 52 - py, P.metal);
      if (c) front(r, c, { cx: 18, fy: py - 1, arms: "reach", barY: 6 });
      r(10, py, 16, 3, P.pad);
      r(10, py, 16, 1, P.padL);
    },
  },
  preacher: {
    fw: 2, fh: 2, w: 36, h: 44, label: 36, ms: 650,
    draw(r, c, f) {
      r(3, 40, 28, 3, P.metalD);
      r(9, 33, 2, 7, P.metalD);
      r(4, 30, 10, 3, P.pad);
      r(22, 25, 2, 15, P.metalD);
      r(14, 19, 5, 3, P.padL);
      r(18, 21, 5, 3, P.padL);
      r(22, 23, 5, 3, P.padL);
      if (!c) {
        r(25, 27, 8, 2, P.metal);
        r(24, 25, 2, 6, P.iron);
        r(32, 25, 2, 6, P.iron);
        return;
      }
      seg(r, 11, 27, 15, 28, 3, P.skin);
      r(14, 30, 2, 10, P.skin);
      r(14, 39, 4, 2, P.shoe);
      const [sx, sy] = seated(r, c, 9, 30);
      seg(r, sx + 1, sy, 20, 21, 2, P.skin);
      const hand = f ? [17, 13] : [27, 28];
      seg(r, 20, 21, ...hand, 2, P.skin);
      r(hand[0] - 2, hand[1] - 1, 6, 2, P.metal);
      r(hand[0] - 3, hand[1] - 3, 2, 6, P.iron);
      r(hand[0] + 3, hand[1] - 3, 2, 6, P.iron);
    },
  },
  mats: {
    fw: 2, fh: 1, w: 40, h: 32, label: 30, ms: 900, inPlace: true,
    draw(r, c, f) {
      r(2, 26, 36, 5, P.mat);
      r(2, 26, 36, 1, P.matL);
      if (c) front(r, c, { cx: 20, fy: 29, arms: f ? "out" : "up" });
    },
  },
};

export function stationSprite(kind, colour, frame, pose = "") {
  return cached(`${kind}:${colour}:${colour ? frame : 0}:${colour ? pose : ""}`, () => {
    const k = KINDS[kind];
    return make(k.w, k.h, (r) => k.draw(r, colour, frame, pose));
  });
}

// ---- the furniture that fills the room ----

// Painted words inside a sprite, in the floor font.
const letters = (r, text, x, y, col) => {
  let cx = x;
  for (const ch of text) {
    const glyph = GLYPHS[ch] ?? GLYPHS[" "];
    glyph.forEach((row, gy) => [...row].forEach((cell, gx) => cell === "#" && r(cx + gx, y + gy, 1, 1, col)));
    cx += glyph[0].length + 1;
  }
};

export const DECOR = {
  dumbbellRack: {
    fw: 8, fh: 1, w: 128, h: 30,
    draw(r) {
      r(2, 13, 124, 3, P.metalD);
      r(2, 22, 124, 3, P.metalD);
      for (const x of [2, 63, 124]) r(x, 13, 2, 15, P.metalD);
      for (let i = 0; i < 10; i++) {
        const x = 6 + i * 12;
        const s = 3 + Math.floor(i / 3);
        for (const y of [10, 19]) {
          r(x, y + 1, 8, 1, P.metal);
          r(x - 1, y + 2 - s / 2, 3, s, P.iron);
          r(x + 6, y + 2 - s / 2, 3, s, P.iron);
        }
      }
    },
  },
  plateTree: {
    fw: 1, fh: 1, w: 16, h: 32,
    draw(r) {
      r(2, 27, 12, 3, P.metalD);
      r(7, 4, 2, 24, P.metalD);
      r(3, 9, 10, 4, P.iron);
      r(2, 15, 12, 4, P.iron);
      r(3, 21, 10, 4, P.iron);
      r(7, 10, 2, 2, P.metal);
    },
  },
  barbell: {
    fw: 4, fh: 1, w: 64, h: 22,
    draw(r) {
      r(2, 12, 60, 2, P.metal);
      r(5, 4, 4, 16, P.iron);
      r(10, 6, 3, 12, P.iron);
      r(55, 4, 4, 16, P.iron);
      r(51, 6, 3, 12, P.iron);
    },
  },
  barRack: {
    fw: 2, fh: 1, w: 32, h: 36,
    draw(r) {
      r(3, 28, 26, 5, P.metalD);
      for (let i = 0; i < 5; i++) {
        r(6 + i * 5, 3, 1, 26, P.metal);
        r(5 + i * 5, 3, 3, 3, P.metalD);
      }
    },
  },
  plateRack: {
    fw: 2, fh: 1, w: 32, h: 26,
    draw(r) {
      r(2, 20, 28, 4, P.metalD);
      for (let i = 0; i < 5; i++) r(4 + i * 5, 20 - (8 - i), 4, 8 - i + 1, P.iron);
      r(4, 8, 2, 13, P.metalD);
      r(26, 8, 2, 13, P.metalD);
    },
  },
  kettlebells: {
    fw: 3, fh: 1, w: 48, h: 22,
    draw(r) {
      r(2, 16, 44, 3, P.metalD);
      for (let i = 0; i < 5; i++) {
        disc(r, 7 + i * 8, 12, 3, P.iron);
        r(5 + i * 8, 6, 5, 2, P.iron);
      }
    },
  },
  // a bench in the locker room, someone's bag and towel left on it
  lockerBench: {
    fw: 3, fh: 1, w: 48, h: 26,
    draw(r) {
      r(3, 12, 42, 5, P.woodL);
      r(3, 16, 42, 1, P.woodD);
      r(6, 17, 2, 7, P.metalD);
      r(40, 17, 2, 7, P.metalD);
      r(8, 5, 14, 8, "#3f6f9a");
      r(8, 5, 14, 2, "#5a8ab4");
      r(12, 3, 6, 2, P.iron);
      r(30, 9, 8, 3, P.white);
      r(30, 11, 8, 1, "#d9d2c4");
    },
  },
  shoes: {
    fw: 1, fh: 1, w: 16, h: 12, walk: true,
    draw(r) {
      r(2, 5, 5, 3, P.white);
      r(2, 7, 6, 2, "#e2574c");
      r(9, 4, 5, 3, P.white);
      r(9, 6, 6, 2, "#e2574c");
    },
  },
  towelRail: {
    fw: 2, fh: 1, w: 32, h: 30,
    draw(r) {
      r(2, 6, 2, 22, P.metalD);
      r(28, 6, 2, 22, P.metalD);
      r(2, 6, 28, 2, P.metal);
      r(6, 8, 8, 12, P.white);
      r(6, 18, 8, 2, "#d9d2c4");
      r(17, 8, 8, 10, "#5aaca0");
      r(17, 16, 8, 2, "#468d83");
    },
  },
  sink: {
    fw: 2, fh: 1, w: 32, h: 36,
    draw(r) {
      r(3, 2, 26, 14, "#8a8aa6");
      r(4, 3, 24, 12, "#b9d5e3");
      r(7, 5, 2, 2, "#dcedf5");
      r(9, 7, 2, 2, "#dcedf5");
      r(1, 19, 30, 6, P.white);
      r(1, 24, 30, 2, "#d9d2c4");
      r(10, 20, 12, 3, "#9fc4d8");
      r(15, 16, 2, 4, P.metal);
      r(4, 26, 2, 8, P.metalD);
      r(26, 26, 2, 8, P.metalD);
    },
  },
  laundry: {
    fw: 1, fh: 1, w: 16, h: 22,
    draw(r) {
      r(3, 8, 10, 12, "#7d6a55");
      r(3, 8, 10, 1, "#9a8466");
      r(4, 5, 4, 4, P.white);
      r(8, 4, 4, 5, "#5aaca0");
      r(5, 12, 6, 1, "#5f5040");
    },
  },
  // the notice board at reception: how the gym works
  board: {
    fw: 2, fh: 1, w: 32, h: 34,
    draw(r) {
      r(1, 2, 30, 20, P.woodD);
      r(2, 3, 28, 18, "#b98a55");
      r(4, 5, 10, 7, P.white);
      r(16, 5, 11, 5, "#f1c13b");
      r(5, 14, 9, 5, "#9bd3f8");
      r(17, 12, 9, 7, P.white);
      letters(r, "HOW", 5, 6, INK);
      r(6, 22, 2, 10, P.metalD);
      r(24, 22, 2, 10, P.metalD);
    },
  },
  // the front desk: counter, a screen for the staff, a check-in tablet and
  // the gym's name across the front
  counter: {
    fw: 6, fh: 2, w: 96, h: 46,
    draw(r) {
      r(58, 2, 16, 12, P.metalD);
      r(59, 3, 14, 9, P.screen);
      r(60, 4, 6, 1, P.white);
      r(60, 6, 9, 1, "#5bbfa8");
      r(64, 14, 4, 4, P.metalD);
      r(0, 17, 96, 7, P.woodL);
      r(0, 17, 96, 1, "#d39a6a");
      r(0, 24, 96, 20, P.wood);
      r(0, 30, 96, 4, "#ff6b4a");
      for (let x = 23; x < 96; x += 24) r(x, 34, 1, 10, P.woodD);
      letters(r, "SAME GYM", 30, 36, P.white);
      r(14, 13, 10, 6, P.metalD);
      r(15, 14, 8, 4, P.screen);
      r(40, 19, 12, 2, P.metalD);
      r(80, 18, 7, 3, P.white);
      r(81, 17, 7, 3, P.white);
      r(4, 12, 6, 6, P.pot);
      disc(r, 7, 9, 3, P.green);
    },
  },
  stool: {
    fw: 1, fh: 1, w: 16, h: 22,
    draw(r) {
      r(3, 5, 10, 3, P.iron);
      r(7, 8, 2, 10, P.metalD);
      r(4, 18, 8, 2, P.metalD);
    },
  },
  // turnstiles stand in the way in, but you walk through them
  turnstile: {
    fw: 1, fh: 1, w: 16, h: 30, walk: true,
    draw(r) {
      r(2, 10, 5, 18, P.metal);
      r(2, 9, 5, 2, "#59d07a");
      r(7, 16, 8, 2, P.metalD);
      r(7, 20, 6, 2, P.metalD);
    },
  },
  kiosk: {
    fw: 1, fh: 1, w: 16, h: 34,
    draw(r) {
      r(7, 14, 2, 17, P.metalD);
      r(4, 30, 8, 2, P.metalD);
      r(2, 3, 12, 11, P.metalD);
      r(3, 4, 10, 8, P.screen);
      r(5, 6, 6, 1, P.white);
      r(5, 8, 4, 1, P.white);
    },
  },
  towels: {
    fw: 2, fh: 1, w: 32, h: 32,
    draw(r) {
      r(2, 4, 28, 26, P.woodD);
      r(4, 6, 24, 22, "#5a3b28");
      for (const y of [10, 18, 26]) r(3, y, 26, 2, P.woodD);
      const cols = [P.white, "#5aaca0", "#e07b4f", P.white];
      for (let i = 0; i < 4; i++) {
        r(5 + i * 6, 6, 5, 4, cols[i]);
        r(5 + i * 6, 14, 5, 4, cols[3 - i]);
        r(5 + i * 6, 22, 5, 4, cols[(i + 1) % 4]);
      }
    },
  },
  bin: {
    fw: 1, fh: 1, w: 16, h: 20,
    draw(r) {
      r(4, 6, 8, 12, P.metalD);
      r(3, 4, 10, 3, P.metal);
      r(5, 9, 1, 7, P.metal);
    },
  },
  water: {
    fw: 3, fh: 1, w: 48, h: 38,
    draw(r) {
      r(2, 24, 44, 4, P.woodL);
      r(4, 28, 2, 8, P.woodD);
      r(42, 28, 2, 8, P.woodD);
      for (const x of [6, 20]) {
        r(x, 13, 10, 11, P.white);
        r(x + 1, 3, 8, 10, P.water);
        r(x + 2, 4, 2, 7, "#9bd3f8");
        r(x + 3, 16, 4, 2, "#4a8fd0");
      }
      r(34, 16, 4, 8, P.white);
      r(39, 18, 4, 6, P.white);
    },
  },
  plant: {
    fw: 1, fh: 1, w: 16, h: 30,
    draw(r) {
      r(4, 20, 8, 8, P.pot);
      r(4, 20, 8, 1, "#d27a50");
      disc(r, 8, 13, 5, P.green);
      disc(r, 5, 8, 3, P.green);
      disc(r, 11, 7, 3, P.greenD);
      r(7, 14, 2, 6, P.greenD);
    },
  },
  ball: {
    fw: 1, fh: 1, w: 18, h: 18,
    draw(r) {
      disc(r, 9, 9, 7, "#8a6fd1");
      r(5, 5, 3, 2, "#a990e6");
    },
  },
  rollers: {
    fw: 3, fh: 1, w: 48, h: 24,
    draw(r) {
      r(2, 18, 44, 2, P.metalD);
      r(2, 8, 2, 12, P.metalD);
      r(44, 8, 2, 12, P.metalD);
      r(5, 9, 12, 5, "#e07b4f");
      r(18, 9, 12, 5, P.matL);
      r(31, 9, 12, 5, "#e07b4f");
    },
  },
  sofa: {
    fw: 4, fh: 1, w: 64, h: 30,
    draw(r) {
      r(3, 4, 58, 11, P.sofaD);
      r(3, 15, 58, 9, P.sofa);
      r(0, 9, 6, 17, P.sofaD);
      r(58, 9, 6, 17, P.sofaD);
      r(31, 15, 1, 9, P.sofaD);
    },
  },
  vending: {
    fw: 2, fh: 2, w: 32, h: 50,
    draw(r) {
      r(2, 4, 28, 44, "#3b77a8");
      r(5, 8, 15, 30, "#bfe3f4");
      for (let y = 11; y < 36; y += 6) for (let x = 6; x < 19; x += 4) r(x, y, 3, 3, ["#e2574c", "#f1c13b", "#62b6f0", "#59b067"][(x + y) % 4]);
      r(22, 10, 5, 3, P.screen);
      r(22, 16, 5, 10, "#2a5a82");
      r(6, 40, 14, 4, "#2a5a82");
    },
  },
  bench: {
    fw: 3, fh: 1, w: 48, h: 22,
    draw(r) {
      r(3, 8, 42, 5, P.woodL);
      r(3, 12, 42, 1, P.woodD);
      r(6, 13, 2, 7, P.metalD);
      r(40, 13, 2, 7, P.metalD);
    },
  },
};

// One locker, seen from the front. Free ones stand slightly open; taken ones
// are shut with a padlock; yours carries your colour above the number.
export const LOCKER = { w: 16, h: 38 };

export function lockerSprite(number, state, colour = null) {
  return cached(`locker:${number}:${state}:${colour}`, () =>
    make(LOCKER.w, LOCKER.h, (r) => {
      r(1, 2, 14, 3, P.lockerD);
      r(1, 5, 14, 31, P.locker);
      r(2, 6, 12, 28, state === "free" ? P.locker : P.lockerL);
      r(2, 6, 1, 28, P.lockerD);
      if (state === "free") r(12, 6, 2, 28, "#1d2433");
      for (const y of [9, 11, 13]) r(4, y, 8, 1, P.lockerD);
      if (state === "mine") r(2, 6, 12, 2, colour);
      r(3, 16, 9, 7, state === "free" ? "#c9ced6" : P.white);
      letters(r, String(number).padStart(2, "0"), 4, 17, INK);
      r(10, 25, 2, 4, P.metal);
      if (state !== "free") {
        r(7, 27, 1, 2, P.metal);
        r(9, 27, 1, 2, P.metal);
        r(6, 29, 5, 4, state === "mine" ? colour : P.brass);
      }
      r(1, 34, 14, 2, P.lockerD);
    }),
  );
}

export function decorSprite(kind) {
  return cached(`decor:${kind}`, () => make(DECOR[kind].w, DECOR[kind].h, DECOR[kind].draw));
}

// ---- floors, walls and painted words ----

const FLOORS = {
  cardio: ["#3b4a66", "#364460", 4],
  machines: ["#545a6e", "#4d5366", 3],
  free: ["#3a3846", "#34323f", 6],
  bench: ["#4e3a4a", "#473544", 5],
  legs: ["#3a3846", "#34323f", 6],
  lobby: ["#cfc5b5", "#c2b8a6", 0],
  recovery: ["#3f6b66", "#39625d", 2],
  aisle: ["#676a7b", "#61647a", 0],
  wood: ["#9a6440", "#8c5a39", 0],
  lounge: ["#8f7255", "#836749", 0],
  entry: ["#a59b8c", "#978d7e", 2],
  locker: ["#a9b6c2", "#9aa7b4", 0],
  doormat: ["#6b4a3a", "#5e4033", 0],
};

const hash = (x, y) => {
  let h = (x * 374761393 + y * 668265263) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return (h ^ (h >>> 16)) >>> 0;
};

export function paintFloor(g, kind, tx, ty, tw, th) {
  const [base, seam, specks] = FLOORS[kind];
  for (let y = ty; y < ty + th; y++) {
    for (let x = tx; x < tx + tw; x++) {
      const px = x * T;
      const py = y * T;
      g.fillStyle = base;
      g.fillRect(px, py, T, T);
      g.fillStyle = seam;
      if (kind === "wood" || kind === "lounge") {
        g.fillRect(px, py + 7, T, 1);
        g.fillRect(px, py + 15, T, 1);
        g.fillRect(px + (hash(x, y) % 12) + 2, py + ((x + y) % 2 ? 0 : 8), 1, 7);
      } else if (kind === "locker") {
        g.fillRect(px, py + 7, T, 1);
        g.fillRect(px, py + 15, T, 1);
        g.fillRect(px + 7, py, 1, T);
        g.fillRect(px + 15, py, 1, T);
      } else if (kind === "lobby") {
        g.fillStyle = (x + y) % 2 ? base : "#c8bdab";
        g.fillRect(px, py, T, T);
        g.fillStyle = seam;
        g.fillRect(px, py + 15, T, 1);
        g.fillRect(px + 15, py, 1, T);
      } else {
        g.fillRect(px, py + 15, T, 1);
        g.fillRect(px + 15, py, 1, T);
      }
      for (let i = 0; i < specks; i++) {
        const h = hash(x * 7 + i, y * 13 - i);
        g.fillStyle = h & 1 ? "rgba(255,255,255,0.07)" : "rgba(0,0,0,0.12)";
        g.fillRect(px + (h % 14), py + ((h >>> 8) % 14), 1, 1);
      }
    }
  }
}

// Daylight from a window, falling across the floor in stepped bands.
export function paintLight(g, x, w, depth) {
  for (let i = 0; i < depth; i++) {
    g.fillStyle = `rgba(255, 246, 214, ${0.075 - i * 0.006})`;
    g.fillRect(x * T + 4 - i * 2, 3 * T + i * 8, w * T - 8 + i * 4, 8);
  }
}

// A wall inside the building, seen from above: a cap, and for walls that run
// across the room, the face below it.
export function paintInnerWall(g, tx, ty, across) {
  const x = tx * T;
  const y = ty * T;
  g.fillStyle = "#2c2a3f";
  g.fillRect(x, y, T, across ? 6 : T);
  if (across) {
    g.fillStyle = "#5d5a7a";
    g.fillRect(x, y + 6, T, 8);
    g.fillStyle = "#3c3a52";
    g.fillRect(x, y + 14, T, 2);
  } else {
    g.fillStyle = "#3c3a52";
    g.fillRect(x + T - 2, y, 2, T);
  }
}

// Yellow safety lines along a walkway, the way a real gym marks its floor.
export function paintAisleEdges(g, tx, ty, tw, th) {
  g.fillStyle = "#d9b043";
  if (tw > th) {
    for (let x = tx * T; x < (tx + tw) * T; x += 8) {
      g.fillRect(x, ty * T + 1, 5, 1);
      g.fillRect(x, (ty + th) * T - 2, 5, 1);
    }
  } else {
    for (let y = ty * T; y < (ty + th) * T; y += 8) {
      g.fillRect(tx * T + 1, y, 1, 5);
      g.fillRect((tx + tw) * T - 2, y, 1, 5);
    }
  }
}

// The back wall: a cap, a painted face and a skirting board, with windows,
// a mirror and posters set into it.
export function paintWalls(g, W, H, features, door) {
  g.fillStyle = "#2c2a3f";
  g.fillRect(0, 0, W * T, 10);
  g.fillStyle = "#5d5a7a";
  g.fillRect(0, 10, W * T, 34);
  g.fillStyle = "#6a6788";
  g.fillRect(0, 10, W * T, 3);
  g.fillStyle = "#3c3a52";
  g.fillRect(0, 44, W * T, 4);
  for (const f of features) {
    const x = f.x * T;
    const w = f.w * T;
    if (f.kind === "window") {
      g.fillStyle = "#3c3a52";
      g.fillRect(x, 14, w, 26);
      g.fillStyle = "#8fd0f2";
      g.fillRect(x + 2, 16, w - 4, 22);
      g.fillStyle = "#c4e8fa";
      g.fillRect(x + 2, 16, w - 4, 6);
      g.fillStyle = "#3c3a52";
      for (let i = x + 2 + 15; i < x + w - 4; i += 16) g.fillRect(i, 16, 2, 22);
    } else if (f.kind === "mirror") {
      g.fillStyle = "#8a8aa6";
      g.fillRect(x, 13, w, 29);
      g.fillStyle = "#b9d5e3";
      g.fillRect(x + 2, 15, w - 4, 25);
      g.fillStyle = "#dcedf5";
      for (let i = x + 10; i < x + w - 20; i += 48) {
        for (let k = 0; k < 10; k++) g.fillRect(i + k, 37 - k * 2, 2, 2);
      }
    } else if (f.kind === "poster") {
      g.fillStyle = f.colour;
      g.fillRect(x, 16, w, 22);
      g.fillStyle = "rgba(255,255,255,0.55)";
      g.fillRect(x + 3, 20, w - 6, 2);
      g.fillRect(x + 3, 25, w - 10, 2);
      g.fillStyle = "rgba(0,0,0,0.25)";
      g.fillRect(x + 3, 30, w - 6, 5);
    } else if (f.kind === "tv") {
      g.fillStyle = INK;
      g.fillRect(x, 13, w, 28);
      g.fillStyle = "#24476a";
      g.fillRect(x + 2, 15, w - 4, 24);
      g.fillStyle = "#3fd0b4";
      for (let i = 0; i < w - 12; i += 6) g.fillRect(x + 6 + i, 32 - ((i * 7) % 13), 4, 4 + ((i * 7) % 13));
      g.fillStyle = "#f4efe6";
      g.fillRect(x + 6, 18, 18, 2);
    } else if (f.kind === "clock") {
      g.fillStyle = "#f4efe6";
      g.fillRect(x + 3, 17, 10, 10);
      g.fillStyle = INK;
      g.fillRect(x + 7, 19, 2, 5);
      g.fillRect(x + 8, 22, 3, 2);
    }
  }
  // side and front walls, seen from above
  g.fillStyle = "#2c2a3f";
  g.fillRect(0, 0, T, H * T);
  g.fillRect((W - 1) * T, 0, T, H * T);
  g.fillRect(0, (H - 1) * T, W * T, T);
  g.fillStyle = "#3c3a52";
  g.fillRect(T - 2, 48, 2, (H - 4) * T);
  g.fillRect((W - 1) * T, 48, 2, (H - 4) * T);
  // the way in
  paintFloor(g, "doormat", door.x, H - 1, door.w, 1);
  g.fillStyle = "#e9d8a6";
  g.fillRect(door.x * T, (H - 1) * T, 2, T);
  g.fillRect((door.x + door.w) * T - 2, (H - 1) * T, 2, T);
}

// A 3×5 pixel font for floor markings, painted at twice size.
const GLYPHS = {
  A: [".#.", "#.#", "###", "#.#", "#.#"],
  B: ["##.", "#.#", "##.", "#.#", "##."],
  C: [".##", "#..", "#..", "#..", ".##"],
  D: ["##.", "#.#", "#.#", "#.#", "##."],
  E: ["###", "#..", "##.", "#..", "###"],
  F: ["###", "#..", "##.", "#..", "#.."],
  G: [".##", "#..", "#.#", "#.#", ".##"],
  H: ["#.#", "#.#", "###", "#.#", "#.#"],
  I: ["###", ".#.", ".#.", ".#.", "###"],
  K: ["#.#", "#.#", "##.", "#.#", "#.#"],
  L: ["#..", "#..", "#..", "#..", "###"],
  M: ["#...#", "##.##", "#.#.#", "#...#", "#...#"],
  N: ["#..#", "##.#", "#.##", "#..#", "#..#"],
  O: [".#.", "#.#", "#.#", "#.#", ".#."],
  P: ["##.", "#.#", "##.", "#..", "#.."],
  Q: [".#.", "#.#", "#.#", "#.#", ".##"],
  R: ["##.", "#.#", "##.", "#.#", "#.#"],
  S: [".##", "#..", ".#.", "..#", "##."],
  T: ["###", ".#.", ".#.", ".#.", ".#."],
  U: ["#.#", "#.#", "#.#", "#.#", "###"],
  V: ["#.#", "#.#", "#.#", "#.#", ".#."],
  W: ["#...#", "#...#", "#.#.#", "##.##", "#...#"],
  Y: ["#.#", "#.#", ".#.", ".#.", ".#."],
  "&": [".#.", "#.#", ".#.", "#.#", ".##"],
  " ": ["..", "..", "..", "..", ".."],
  0: ["###", "#.#", "#.#", "#.#", "###"],
  1: [".#.", "##.", ".#.", ".#.", "###"],
  2: ["###", "..#", "###", "#..", "###"],
  3: ["###", "..#", ".##", "..#", "###"],
  4: ["#.#", "#.#", "###", "..#", "..#"],
  5: ["###", "#..", "###", "..#", "###"],
  6: ["###", "#..", "###", "#.#", "###"],
  7: ["###", "..#", ".#.", ".#.", ".#."],
  8: ["###", "#.#", "###", "#.#", "###"],
  9: ["###", "#.#", "###", "..#", "###"],
};

export function paintText(g, text, x, y, colour, scale = 2) {
  g.fillStyle = colour;
  let cx = x;
  for (const ch of text) {
    const glyph = GLYPHS[ch] ?? GLYPHS[" "];
    glyph.forEach((row, gy) => {
      [...row].forEach((cell, gx) => {
        if (cell === "#") g.fillRect(cx + gx * scale, y + gy * scale, scale, scale);
      });
    });
    cx += (glyph[0].length + 1) * scale;
  }
}
