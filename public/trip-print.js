import { coverImg, photoFor } from "/photos.js";
import { api, dur, fmtDay, fmtRange, h, hhmm, icon, KIND_LABEL, toast } from "/ui.js";

// A trip as a document to keep, in three forms, with nothing published:
//   /trips/:id/print   for its members: completes the routes, then offers
//                      PDF (the browser's print dialog), an image (PNG,
//                      drawn here on a canvas) and a read-only link
//   /export/<token>    the read-only link: the same document, read from
//                      GET /api/exports/<token>, as the trip stands now;
//                      PDF and image, and nothing that changes the trip
// The plan day by day, each stop's time, length and notes, and the travel
// between stops from Google's routes (duration, distance, lines). Pressing
// Export is the request to look routes up: every leg without a current
// route is calculated before the document is shown (POST …/routes/all).
// Legs Google can't route (demo places, a failed lookup) say so; no travel
// time is ever made up.

const MEAL_LABEL = { breakfast: "Breakfast", brunch: "Brunch", lunch: "Lunch", afternoon_tea: "Afternoon tea", dinner: "Dinner" };
const MODE_WORD = { WALK: "Walk", TRANSIT: "Public transport", DRIVE: "Drive" };

export async function renderTripPrint(app, tripId, ctx) {
  app.replaceChildren(h("main", { class: "tp" }, h("div", { class: "boot", role: "status" }, "Preparing your trip…")));
  let t = await api(`/api/trips/${tripId}`); // a 404 for non-members, handled by the router
  let routes = null;
  if (ctx.config.routes) {
    fill(h("div", { class: "boot", role: "status", "data-export-routes": "running" }, "Calculating every route between your stops…"));
    try {
      const r = await api(`/api/trips/${tripId}/routes/all`, { method: "POST", body: {} });
      t = r.trip;
      routes = r;
    } catch (err) {
      routes = { error: err.message };
    }
  }
  let link = (await api(`/api/trips/${tripId}/export-link`).catch(() => ({ link: null }))).link;
  let token = null; // only known right after it's made: the server keeps a hash
  const linkPanel = h("section", { class: "tp-share", "aria-label": "Read-only link" });

  function renderLink() {
    const url = token && `${location.origin}/export/${token}`;
    linkPanel.replaceChildren(
      h("h2", {}, "Read-only link"),
      h("p", { class: "small muted" }, "Anyone with the link sees this trip as it stands, notes included, and can save it as a PDF or image. Nobody can change anything through it. It isn't a publication and isn't listed anywhere."),
      url
        ? h("div", { class: "tp-link" }, h("input", { readonly: true, value: url, "aria-label": "Read-only link", onfocus: (e) => e.target.select() }), h("button", { class: "btn btn-ghost btn-sm", type: "button", "data-export-link": "copy", onclick: () => copy(url) }, "Copy"))
        : link && h("p", { class: "small" }, `A link was made ${new Date(link.createdAt).toLocaleDateString("en-AU", { day: "numeric", month: "short" })}. It's shown only once; make a new one to copy it again (the old one stops working).`),
      h(
        "div",
        { class: "tp-link-actions" },
        h("button", { class: "btn btn-ghost btn-sm", type: "button", "data-export-link": "make", onclick: makeLink }, link ? "Make a new link" : "Make a read-only link"),
        link && h("button", { class: "btn btn-quiet btn-sm btn-danger-text", type: "button", "data-export-link": "revoke", onclick: revoke }, "Stop sharing"),
      ),
    );
  }
  async function makeLink() {
    try {
      const r = await api(`/api/trips/${tripId}/export-link`, { method: "POST", body: {} });
      token = r.token;
      link = { createdAt: r.createdAt };
      renderLink();
      copy(`${location.origin}/export/${token}`);
    } catch (err) {
      toast(err.message);
    }
  }
  async function revoke() {
    try {
      await api(`/api/trips/${tripId}/export-link`, { method: "DELETE", body: {} });
      link = null;
      token = null;
      renderLink();
      toast("Link switched off. It no longer opens the trip.");
    } catch (err) {
      toast(err.message);
    }
  }
  renderLink();

  const doc = tripDocument(t, { routes, routing: ctx.config.routes });
  fill(
    h(
      "div",
      { class: "tp-bar" },
      h("a", { class: "btn btn-quiet btn-sm", href: `/trips/${t.id}`, "data-link": true }, icon("back"), "Back to the trip"),
      exportButtons(doc, t),
    ),
    linkPanel,
    doc,
  );

  function fill(...kids) {
    app.replaceChildren(h("main", { class: "tp" }, ...kids));
  }
  return () => {};
}

// The read-only link: no account needed, nothing to change
export async function renderTripExport(app, token) {
  app.replaceChildren(h("main", { class: "tp" }, h("div", { class: "boot", role: "status" }, "Opening the trip…")));
  let t;
  try {
    t = await api(`/api/exports/${encodeURIComponent(token)}`);
  } catch {
    app.replaceChildren(
      h("main", { class: "tp" }, h("div", { class: "invite-card" }, h("h1", {}, "This link isn't available"), h("p", {}, "It may have been switched off by someone on the trip, or the address is incomplete."), h("a", { class: "btn btn-primary", href: "/", "data-link": true }, "Explore Wayline"))),
    );
    return () => {};
  }
  const doc = tripDocument(t, { routes: null, routing: t.routing, shared: true });
  app.replaceChildren(
    h(
      "main",
      { class: "tp tp-shared" },
      h("div", { class: "tp-bar" }, h("a", { class: "btn btn-quiet btn-sm", href: "/", "data-link": true }, "Wayline"), h("p", { class: "small muted" }, "A read-only copy of a trip, as it stands now."), exportButtons(doc, t)),
      doc,
    ),
  );
  return () => {};
}

function exportButtons(doc, t) {
  return h(
    "div",
    { class: "tp-actions" },
    h("button", { class: "btn btn-ghost btn-sm", type: "button", "data-export": "image", onclick: (e) => saveImage(doc, t, e.currentTarget) }, "Save as image"),
    h("button", { class: "btn btn-primary btn-sm", type: "button", "data-print": "go", title: "Choose “Save as PDF” as the printer", onclick: () => print() }, "Save as PDF / print"),
  );
}

function tripDocument(t, { routes, routing, shared = false }) {
  const cover = photoFor(t.cover ?? null);
  const nDays = t.days.length;
  const printed = new Date().toLocaleString("en-AU", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });

  const travel = (d, a, b) => {
    const seg = d.segments.find((s) => s.fromId === a.id && s.toId === b.id);
    const o = seg?.options.find((x) => x.mode === seg.selectedMode);
    if (!o || o.status !== "ok") {
      const why = !a.place || !b.place || a.place.source === "demo" || b.place.source === "demo" ? "No route: demo places can't be routed" : !routing ? "No route: Google Maps isn't set up here" : seg ? "No route from Google for this leg" : "Route not calculated";
      return h("li", { class: "tp-leg tp-leg-none" }, why);
    }
    const transit = (o.steps ?? []).filter((s) => s.kind === "transit");
    return h(
      "li",
      { class: "tp-leg" },
      `${MODE_WORD[o.mode]} · ${dur(Math.max(1, Math.ceil(o.durationSec / 60)))} · ${(o.distanceM / 1000).toFixed(1)} km`,
      o.mode === "TRANSIT" && transit.length ? ` · ${transit.map((s) => [s.vehicle, s.line].filter(Boolean).join(" ")).filter(Boolean).join(", ")}` : "",
      o.assumedDeparture && h("span", { class: "tp-stale" }, ` (transit looked up for ${o.assumedDeparture})`),
      seg.stale && h("span", { class: "tp-stale" }, " (times changed since; look it up again)"),
    );
  };

  const summary =
    routes &&
    (routes.error
      ? h("p", { class: "tp-note", role: "status" }, `Routes couldn't be calculated: ${routes.error}`)
      : routes.failed
        ? h("p", { class: "tp-note", role: "status" }, `${routes.failed} ${routes.failed === 1 ? "route" : "routes"} couldn't be looked up; they're marked below.`)
        : null);

  return h(
    "article",
    { class: "tp-doc" },
    h(
      "header",
      { class: "tp-head" },
      cover && h("div", { class: "tp-cover" }, coverImg(cover, { eager: true, decorative: true })),
      h("p", { class: "tp-kicker" }, t.destination),
      h("h1", { class: "tp-title" }, t.title),
      h("p", { class: "tp-sub" }, `${fmtRange(t.startDate, t.endDate)} · ${nDays} ${nDays === 1 ? "day" : "days"} · ${t.members.map((m) => m.displayName).join(", ")}`),
    ),
    summary,
    t.days.map((d, i) =>
      h(
        "section",
        { class: "tp-day" },
        h("h2", { class: "tp-day-h" }, h("span", { class: "tp-day-n" }, `Day ${i + 1}`), fmtDay(d.date, { weekday: "long", day: "numeric", month: "long" })),
        d.activities.length
          ? h(
              "ol",
              { class: "tp-stops" },
              d.activities.flatMap((a, k) => {
                const next = d.activities[k + 1];
                const what = a.role === "start" ? "Starting point" : a.meal ? MEAL_LABEL[a.meal] : KIND_LABEL[a.kind];
                const end = a.startMin !== null && a.role !== "start" ? a.startMin + a.durationMin : null;
                return [
                  h(
                    "li",
                    { class: "tp-stop" },
                    h("span", { class: "tp-time" }, a.startMin !== null ? hhmm(a.startMin) : "", end !== null && h("small", {}, `–${hhmm(end)}`)),
                    h(
                      "div",
                      {},
                      h("h3", {}, a.title),
                      h("p", { class: "tp-meta" }, [what, a.role !== "start" && a.durationMin ? dur(a.durationMin) : null, a.place?.source === "demo" && "Demo place", a.place?.source === "custom" && "Pinned spot"].filter(Boolean).join(" · ")),
                      a.notes && h("p", { class: "tp-notes" }, a.notes),
                    ),
                  ),
                  next && travel(d, a, next),
                ].filter(Boolean);
              }),
            )
          : h("p", { class: "tp-empty" }, "Nothing planned yet."),
      ),
    ),
    h("p", { class: "tp-foot" }, `Planned on Wayline · ${shared ? "read-only copy" : "exported"} ${printed}. Travel times come from Google Maps routes for the times in the plan; arrival times aren't guaranteed.`),
  );
}

async function copy(url) {
  try {
    await navigator.clipboard.writeText(url);
    toast("Link copied. It opens a read-only copy; nobody can edit through it.");
  } catch {
    // the field shows it, selected on focus
  }
}

// --- the image: the document drawn onto a canvas, line by line ---
// Drawn from the page as laid out (each text element's box and computed
// font), so the PNG matches what's on screen without any library. The
// cover photo is same-origin, so the canvas stays exportable.

async function saveImage(doc, t, button) {
  button.disabled = true;
  const label = button.textContent;
  button.textContent = "Making the image…";
  try {
    await document.fonts.ready;
    const blob = await drawDocument(doc);
    const a = h("a", { href: URL.createObjectURL(blob), download: `${slug(t.title)}.png` });
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
    toast("Image saved.");
  } catch {
    toast("The image couldn't be made in this browser. Try Save as PDF instead.");
  } finally {
    button.disabled = false;
    button.textContent = label;
  }
}

const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60) || "trip";

async function drawDocument(doc) {
  const box = doc.getBoundingClientRect();
  const scale = Math.min(2, window.devicePixelRatio || 1) || 1;
  const width = Math.ceil(box.width);
  const height = Math.ceil(doc.scrollHeight);
  const canvas = document.createElement("canvas");
  canvas.width = Math.ceil(width * scale);
  canvas.height = Math.ceil(height * scale);
  const g = canvas.getContext("2d");
  g.scale(scale, scale);
  g.fillStyle = "#fff";
  g.fillRect(0, 0, width, height);
  const at = (r) => ({ x: r.left - box.left, y: r.top - box.top });

  // the cover photo
  const img = doc.querySelector(".tp-cover img");
  if (img && img.complete && img.naturalWidth) {
    const r = img.parentElement.getBoundingClientRect();
    const { x, y } = at(r);
    const k = Math.max(r.width / img.naturalWidth, r.height / img.naturalHeight);
    const sw = r.width / k;
    const sh = r.height / k;
    g.save();
    roundRect(g, x, y, r.width, r.height, 6);
    g.clip();
    g.drawImage(img, (img.naturalWidth - sw) / 2, (img.naturalHeight - sh) / 2, sw, sh, x, y, r.width, r.height);
    g.restore();
  }

  // rules and the notes' and legs' side lines, from their computed borders
  for (const el of doc.querySelectorAll(".tp-head, .tp-day-h, .tp-foot, .tp-notes, .tp-leg")) {
    const cs = getComputedStyle(el);
    const r = el.getBoundingClientRect();
    const { x, y } = at(r);
    for (const [side, x1, y1, x2, y2] of [
      ["Bottom", x, y + r.height, x + r.width, y + r.height],
      ["Top", x, y, x + r.width, y],
      ["Left", x, y, x, y + r.height],
    ]) {
      const w = parseFloat(cs[`border${side}Width`]);
      if (!w || cs[`border${side}Style`] === "none") continue;
      g.strokeStyle = cs[`border${side}Color`];
      g.lineWidth = w;
      g.setLineDash(cs[`border${side}Style`] === "dotted" ? [w, w * 1.5] : []);
      g.beginPath();
      g.moveTo(x1 + (side === "Left" ? w / 2 : 0), y1 + (side === "Bottom" ? -w / 2 : side === "Top" ? w / 2 : 0));
      g.lineTo(x2 + (side === "Left" ? w / 2 : 0), y2 + (side === "Bottom" ? -w / 2 : side === "Top" ? w / 2 : 0));
      g.stroke();
    }
  }
  g.setLineDash([]);

  // every line of text, where the browser put it
  const walker = document.createTreeWalker(doc, NodeFilter.SHOW_TEXT);
  const range = document.createRange();
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const text = n.textContent;
    if (!text.trim()) continue;
    const cs = getComputedStyle(n.parentElement);
    g.font = `${cs.fontStyle} ${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
    g.fillStyle = cs.color;
    g.textBaseline = "alphabetic";
    const upper = cs.textTransform === "uppercase";
    const spacing = parseFloat(cs.letterSpacing) || 0;
    if ("letterSpacing" in g) g.letterSpacing = `${spacing}px`;
    // split into the lines the browser wrapped it into
    let start = 0;
    let lineTop = null;
    let lineLeft = 0;
    let lineBottom = 0;
    const flush = (end) => {
      const s = text.slice(start, end).replace(/\s+$/, "");
      if (s && lineTop !== null) {
        const ascent = parseFloat(cs.fontSize) * 0.8;
        const lh = lineBottom - lineTop;
        g.fillText(upper ? s.toUpperCase() : s, lineLeft - box.left, lineTop - box.top + (lh - parseFloat(cs.fontSize)) / 2 + ascent);
      }
    };
    for (let i = 0; i < text.length; i++) {
      range.setStart(n, i);
      range.setEnd(n, i + 1);
      const rects = range.getClientRects();
      if (!rects.length) continue;
      const r = rects[0];
      if (lineTop === null) {
        lineTop = r.top;
        lineLeft = r.left;
        lineBottom = r.bottom;
        start = i;
      } else if (r.top >= lineBottom - 1) {
        flush(i);
        start = i;
        lineTop = r.top;
        lineLeft = r.left;
        lineBottom = r.bottom;
      }
    }
    flush(text.length);
  }
  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("no image"))), "image/png"));
}

function roundRect(g, x, y, w, hgt, r) {
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + hgt, r);
  g.arcTo(x + w, y + hgt, x, y + hgt, r);
  g.arcTo(x, y + hgt, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}
