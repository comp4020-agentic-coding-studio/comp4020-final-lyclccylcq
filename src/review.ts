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
// holds its start. A meal is flagged only if the timed part of the day spans
// most of its range and there's room for it, and never for meals before the
// day starts or after it ends.

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

export type MealGap = { meal: MealKey; from: number; to: number; usual: number; afterId: string | null; beforeId: string | null };
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
  if (span) {
    for (const meal of CORE) {
      const w = mealTimes[meal];
      if (!w || covered.has(meal)) continue;
      // the day has to reach well into the meal's range, from before it starts
      const reach = Math.min(span.to, w.to) - Math.max(span.from, w.from);
      if (span.from > w.usual || reach < Math.min(60, w.to - w.from) / 2 || span.to < w.usual) continue;
      // where it would go: after the stop that ends inside the meal's range
      // nearest its usual time (or the last one before the range), and before
      // the stop that follows. The part of the route it belongs to.
      const inRange = timed.filter((s) => end(s) >= w.from && end(s) <= w.to);
      const after = inRange.length
        ? inRange.reduce((best, s) => (Math.abs(end(s) - w.usual) < Math.abs(end(best) - w.usual) ? s : best))
        : (timed.filter((s) => end(s) <= w.from).at(-1) ?? null);
      const next = after ? (timed[timed.indexOf(after) + 1] ?? null) : (timed[0] ?? null);
      meals.push({ meal, from: w.from, to: w.to, usual: w.usual, afterId: after?.id ?? null, beforeId: next?.id ?? null });
      notes.push({ id: `meal:${meal}`, kind: "missing_meal", level: "advice", text: `${LABEL[meal]} may be missing`, stopIds: [] });
    }
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
