// Small shared helpers. h() builds DOM nodes; text always goes in as text
// nodes, never as HTML, so user-written titles and notes can't inject markup.

export function h(tag, props = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props ?? {})) {
    if (v === undefined || v === null || v === false) continue;
    if (k === "class") el.className = v;
    else if (k === "dataset") Object.assign(el.dataset, v);
    else if (k === "style") el.setAttribute("style", v);
    else if (k.startsWith("on") && typeof v === "function") el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k in el && typeof v !== "string") el[k] = v;
    else el.setAttribute(k, v === true ? "" : String(v));
  }
  append(el, children);
  return el;
}

function append(el, children) {
  for (const c of children.flat(Infinity)) {
    if (c === null || c === undefined || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
}

export function svg(markup) {
  const t = document.createElement("template");
  t.innerHTML = markup.trim(); // only ever called with static icon strings
  return t.content.firstChild;
}

export const ICONS = {
  up: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5l-7 7h4.5v7h5v-7H19z" fill="currentColor"/></svg>',
  down: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 19l7-7h-4.5V5h-5v7H5z" fill="currentColor"/></svg>',
  edit: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 17.3V20h2.7l8-8-2.7-2.7-8 8zM18.7 8a1 1 0 000-1.4l-1.3-1.3a1 1 0 00-1.4 0l-1.2 1.2 2.7 2.7L18.7 8z" fill="currentColor"/></svg>',
  trash: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 7h10l-1 13H8L7 7zm3-3h4l1 2h4v1.5H5V6h4l1-2z" fill="currentColor"/></svg>',
  grip: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="9" cy="6" r="1.6"/><circle cx="15" cy="6" r="1.6"/><circle cx="9" cy="12" r="1.6"/><circle cx="15" cy="12" r="1.6"/><circle cx="9" cy="18" r="1.6"/><circle cx="15" cy="18" r="1.6"/></svg>',
  search: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6" fill="none" stroke="currentColor" stroke-width="2.2"/><path d="M15 15l5 5" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/></svg>',
  close: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/></svg>',
  spark: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2l1.8 6.2L20 10l-6.2 1.8L12 18l-1.8-6.2L4 10l6.2-1.8z" fill="currentColor"/></svg>',
  walk: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="13" cy="4.5" r="2" fill="currentColor"/><path d="M10 21l2-6 2.5 2.5V21M9 11l2-3 3 1 2 3M11 8l-1.5 6" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  transit: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="5" y="3" width="14" height="14" rx="3" fill="none" stroke="currentColor" stroke-width="2"/><path d="M5 11h14M8 20l2-3M16 20l-2-3" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><circle cx="9" cy="14" r="1" fill="currentColor"/><circle cx="15" cy="14" r="1" fill="currentColor"/></svg>',
  drive: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 16V12l2-5h10l2 5v4M5 16h14M5 16v2M19 16v2M4 12h16" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"/><circle cx="8" cy="14" r="1" fill="currentColor"/><circle cx="16" cy="14" r="1" fill="currentColor"/></svg>',
  share: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="9" cy="8" r="3" fill="none" stroke="currentColor" stroke-width="2"/><path d="M3.5 19c.8-3 3-4.5 5.5-4.5s4.7 1.5 5.5 4.5M17 8v6M14 11h6" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round"/></svg>',
  back: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 5l-7 7 7 7" stroke="currentColor" stroke-width="2.2" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  food: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 3v8M5 3v5a2 2 0 004 0V3M7 11v10M16 3c-2 1.5-2.5 4-2.5 7H17V3zM17 10v11" stroke="currentColor" stroke-width="1.8" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  leaf: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 19c0-8 5-13 14-14-1 9-6 14-14 14zM5 19l7-7" stroke="currentColor" stroke-width="1.8" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  city: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 21h18M5 21V9l5-3v15M10 21V4l6 3v14M16 21v-9l3 1.5V21" stroke="currentColor" stroke-width="1.8" fill="none" stroke-linejoin="round"/></svg>',
  pin: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 21s-6-5.6-6-11a6 6 0 0112 0c0 5.4-6 11-6 11z" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="12" cy="10" r="2.2" fill="currentColor"/></svg>',
  locate: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="6" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="12" cy="12" r="2" fill="currentColor"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
  plus: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/></svg>',
  settings: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h10M18 7h2M4 17h4M12 17h8" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><circle cx="16" cy="7" r="2" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="10" cy="17" r="2" fill="none" stroke="currentColor" stroke-width="2"/></svg>',
};
export const icon = (name) => svg(ICONS[name]);

export class ApiError extends Error {
  constructor(status, data) {
    super(data?.error ?? `Request failed (${status})`);
    this.status = status;
    this.data = data ?? {};
  }
}

export async function api(path, { method = "GET", body } = {}) {
  let res;
  try {
    res = await fetch(path, {
      method,
      credentials: "same-origin",
      headers: body === undefined ? {} : { "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiError(0, { error: "You seem to be offline. Your change wasn't saved." });
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, data);
  return data;
}

export function toast(message, { kind = "info", action } = {}) {
  const box = document.getElementById("toasts");
  if (!box) return;
  const el = h("div", { class: `toast toast-${kind}` }, h("span", {}, message));
  if (action) el.append(h("button", { class: "toast-action", type: "button", onclick: () => { action.run(); el.remove(); } }, action.label));
  box.append(el);
  setTimeout(() => el.classList.add("toast-out"), 4200);
  setTimeout(() => el.remove(), 4700);
}

export const uid = () =>
  globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;

const utcDate = (iso) => new Date(`${iso}T00:00:00Z`);

export function fmtDay(iso, opts = { weekday: "short", day: "numeric", month: "short" }) {
  return new Intl.DateTimeFormat("en-AU", { ...opts, timeZone: "UTC" }).format(utcDate(iso));
}

export function fmtRange(start, end) {
  const a = utcDate(start);
  const b = utcDate(end);
  const month = (d) => new Intl.DateTimeFormat("en-AU", { month: "long", timeZone: "UTC" }).format(d);
  const sameYear = a.getUTCFullYear() === b.getUTCFullYear();
  if (start === end) return `${a.getUTCDate()} ${month(a)} ${a.getUTCFullYear()}`;
  if (sameYear && a.getUTCMonth() === b.getUTCMonth()) return `${month(a)} ${a.getUTCDate()}–${b.getUTCDate()}`;
  if (sameYear) return `${a.getUTCDate()} ${month(a)} – ${b.getUTCDate()} ${month(b)}`;
  return `${a.getUTCDate()} ${month(a)} ${a.getUTCFullYear()} – ${b.getUTCDate()} ${month(b)} ${b.getUTCFullYear()}`;
}

export function relTime(ms) {
  const s = Math.round((Date.now() - ms) / 1000);
  if (s < 45) return "just now";
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const hr = Math.round(m / 60);
  if (hr < 24) return `${hr} h ago`;
  const d = Math.round(hr / 24);
  return d < 30 ? `${d} day${d === 1 ? "" : "s"} ago` : new Date(ms).toLocaleDateString("en-AU");
}

export const hhmm = (min) => {
  const m = ((min % 1440) + 1440) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
};
export const parseTime = (s) => {
  const m = /^(\d{1,2}):(\d{2})$/.exec(s ?? "");
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
};
export const dur = (min) => {
  const hr = Math.floor(min / 60);
  const m = min % 60;
  return hr && m ? `${hr}h ${m}m` : hr ? `${hr}h` : `${m} min`;
};

export const initials = (name) =>
  name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join("") || "?";

// A stable colour per person, so the same collaborator looks the same everywhere.
const PEOPLE = ["#F2603D", "#0F7C8C", "#7A5AF8", "#D99A00", "#3E9B6B", "#C2417A"];
export const personColour = (id) => PEOPLE[[...id].reduce((s, c) => s + c.charCodeAt(0), 0) % PEOPLE.length];

export function avatar(person, size = "md") {
  return h("span", { class: `avatar avatar-${size}`, style: `--c:${personColour(person.id)}`, title: person.displayName }, initials(person.displayName));
}

export function openDialog(dialog) {
  document.body.append(dialog);
  dialog.addEventListener("close", () => dialog.remove());
  dialog.showModal();
  return dialog;
}

export const KIND_LABEL = {
  attraction: "Attraction",
  food: "Food",
  shopping: "Shopping",
  accommodation: "Stay",
  custom: "Custom",
};
export const KIND_DURATION = { attraction: 120, food: 60, shopping: 60, accommodation: 30, custom: 60 };

export function guessKind(types = []) {
  const t = new Set(types);
  if (["restaurant", "cafe", "bar", "bakery", "food", "meal_takeaway", "coffee_shop"].some((x) => t.has(x) || [...t].some((y) => y.endsWith("_restaurant")))) return "food";
  if (["shopping_mall", "store", "market", "clothing_store", "department_store", "book_store"].some((x) => t.has(x))) return "shopping";
  if (["lodging", "hotel", "hostel", "motel", "resort_hotel"].some((x) => t.has(x))) return "accommodation";
  return "attraction";
}

// Google's encoded polyline format (the Routes API's route geometry).
export function decodePolyline(str) {
  const out = [];
  let i = 0;
  let lat = 0;
  let lng = 0;
  const next = () => {
    let result = 0;
    let shift = 0;
    let b;
    do {
      b = str.charCodeAt(i++) - 63;
      result |= (b & 0x1f) << shift;
      shift += 5;
    } while (b >= 0x20 && i <= str.length);
    return result & 1 ? ~(result >> 1) : result >> 1;
  };
  while (i < str.length) {
    lat += next();
    lng += next();
    out.push({ lat: lat / 1e5, lng: lng / 1e5 });
  }
  return out;
}

export const km = (n) => (n < 1 ? `${Math.round(n * 1000)} m` : `${n < 10 ? n.toFixed(1) : Math.round(n)} km`);
