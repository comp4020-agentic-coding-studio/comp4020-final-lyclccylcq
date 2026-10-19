// The browser's copy of the opening-hours check in src/hours.ts, for warnings
// while someone edits a time. The server checks again when anything is saved;
// spec/hours.test.ts runs both on the same cases so they can't drift apart.

export const CLOSING_BUFFER_MIN = 30;
export const MEAL_DURATION_MIN = { breakfast: 45, brunch: 60, lunch: 60, afternoon_tea: 45, dinner: 75 };

const pad = (n) => String(n).padStart(2, "0");
export const clock = (min) => `${pad(Math.floor((((min % 1440) + 1440) % 1440) / 60))}:${pad((((min % 1440) + 1440) % 1440) % 60)}`;
const minOf = (p) => p.hour * 60 + (p.minute ?? 0);
const dateKey = (d) => `${d.year}-${pad(d.month)}-${pad(d.day)}`;
const weekday = (date) => new Date(`${date}T00:00:00Z`).getUTCDay();

function merge(xs) {
  const s = [...xs].sort((a, b) => a.from - b.from);
  const out = [];
  for (const x of s) {
    const last = out.at(-1);
    if (last && x.from <= last.to) last.to = Math.max(last.to, x.to);
    else out.push({ ...x });
  }
  return out;
}

function weeklyIntervals(periods, day) {
  const out = [];
  for (const p of periods) {
    if (!p.close) {
      out.push({ from: 0, to: 2 * 1440 });
      continue;
    }
    const span = ((p.close.day - p.open.day + 7) % 7) * 1440 + minOf(p.close) - minOf(p.open);
    const length = span <= 0 ? span + 7 * 1440 : span;
    const start = ((p.open.day - day + 7) % 7) * 1440 + minOf(p.open);
    for (const s of [start, start - 7 * 1440]) {
      const e = s + length;
      if (e > 0 && s < 1440) out.push({ from: s, to: e });
    }
  }
  return merge(out);
}

function datedIntervals(periods, date) {
  const ms = Date.parse(`${date}T00:00:00Z`);
  const prev = new Date(ms - 86_400_000).toISOString().slice(0, 10);
  const covers = periods.some((p) => p.open.date && dateKey(p.open.date) === date) || periods.some((p) => p.open.date && dateKey(p.open.date) === prev && p.close?.date && dateKey(p.close.date) === date);
  const dates = periods.filter((p) => p.open.date).map((p) => dateKey(p.open.date)).sort();
  const inWindow = dates.length > 0 && date >= dates[0] && date <= dates[dates.length - 1];
  if (!covers && !inWindow) return null;
  const out = [];
  for (const p of periods) {
    if (!p.open.date) continue;
    const openDate = dateKey(p.open.date);
    const closeDate = p.close?.date ? dateKey(p.close.date) : openDate;
    const from = (Date.parse(`${openDate}T00:00:00Z`) - ms) / 60_000 + minOf(p.open);
    const to = p.close ? (Date.parse(`${closeDate}T00:00:00Z`) - ms) / 60_000 + (minOf(p.close) === 23 * 60 + 59 ? 1440 : minOf(p.close)) : from + 1440;
    if (to > 0 && from < 1440) out.push({ from, to });
  }
  return merge(out);
}

export function hoursOn(h, date) {
  if (!h || (!h.regular?.length && !h.current?.length)) return { basis: "unknown", open: [], kitchen: null, special: false };
  const special = (h.specialDates ?? []).includes(date);
  const kitchen = h.kitchen?.length ? weeklyIntervals(h.kitchen, weekday(date)) : null;
  const dated = h.current?.length ? datedIntervals(h.current, date) : null;
  if (dated) return { basis: "dated", open: dated, kitchen, special };
  if (h.regular?.length) return { basis: "regular", open: weeklyIntervals(h.regular, weekday(date)), kitchen, special };
  return { basis: "unknown", open: [], kitchen: null, special };
}

export function mealFits(day, start, duration, buffer = CLOSING_BUFFER_MIN) {
  if (day.basis === "unknown") return { ok: true, basis: "unknown", closesAt: null, latestStart: null };
  const end = start + duration;
  const period = day.open.find((x) => x.from <= start && start < x.to);
  if (!period) {
    const later = day.open.find((x) => x.from > start);
    const earlier = [...day.open].reverse().find((x) => x.to <= start);
    return {
      ok: false,
      basis: day.basis,
      reason: later && earlier ? "break" : "closed",
      closesAt: null,
      latestStart: null,
      message: later && earlier ? `It's closed between ${clock(earlier.to)} and ${clock(later.from)}.` : later ? `It opens at ${clock(later.from)}.` : "It's closed then.",
    };
  }
  const latestStart = period.to - buffer - duration;
  if (end + buffer > period.to) {
    return {
      ok: false,
      basis: day.basis,
      reason: "too_late",
      closesAt: period.to,
      latestStart: latestStart >= period.from ? latestStart : null,
      message: `It closes at ${clock(period.to)}. A ${duration}-minute meal from ${clock(start)} would finish ${end + buffer - period.to > buffer ? "after closing" : `less than ${buffer} minutes before closing`}.`,
    };
  }
  if (day.kitchen && !day.kitchen.some((k) => k.from <= start && start < k.to)) {
    return { ok: false, basis: day.basis, reason: "kitchen", closesAt: period.to, latestStart, message: "Google lists the kitchen as closed at that time." };
  }
  return { ok: true, basis: day.basis, closesAt: period.to, latestStart };
}
