import { hhmm, type Mode, travelMinutes } from "./schedule.ts";

// A day's practicality, beyond timing conflicts (src/schedule.ts finds
// those). Plain rules on the itinerary and on routes Google returned: no
// model call, so it runs on every snapshot. Each note is advice, never an
// error, and nothing here changes the plan.
//
// Meals: a meal is "covered" by a food stop or a stop marked with that meal
// whose time overlaps the meal's range in the trip's own meal times. An
// explicitly assigned meal counts only for that meal, so lunch at 12:40 never
// covers dinner. A food stop with no meal counts for the meal whose range
// holds its start. A meal is flagged where it would go: "between" stops when
// the timed part of the day spans most of its range; "before" setting out
// when the day starts inside the meal's range (lunch near the first stop, or
// the starting point, before leaving); "after" the last stop when the day
// ends in the meal's range or up to 90 minutes before it. One place per meal.

export type MealKey = "breakfast" | "brunch" | "lunch" | "afternoon_tea" | "dinner";
export type MealWindow = { from: number; to: number; usual: number };

export type ReviewStop = {
  id: string;
  title: string;
  kind: string;
  role: "start" | null;
  meal: string | null;
  startMin: number | null;
  durationMin: number;
  hasPlace: boolean;
};
export type ReviewSegment = { fromId: string; toId: string; selectedMode: Mode | null; options: { mode: Mode; status: string; durationSec?: number; message?: string }[] };

export type MealGap = { meal: MealKey; from: number; to: number; usual: number; afterId: string | null; beforeId: string | null; position: "before" | "between" | "after" };
export type Note = {
  id: string;
  kind: "missing_meal" | "long_walk" | "no_route" | "long_gap" | "overloaded" | "untimed";
  level: "ok" | "advice";
  text: string;
  stopIds: string[];
};
export type DayReview = {
  span: { from: number; to: number } | null;
  stops: number;
  meals: MealGap[];
  notes: Note[];
};

// meals people usually plan a stop for; brunch and afternoon tea only when chosen
const CORE: MealKey[] = ["lunch", "dinner"];
const LONG_WALK_MIN = 30;
const AFTER_LEAD_MIN = 90; // a day ending this long before a meal's range still gets "dinner after"
const MEAL_MIN: Record<MealKey, number> = { breakfast: 45, brunch: 60, lunch: 60, afternoon_tea: 45, dinner: 75 };
const LONG_GAP_MIN = 150;
const MAX_ACTIVE_MIN = 11 * 60; // planned visits beyond this, in one day, are a lot

const LABEL: Record<MealKey, string> = { breakfast: "Breakfast", brunch: "Brunch", lunch: "Lunch", afternoon_tea: "Afternoon tea", dinner: "Dinner" };

export function reviewDay(stops: ReviewStop[], segments: ReviewSegment[], mealTimes: Record<MealKey, MealWindow>, opts: { maxWalkMin?: number | null } = {}): DayReview {
  const real = stops.filter((s) => s.role !== "start");
  const timed = real.filter((s) => s.startMin !== null).sort((a, b) => (a.startMin as number) - (b.startMin as number));
  const end = (s: ReviewStop) => (s.startMin as number) + s.durationMin;
  const span = timed.length ? { from: timed[0].startMin as number, to: Math.max(...timed.map(end)) } : null;
  const notes: Note[] = [];

  // --- meals
  const isFood = (s: ReviewStop) => s.kind === "food" || s.meal !== null;
  const mealOf = (s: ReviewStop): MealKey | null => {
    if (s.meal) return s.meal as MealKey;
    if (s.kind !== "food" || s.startMin === null) return null;
    const hit = (Object.entries(mealTimes) as [MealKey, MealWindow][]).find(([, w]) => (s.startMin as number) >= w.from && (s.startMin as number) < w.to);
    return hit ? hit[0] : null;
  };
  const covered = new Set(real.filter(isFood).map(mealOf).filter((m): m is MealKey => m !== null));
  const meals: MealGap[] = [];
  const start = stops.find((s) => s.role === "start") ?? null;
  const say = (meal: MealKey, position: MealGap["position"], last: ReviewStop | null) =>
    position === "before" ? `${LABEL[meal]} before setting out may be missing` : position === "after" && last ? `${LABEL[meal]} after ${last.title} may be missing` : `${LABEL[meal]} may be missing`;
  for (const meal of CORE) {
    const w = mealTimes[meal];
    if (!w || covered.has(meal)) continue;
    const dur = MEAL_MIN[meal];
    let gap: MealGap | null = null;
    // between stops: the day has to reach well into the meal's range, from before it starts
    if (span) {
      const reach = Math.min(span.to, w.to) - Math.max(span.from, w.from);
      if (!(span.from > w.usual || reach < Math.min(60, w.to - w.from) / 2 || span.to < w.usual)) {
        // where it would go: after the stop that ends inside the meal's range
        // nearest its usual time (or the last one before the range), and before
        // the stop that follows. The part of the route it belongs to.
        const inRange = timed.filter((s) => end(s) >= w.from && end(s) <= w.to);
        const after = inRange.length
          ? inRange.reduce((best, s) => (Math.abs(end(s) - w.usual) < Math.abs(end(best) - w.usual) ? s : best))
          : (timed.filter((s) => end(s) <= w.from).at(-1) ?? null);
        const next = after ? (timed[timed.indexOf(after) + 1] ?? null) : (timed[0] ?? null);
        // nothing before it on the route: it's a meal before setting out
        gap = after
          ? { meal, from: w.from, to: w.to, usual: w.usual, afterId: after.id, beforeId: next?.id ?? null, position: next ? "between" : "after" }
          : { meal, from: w.from, to: w.to, usual: w.usual, afterId: start?.id ?? null, beforeId: next?.id ?? null, position: "before" };
      }
    }
    // before setting out: the day sets out inside the meal's range, so eat
    // first, near the start: the first thing after the starting point (if
    // there is one), finishing before the first stop. A day with only a
    // starting point counts too, from when it leaves.
    const depart = span?.from ?? start?.startMin ?? null;
    if (!gap && depart !== null && depart >= w.from && depart < w.to) {
      const leave = start?.startMin ?? null;
      const to = span ? span.from : w.to;
      const from = leave ?? Math.max(0, to - dur - 60);
      gap = { meal, from, to, usual: span ? Math.max(from, to - dur - 15) : Math.max(from, w.usual), afterId: start?.id ?? null, beforeId: timed[0]?.id ?? null, position: "before" };
    }
    // after the last stop: the day ends in the meal's range, or a little before it
    if (!gap && span && span.to >= w.from - AFTER_LEAD_MIN && span.to < w.to - dur) {
      const last = timed.reduce((m, s) => (end(s) >= end(m) ? s : m));
      gap = { meal, from: Math.max(w.from, span.to), to: w.to, usual: Math.max(w.usual, span.to + 15), afterId: last.id, beforeId: null, position: "after" };
    }
    if (!gap) continue;
    meals.push(gap);
    const last = gap.afterId ? (timed.find((s) => s.id === gap.afterId) ?? null) : null;
    notes.push({ id: `meal:${meal}`, kind: "missing_meal", level: "advice", text: say(meal, gap.position, last), stopIds: [gap.afterId, gap.beforeId].filter((x): x is string => x !== null) });
  }

  // --- routes
  const name = (id: string) => stops.find((s) => s.id === id)?.title ?? "a stop";
  const walkLimit = opts.maxWalkMin ?? LONG_WALK_MIN;
  for (const seg of segments) {
    const sel = seg.options.find((o) => o.mode === seg.selectedMode);
    const min = sel ? travelMinutes(sel as never) : null;
    if (seg.selectedMode === "WALK" && min !== null && min > walkLimit) {
      notes.push({ id: `walk:${seg.fromId}:${seg.toId}`, kind: "long_walk", level: "advice", text: `${min} min walk from ${name(seg.fromId)} to ${name(seg.toId)}`, stopIds: [seg.fromId, seg.toId] });
    }
    if (!seg.options.some((o) => o.status === "ok")) {
      notes.push({ id: `noroute:${seg.fromId}:${seg.toId}`, kind: "no_route", level: "advice", text: `No route found from ${name(seg.fromId)} to ${name(seg.toId)}`, stopIds: [seg.fromId, seg.toId] });
    }
  }

  // --- gaps and load
  for (let i = 0; i + 1 < timed.length; i++) {
    const gap = (timed[i + 1].startMin as number) - end(timed[i]);
    if (gap >= LONG_GAP_MIN) {
      notes.push({ id: `gap:${timed[i].id}`, kind: "long_gap", level: "advice", text: `${Math.floor(gap / 60)} h ${gap % 60 ? `${gap % 60} min ` : ""}free after ${timed[i].title} (${hhmm(end(timed[i]))}–${hhmm(timed[i + 1].startMin as number)})`, stopIds: [timed[i].id, timed[i + 1].id] });
    }
  }
  const active = real.reduce((n, s) => n + s.durationMin, 0);
  if (active > MAX_ACTIVE_MIN || real.length > 9) {
    notes.push({ id: "overloaded", kind: "overloaded", level: "advice", text: `A full day: ${real.length} stops and ${Math.round(active / 60)} h of visits`, stopIds: [] });
  }
  const untimed = real.filter((s) => s.startMin === null).length;
  if (untimed && timed.length) notes.push({ id: "untimed", kind: "untimed", level: "advice", text: `${untimed} stop${untimed === 1 ? " has" : "s have"} no time yet`, stopIds: [] });

  return { span, stops: real.length, meals, notes };
}
