"""Builds the homepage journey hero's images from freely
licensed Wikimedia Commons photos (see public/img/train/CREDITS.md).

    python3 scripts/train-photo/build.py SRC_DIR [step ...]

SRC_DIR holds the downloaded originals (names below). Outputs WebP into
public/img/train/. Needs Pillow and NumPy (build-time only; nothing
here runs in the app).
"""
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageFilter

SRC = Path(sys.argv[1])
OUT = Path(__file__).resolve().parents[2] / "public" / "img" / "train"
OUT.mkdir(parents=True, exist_ok=True)


def save(im: Image.Image, name: str, q=80):
    im.save(OUT / f"{name}.webp", "WEBP", quality=q, method=6)
    print(name, im.size, f"{(OUT / f'{name}.webp').stat().st_size // 1024} KB")


# --- the window frame: thin, mitred walnut ---------------------------------
# No carriage: the page is one big window, so all that's drawn is its frame.
# One long rail, its moulding profile baked in (outer bead, flat face, a
# groove, then an ogee falling to the glass, catching the daylight, and the
# dark glazing line against the glass). The page crops it to each rail's
# length (never stretched, never repeated) and mitres the corners.
#   frame-h  horizontal rail, glass side at the bottom (4000x48)
#   frame-v  vertical rail, glass side on the right (48x2600)
def wood(length: int, depth: int, seed: int) -> np.ndarray:
    """Walnut grain along x: long streaks (noise stretched along the
    grain), a slow figure across it, and fine pores."""
    rng = np.random.default_rng(seed)
    def streaks(n_along, n_across):
        a = rng.standard_normal((n_across, n_along)).astype(np.float32)
        return np.asarray(Image.fromarray(a, "F").resize((length, depth), Image.BICUBIC))
    g = 0.55 * streaks(length // 260, depth // 2) + 0.3 * streaks(length // 70, depth) + 0.15 * streaks(length // 18, depth)
    g = (g - g.mean()) / (g.std() + 1e-6)
    figure = np.sin(np.linspace(0, 7.3, length)[None, :] + 0.6 * streaks(12, 2)) * 0.35
    pores = rng.standard_normal((depth, length)).astype(np.float32) * 0.08
    v = np.clip(0.5 + 0.16 * g + 0.07 * figure + pores, 0, 1)
    dark, light = np.array([46, 25, 14], np.float32), np.array([132, 76, 42], np.float32)
    return dark + (light - dark) * v[..., None]


def profile(depth: int) -> np.ndarray:
    """Light across the rail's width, outside (0) to the glass (depth-1)."""
    t = np.linspace(0, 1, depth)
    k = np.interp(t, [0, .05, .1, .16, .2, .62, .66, .7, .78, .88, .92, .94, 1],
                     [.5, .8, 1.12, .92, .96, .92, .62, .9, 1.02, 1.22, 1.32, .42, .32])
    return k.astype(np.float32)


def frame():
    D = 48
    h = wood(4000, D, 7) * profile(D)[:, None, None]
    save(Image.fromarray(np.clip(h, 0, 255).astype(np.uint8)), "frame-h", 82)
    v = wood(2600, D, 11) * profile(D)[:, None, None]
    v = np.clip(v, 0, 255).astype(np.uint8)
    save(Image.fromarray(v).rotate(90, expand=True).transpose(Image.FLIP_LEFT_RIGHT), "frame-v", 82)


# --- landscapes ------------------------------------------------------------
# Each destination is ONE whole photo, resized and re-encoded, nothing cut
# out of it: the page pans it within its own edges (placePhoto in
# public/journey.js) instead of tiling it or splitting it into
# depth strips, which is what duplicated Shanghai's tower and tore Paris's
# bridge in the previous version. Sizes must match SCENES[].photo.
def landscape(name, src, width, crop=None, q=80, night=False, soften=0):
    Image.MAX_IMAGE_PIXELS = None  # Sydney's original is 14224 px wide
    im = Image.open(SRC / src).convert("RGB")
    if crop:
        im = im.crop(crop)
    h = round(im.height * width / im.width)
    im = im.resize((width, h), Image.LANCZOS)
    if soften:  # dense foliage: a sub-pixel blur halves the file, invisibly at display size
        im = im.filter(ImageFilter.GaussianBlur(soften))
    save(grade(im, night), name, q)


def grade(im: Image.Image, night=False) -> Image.Image:
    """One gentle grade for every scene, so five photographers' pictures
    read as one journey: levels halfway to a common black and white point,
    saturation nudged towards a common level, the same soft contrast curve
    and a slight warmth. Night keeps its own black point and colour."""
    a = np.asarray(im).astype(np.float32) / 255
    lum = a @ np.array([.2126, .7152, .0722], np.float32)
    lo, hi = np.percentile(lum, [0.5, 99.5])
    if not night:
        lo2, hi2 = lo * 0.5, hi + (0.97 - hi) * 0.5
        a = (a - lo) / max(hi - lo, 1e-3) * (hi2 - lo2) + lo2
    mean = a.mean(axis=2, keepdims=True)
    sat = float(np.abs(a - mean).mean())
    target = 0.075 if not night else sat
    a = mean + (a - mean) * float(np.clip(target / max(sat, 1e-3), 0.88, 1.12))
    a = np.clip(a, 0, 1)
    a = a + 0.06 * (a - a * a) * (2 * a - 1) * -1 + 0.04 * np.sin(np.pi * a) * (a - 0.5)  # soft S
    if not night:
        a = a * np.array([1.012, 1.0, 0.982], np.float32)
    return Image.fromarray((np.clip(a, 0, 1) * 255 + 0.5).astype(np.uint8))


def switzerland():
    # Brienzersee from Oberried: village, turquoise lake, snowy peaks
    landscape("switzerland", "swiss-full.jpg", 4400, q=70)


def london():
    # the Thames upstream from the Golden Jubilee footbridges, beside
    # Hungerford railway bridge (the view from a Charing Cross train): the
    # London Eye, Westminster and Big Ben, Whitehall Court
    landscape("london", "london.jpg", 4600, crop=(0, 280, 6000, 2420), q=62)


def sydney():
    # the harbour from Yurong Point (Royal Botanic Garden): the CBD, the
    # Opera House and the Harbour Bridge; the overhanging branches and the
    # bank in front cropped away
    landscape("sydney", "sydney-yurong.jpg", 5200, crop=(0, 844, 9956, 3272), q=66)


def maldives():
    # Thudufushi island from its jetty: palms, white sand, the lagoon; the
    # top of the sky cropped
    landscape("maldives", "maldives-thudufushi.jpg", 4000, crop=(0, 232, 5816, 2907), q=66)


def shanghai():
    # Pudong from the Bund at night: Pearl Tower, Jin Mao, SWFC, Shanghai Tower
    landscape("shanghai", "shanghai2.jpg", 3840, q=70, night=True)


# --- a near object that sweeps past the glass (motion-blurred) ------------
def passing():
    # a spruce from the Swiss photo, cut out by colour and blurred along the
    # direction of travel
    sw = Image.open(SRC / "swiss-full.jpg").convert("RGB")
    spr = sw.crop((5450, 520, 6150, 2385))
    a = np.asarray(spr).astype(np.float32)
    green = (a[..., 1] > a[..., 2] - 5) & (a.mean(axis=2) < 120)
    m = Image.fromarray((green * 255).astype(np.uint8)).filter(ImageFilter.MaxFilter(5)).filter(ImageFilter.GaussianBlur(3))
    fade = np.clip(np.minimum(np.arange(spr.width), spr.width - 1 - np.arange(spr.width)) / 120, 0, 1)
    m = Image.fromarray((np.asarray(m).astype(np.float32) * fade[None, :]).astype(np.uint8))
    s = Image.merge("RGBA", (*spr.split(), m)).resize((350, 932), Image.LANCZOS)
    s = motion_blur(s, 26)
    save(s, "pass-spruce", 75)


def motion_blur(im: Image.Image, n: int) -> Image.Image:
    a = np.asarray(im).astype(np.float32)
    rgb, al = a[..., :3] * a[..., 3:4] / 255, a[..., 3]
    pad = n
    rgb = np.pad(rgb, ((0, 0), (pad, pad), (0, 0)))
    al = np.pad(al, ((0, 0), (pad, pad)))
    k = np.ones(n) / n
    rgb = np.apply_along_axis(lambda r: np.convolve(r, k, "same"), 1, rgb)
    al = np.apply_along_axis(lambda r: np.convolve(r, k, "same"), 1, al)
    out = np.dstack([rgb * 255 / np.maximum(al[..., None], 1), al])
    return Image.fromarray(np.clip(out, 0, 255).astype(np.uint8), "RGBA")


steps = {"frame": frame, "switzerland": switzerland, "london": london, "sydney": sydney, "maldives": maldives, "shanghai": shanghai, "passing": passing}
for name in sys.argv[2:] or steps:
    steps[name]()
