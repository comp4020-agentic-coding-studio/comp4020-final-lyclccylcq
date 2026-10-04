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
// two-frame animation speed. draw(r, colour, frame) paints the empty machine
// when colour is null. Sprites sit on their footprint's bottom edge; inPlace
// kinds (a mat, a spot on the rubber) sit under the person instead.

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
        r(16, 3, 6, 6, P.skin);
        r(16, 2, 6, 2, P.hair);
        r(16, 3, 2, 4, P.hair);
        r(20, 5, 1, 1, INK);
        r(16, 11, 3, 2, sh);
        r(19, 12, 8, 2, P.skin);
        legs(true);
      }
      r(26, 13, 7, 2, P.iron);
      r(30, 11, 4, 2, c ? P.screen : P.screenOff);
    },
  },
  bench: {
    fw: 3, fh: 2, w: 48, h: 40, label: 32, ms: 650,
    draw(r, c, f) {
      r(9, 12, 2, 27, P.metalD);
      r(11, 18, 3, 1, P.metalD);
      r(13, 30, 2, 9, P.metalD);
      r(30, 30, 2, 9, P.metalD);
      r(7, 26, 30, 4, P.pad);
      r(7, 26, 30, 1, P.padL);
      if (!c) {
        disc(r, 12, 15, 3, P.iron);
        r(11, 14, 2, 2, P.metal);
        return;
      }
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
      disc(r, 17, hand - 2, 3, P.iron);
      r(16, hand - 3, 2, 2, P.metal);
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
  pulldown: {
    fw: 2, fh: 2, w: 40, h: 50, label: 42, ms: 650,
    draw(r, c, f) {
      r(30, 4, 6, 45, P.metalD);
      r(31, 30, 4, 16, P.iron);
      for (let y = 31; y < 46; y += 3) r(31, y, 4, 1, P.ironL);
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
  dumbbells: {
    fw: 1, fh: 1, w: 32, h: 32, label: 26, ms: 550, inPlace: true,
    draw(r, c, f) {
      r(4, 27, 24, 4, P.ironL);
      if (c) front(r, c, { cx: 16, fy: 29, arms: f ? "curlUp" : "curlDown" });
      else {
        r(7, 27, 6, 2, P.iron);
        r(19, 27, 6, 2, P.iron);
      }
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

export function stationSprite(kind, colour, frame) {
  return cached(`${kind}:${colour}:${colour ? frame : 0}`, () => {
    const k = KINDS[kind];
    return make(k.w, k.h, (r) => k.draw(r, colour, frame));
  });
}

// ---- the furniture that fills the room ----

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
  cableCrossover: {
    fw: 5, fh: 2, w: 80, h: 58,
    draw(r) {
      r(4, 4, 8, 51, P.metalD);
      r(68, 4, 8, 51, P.metalD);
      r(5, 34, 6, 18, P.iron);
      r(69, 34, 6, 18, P.iron);
      for (let y = 35; y < 52; y += 3) {
        r(5, y, 6, 1, P.ironL);
        r(69, y, 6, 1, P.ironL);
      }
      r(4, 2, 72, 4, P.metalD);
      r(12, 10, 1, 22, P.metal);
      r(67, 10, 1, 22, P.metal);
      r(11, 32, 3, 3, P.iron);
      r(66, 32, 3, 3, P.iron);
      r(2, 54, 76, 2, P.metalD);
    },
  },
  seatedRow: {
    fw: 3, fh: 2, w: 48, h: 42,
    draw(r) {
      r(4, 6, 6, 34, P.metalD);
      r(5, 22, 4, 15, P.iron);
      r(10, 34, 34, 3, P.metalD);
      r(24, 30, 10, 3, P.pad);
      r(13, 24, 3, 10, P.metal);
      r(10, 20, 10, 1, P.metal);
      r(19, 19, 2, 3, P.iron);
    },
  },
  legPress: {
    fw: 3, fh: 2, w: 48, h: 46,
    draw(r) {
      r(2, 41, 44, 4, P.metalD);
      for (let i = 0; i < 8; i++) r(10 + i * 4, 38 - i * 4, 5, 3, P.metalD);
      r(32, 8, 10, 12, P.metal);
      r(38, 12, 5, 12, P.iron);
      r(4, 26, 9, 12, P.pad);
      r(4, 36, 16, 4, P.pad);
      r(4, 26, 9, 1, P.padL);
    },
  },
  legExtension: {
    fw: 2, fh: 2, w: 32, h: 42,
    draw(r) {
      r(24, 6, 4, 34, P.metalD);
      r(25, 24, 2, 12, P.iron);
      r(6, 12, 4, 18, P.pad);
      r(6, 28, 16, 4, P.pad);
      r(16, 34, 10, 3, P.padL);
      r(2, 38, 28, 2, P.metalD);
    },
  },
  chestPress: {
    fw: 2, fh: 2, w: 32, h: 46,
    draw(r) {
      r(4, 4, 24, 3, P.metalD);
      r(4, 4, 3, 41, P.metalD);
      r(25, 4, 3, 41, P.metalD);
      r(11, 14, 10, 16, P.pad);
      r(9, 32, 14, 3, P.pad);
      r(7, 22, 4, 2, P.iron);
      r(21, 22, 4, 2, P.iron);
      r(14, 35, 4, 8, P.metalD);
    },
  },
  rower: {
    fw: 4, fh: 1, w: 64, h: 26,
    draw(r) {
      r(6, 18, 50, 2, P.metal);
      r(6, 18, 2, 6, P.metalD);
      r(52, 18, 2, 6, P.metalD);
      disc(r, 54, 13, 6, P.iron);
      r(52, 11, 4, 4, P.ironL);
      r(20, 14, 8, 3, P.iron);
      r(42, 10, 4, 8, P.ironL);
    },
  },
  elliptical: {
    fw: 2, fh: 2, w: 32, h: 48,
    draw(r) {
      r(4, 43, 24, 3, P.metalD);
      r(21, 10, 3, 34, P.metalD);
      r(18, 7, 10, 4, P.metal);
      r(19, 8, 8, 2, P.screenOff);
      r(9, 20, 2, 20, P.metal);
      r(14, 22, 2, 18, P.metal);
      r(7, 36, 6, 2, P.iron);
      r(13, 32, 6, 2, P.iron);
      disc(r, 8, 40, 3, P.iron);
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
  inclineBench: {
    fw: 3, fh: 2, w: 48, h: 40,
    draw(r) {
      r(10, 30, 2, 9, P.metalD);
      r(34, 30, 2, 9, P.metalD);
      r(18, 27, 18, 4, P.pad);
      for (let i = 0; i < 5; i++) r(8 + i * 2, 24 - i * 3, 6, 4, P.pad);
      r(18, 27, 18, 1, P.padL);
    },
  },
  flatBench: {
    fw: 3, fh: 1, w: 48, h: 22,
    draw(r) {
      r(6, 10, 36, 4, P.pad);
      r(6, 10, 36, 1, P.padL);
      r(9, 14, 2, 6, P.metalD);
      r(37, 14, 2, 6, P.metalD);
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
  lockers: {
    fw: 1, fh: 2, w: 16, h: 42,
    draw(r) {
      r(1, 3, 14, 4, P.lockerD);
      r(1, 7, 14, 33, P.locker);
      for (let y = 7; y < 40; y += 11) {
        r(1, y, 14, 1, P.lockerD);
        r(11, y + 4, 2, 3, P.metal);
        r(3, y + 2, 5, 1, P.lockerD);
        r(3, y + 4, 5, 1, P.lockerD);
      }
    },
  },
  desk: {
    fw: 4, fh: 2, w: 64, h: 42,
    draw(r) {
      r(0, 16, 64, 6, P.woodL);
      r(0, 22, 64, 18, P.wood);
      for (let x = 15; x < 64; x += 16) r(x, 22, 1, 18, P.woodD);
      r(40, 5, 12, 9, P.metalD);
      r(41, 6, 10, 6, P.screen);
      r(45, 14, 2, 2, P.metalD);
      r(8, 11, 6, 5, P.pot);
      r(7, 6, 8, 5, P.green);
    },
  },
  cooler: {
    fw: 1, fh: 1, w: 16, h: 34,
    draw(r) {
      r(3, 15, 10, 17, P.white);
      r(4, 4, 8, 11, P.water);
      r(5, 5, 2, 8, "#9bd3f8");
      r(6, 2, 4, 2, P.water);
      r(6, 20, 4, 2, "#4a8fd0");
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
      if (kind === "wood") {
        g.fillRect(px, py + 7, T, 1);
        g.fillRect(px, py + 15, T, 1);
        g.fillRect(px + (hash(x, y) % 12) + 2, py + ((x + y) % 2 ? 0 : 8), 1, 7);
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
