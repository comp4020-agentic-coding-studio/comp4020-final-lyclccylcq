// Whether a meal fits a restaurant's opening hours (docs/ai.md). Pure: it
// works on the periods Google returned and never invents an hour.
//
// A meal fits only if the restaurant is open for the whole meal plus a buffer
// before closing (30 min by default), inside one opening period (so a midday
// break or a gap between periods ends it). Periods that cross midnight run on
// into the next day. Kitchen hours, when Google gives them, stand in for last
// orders and must cover the meal's start; Wayline never makes up a last-order
// time.
//
// Which hours apply to a date:
//   "dated":   Google's current hours carry this exact date (it covers about
//              the next 7 days, special days included). Confirmed.
//   "regular": only the usual weekly hours: probably right, not guaranteed for
//              that date (holidays, changes). Shown as unverified.
//   "unknown": Google gave no hours. Never treated as open or closed.

export type GPoint = { day: number; hour: number; minute?: number; date?: { year: number; month: number; day: number } };
export type GPeriod = { open: GPoint; close?: GPoint };
export type GHours = {
  regular: GPeriod[] | null;
  current: GPeriod[] | null; // dated, about the next 7 days
  kitchen: GPeriod[] | null; // secondary hours of type KITCHEN, if any
  specialDates: string[]; // dates Google flags as special (holidays)
};

export const CLOSING_BUFFER_MIN = 30;
export const MEAL_DURATION_MIN: Record<string, number> = { breakfast: 45, brunch: 60, lunch: 60, afternoon_tea: 45, dinner: 75 };

export type Interval = { from: number; to: number }; // minutes from the date's midnight; `to` may pass 1440
export type DayHours = { basis: "dated" | "regular" | "unknown"; open: Interval[]; kitchen: Interval[] | null; special: boolean };
export type Fit =
  | { ok: true; basis: DayHours["basis"]; closesAt: number | null; latestStart: number | null }
  | { ok: false; basis: DayHours["basis"]; reason: "closed" | "too_late" | "kitchen" | "break"; closesAt: number | null; latestStart: number | null; message: string };

const pad = (n: number) => String(n).padStart(2, "0");
export const clock = (min: number): string => `${pad(Math.floor(((min % 1440) + 1440) % 1440 / 60))}:${pad(((min % 1440) + 1440) % 1440 % 60)}`;
const minOf = (p: GPoint) => p.hour * 60 + (p.minute ?? 0);
const dateKey = (d: { year: number; month: number; day: number }) => `${d.year}-${pad(d.month)}-${pad(d.day)}`;
const weekday = (date: string) => new Date(`${date}T00:00:00Z`).getUTCDay(); // 0 = Sunday, as Google uses

// The intervals a list of weekly periods gives on one weekday, as minutes from
// that day's midnight. A period opening the day before and closing today
// contributes its after-midnight part; one closing tomorrow runs past 1440.
function weeklyIntervals(periods: GPeriod[], day: number): Interval[] {
  const out: Interval[] = [];
  for (const p of periods) {
    if (!p.close) {
      // Google's "always open": one period, Sunday 00:00, no close
      out.push({ from: 0, to: 2 * 1440 });
      continue;
    }
    const span = (((p.close.day - p.open.day + 7) % 7) * 1440) + minOf(p.close) - minOf(p.open);
    const length = span <= 0 ? span + 7 * 1440 : span;
    const start = (((p.open.day - day + 7) % 7) * 1440) + minOf(p.open); // from today's midnight, forward
    for (const s of [start, start - 7 * 1440]) {
      const e = s + length;
      if (e > 0 && s < 1440) out.push({ from: s, to: e });
    }
  }
  return merge(out);
}

// Dated periods for one date (and the previous date's overnight ones).
function datedIntervals(periods: GPeriod[], date: string): Interval[] | null {
  const ms = Date.parse(`${date}T00:00:00Z`);
  const prev = new Date(ms - 86_400_000).toISOString().slice(0, 10);
  const covers = periods.some((p) => p.open.date && dateKey(p.open.date) === date) || periods.some((p) => p.open.date && dateKey(p.open.date) === prev && p.close && p.close.date && dateKey(p.close.date) === date);
  const dates = periods.filter((p) => p.open.date).map((p) => dateKey(p.open.date!)).sort();
  // the date is inside the window Google answered for, even if closed all day
  const inWindow = dates.length > 0 && date >= dates[0] && date <= dates[dates.length - 1];
  if (!covers && !inWindow) return null;
  const out: Interval[] = [];
  for (const p of periods) {
    if (!p.open.date) continue;
    const openDate = dateKey(p.open.date);
    const closeDate = p.close?.date ? dateKey(p.close.date) : openDate;
    const offOpen = (Date.parse(`${openDate}T00:00:00Z`) - ms) / 60_000;
    const offClose = (Date.parse(`${closeDate}T00:00:00Z`) - ms) / 60_000;
    const from = offOpen + minOf(p.open);
    // Google marks "open until midnight" as 23:59 on the same date
    const to = p.close ? offClose + (minOf(p.close) === 23 * 60 + 59 ? 1440 : minOf(p.close)) : from + 1440;
    if (to > 0 && from < 1440) out.push({ from, to });
  }
  return merge(out);
}

// Back-to-back periods (open until midnight, open again at midnight) join up.
function merge(xs: Interval[]): Interval[] {
  const s = [...xs].sort((a, b) => a.from - b.from);
  const out: Interval[] = [];
  for (const x of s) {
    const last = out.at(-1);
    if (last && x.from <= last.to) last.to = Math.max(last.to, x.to);
    else out.push({ ...x });
  }
  return out;
}

export function hoursOn(h: GHours | null, date: string): DayHours {
  if (!h || (!h.regular?.length && !h.current?.length)) return { basis: "unknown", open: [], kitchen: null, special: false };
  const special = h.specialDates.includes(date);
  const dated = h.current?.length ? datedIntervals(h.current, date) : null;
  if (dated) return { basis: "dated", open: dated, kitchen: h.kitchen?.length ? weeklyIntervals(h.kitchen, weekday(date)) : null, special };
  if (h.regular?.length) return { basis: "regular", open: weeklyIntervals(h.regular, weekday(date)), kitchen: h.kitchen?.length ? weeklyIntervals(h.kitchen, weekday(date)) : null, special };
  return { basis: "unknown", open: [], kitchen: null, special };
}

// Whether a meal from `start` lasting `duration` fits, with `buffer` before
// closing. Unknown hours always "fit" with basis "unknown": the caller says so.
export function mealFits(day: DayHours, start: number, duration: number, buffer = CLOSING_BUFFER_MIN): Fit {
  if (day.basis === "unknown") return { ok: true, basis: "unknown", closesAt: null, latestStart: null };
  const end = start + duration;
  const period = day.open.find((x) => x.from <= start && start < x.to);
  if (!period) {
    const later = day.open.find((x) => x.from > start);
    const earlier = [...day.open].reverse().find((x) => x.to <= start);
    const between = later && earlier;
    return {
      ok: false,
      basis: day.basis,
      reason: between ? "break" : "closed",
      closesAt: null,
      latestStart: null,
      message: between
        ? `It's closed between ${clock(earlier.to)} and ${clock(later.from)}.`
        : later
          ? `It opens at ${clock(later.from)}.`
          : "It's closed then.",
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

// The best start in [earliest, latest] for a meal that fits, nearest `usual`
// (5-minute steps), or null if none does. Unknown hours: nearest `usual`.
export function bestStart(day: DayHours, earliest: number, latest: number, duration: number, usual: number, buffer = CLOSING_BUFFER_MIN): number | null {
  if (latest < earliest) return null;
  const step = 5;
  const lo = Math.ceil(earliest / step) * step;
  const hi = Math.floor(latest / step) * step;
  let best: number | null = null;
  for (let t = lo; t <= hi; t += step) {
    if (!mealFits(day, t, duration, buffer).ok) continue;
    if (best === null || Math.abs(t - usual) < Math.abs(best - usual)) best = t;
  }
  return best;
}

// Google's opening hours fields, as Wayline keeps them.
export function hoursFromGoogle(data: { regularOpeningHours?: { periods?: GPeriod[] }; currentOpeningHours?: { periods?: GPeriod[]; specialDays?: { date?: { year: number; month: number; day: number } }[] }; regularSecondaryOpeningHours?: { secondaryHoursType?: string; periods?: GPeriod[] }[] }): GHours | null {
  const regular = data.regularOpeningHours?.periods ?? null;
  const current = data.currentOpeningHours?.periods ?? null;
  if (!regular?.length && !current?.length) return null;
  const kitchen = (data.regularSecondaryOpeningHours ?? []).find((x) => x.secondaryHoursType === "KITCHEN")?.periods ?? null;
  const specialDates = (data.currentOpeningHours?.specialDays ?? []).flatMap((s) => (s.date ? [dateKey(s.date)] : []));
  return { regular, current, kitchen, specialDates };
}
