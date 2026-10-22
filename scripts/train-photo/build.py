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


# The window's edge is drawn in CSS: no images for it.


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


steps = {"switzerland": switzerland, "london": london, "sydney": sydney, "maldives": maldives, "shanghai": shanghai}
for name in sys.argv[2:] or steps:
    steps[name]()
