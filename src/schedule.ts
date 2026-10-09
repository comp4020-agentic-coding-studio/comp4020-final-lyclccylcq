// Deterministic schedule checks. Everything here is plain arithmetic on the
// itinerary and on route durations a provider actually returned: end times,
// gaps, overlaps, shortfalls, and the exact edits that would fix each one.
// The AI copilot may explain and rank these proposals; it never computes them.

export type Mode = "WALK" | "TRANSIT" | "DRIVE";
export const MODES: Mode[] = ["WALK", "TRANSIT", "DRIVE"];

export type TransitStep = {
  kind: "transit";
  line: string | null;
  vehicle: string | null;
  color: string | null;
  textColor: string | null;
  headsign: string | null;
  from: string | null;
  to: string | null;
  departureTime: string | null;
  arrivalTime: string | null;
  localDeparture: string | null;
  localArrival: string | null;
  stops: number | null;
};
export type WalkStep = { kind: "walk"; durationSec: number; distanceM: number };
export type RouteStep = TransitStep | WalkStep;

export type RouteOption = {
  mode: Mode;
  status: "ok" | "none" | "error";
  durationSec?: number;
  distanceM?: number;
  steps?: RouteStep[];
  message?: string;
  polyline?: string;
};

export type DayActivity = {
  id: string;
  title: string;
  startMin: number | null;
  durationMin: number;
  placeId: string | null;
};

export type DaySegment = {
  id: string;
  fromId: string;
  toId: string;
  options: RouteOption[];
  selectedMode: Mode | null;
  stale: boolean;
};

export type Gap = {
  fromId: string;
  toId: string;
  availableMin: number | null;
  segmentId: string | null;
  travelMin: number | null;
  mode: Mode | null;
  status: "no_places" | "not_calculated" | "unavailable" | "ok" | "stale";
};

export type Issue = {
  id: string;
  kind: "overlap" | "travel_tight" | "past_midnight";
  severity: "conflict" | "warning";
  fromId: string;
  toId: string | null;
  minutes: number;
  message: string;
};

export type Change =
  | { type: "activity"; activityId: string; field: "startMin" | "durationMin"; from: number; to: number }
  | { type: "mode"; segmentId: string; from: Mode | null; to: Mode };

export type Proposal = {
  id: string;
  issueId: string;
  kind: "delay_next" | "push_rest" | "shorten_prev" | "switch_mode";
  label: string;
  changes: Change[];
};

export type DayAnalysis = { gaps: Gap[]; issues: Issue[]; proposals: Proposal[] };

export const MIN_DURATION = 5;
export const MAX_DAY_MIN = 24 * 60;

export const hhmm = (min: number): string => {
  const m = ((min % MAX_DAY_MIN) + MAX_DAY_MIN) % MAX_DAY_MIN;
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
};

export const minutesLabel = (min: number): string => {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return h && m ? `${h}h ${m}m` : h ? `${h}h` : `${m} min`;
};

export const travelMinutes = (o: RouteOption | undefined): number | null =>
  o && o.status === "ok" && typeof o.durationSec === "number" ? Math.ceil(o.durationSec / 60) : null;

// The mode to show first after a calculation: the quickest of walking and
// transit, and driving only when neither exists. The user can change it.
export function defaultMode(options: RouteOption[]): Mode | null {
  const usable = options.filter((o) => travelMinutes(o) !== null);
  const pick = (list: RouteOption[]) => list.sort((a, b) => (a.durationSec ?? 0) - (b.durationSec ?? 0))[0]?.mode ?? null;
  return pick(usable.filter((o) => o.mode !== "DRIVE")) ?? pick(usable);
}

const MODE_NAME: Record<Mode, string> = { WALK: "walking", TRANSIT: "public transport", DRIVE: "driving" };

export function analyseDay(activities: DayActivity[], segments: DaySegment[]): DayAnalysis {
  const gaps: Gap[] = [];
  const issues: Issue[] = [];
  const proposals: Proposal[] = [];
  const end = (a: DayActivity) => (a.startMin === null ? null : a.startMin + a.durationMin);

  activities.forEach((a) => {
    const e = end(a);
    if (e !== null && e > MAX_DAY_MIN) {
      issues.push({
        id: `past_midnight:${a.id}`,
        kind: "past_midnight",
        severity: "warning",
        fromId: a.id,
        toId: null,
        minutes: e - MAX_DAY_MIN,
        message: `${a.title} runs past midnight (until ${hhmm(e)} the next day).`,
      });
    }
  });

  for (let i = 0; i + 1 < activities.length; i++) {
    const prev = activities[i];
    const next = activities[i + 1];
    const prevEnd = end(prev);
    const available = prevEnd !== null && next.startMin !== null ? next.startMin - prevEnd : null;
    const seg = segments.find((s) => s.fromId === prev.id && s.toId === next.id) ?? null;
    const selected = seg?.options.find((o) => o.mode === seg.selectedMode);
    const travel = travelMinutes(selected);

    let status: Gap["status"];
    if (!prev.placeId || !next.placeId) status = "no_places";
    else if (!seg) status = "not_calculated";
    else if (travel === null) status = "unavailable";
    else status = seg.stale ? "stale" : "ok";
    gaps.push({
      fromId: prev.id,
      toId: next.id,
      availableMin: available,
      segmentId: seg?.id ?? null,
      travelMin: travel,
      mode: travel === null ? null : (seg?.selectedMode ?? null),
      status,
    });

    if (available === null || prevEnd === null || next.startMin === null) continue;

    if (available < 0) {
      const id = `overlap:${prev.id}:${next.id}`;
      const over = -available;
      issues.push({
        id,
        kind: "overlap",
        severity: "conflict",
        fromId: prev.id,
        toId: next.id,
        minutes: over,
        message: `${prev.title} ends at ${hhmm(prevEnd)}, ${minutesLabel(over)} after ${next.title} starts at ${hhmm(next.startMin)}.`,
      });
      proposals.push(...fixes(id, prev, next, over, activities.slice(i + 1)));
      continue;
    }

    if (travel !== null && seg && seg.selectedMode && travel > available) {
      const id = `travel_tight:${prev.id}:${next.id}`;
      const short = travel - available;
      issues.push({
        id,
        kind: "travel_tight",
        severity: "conflict",
        fromId: prev.id,
        toId: next.id,
        minutes: short,
        message:
          `There ${available === 1 ? "is" : "are"} ${minutesLabel(available)} between ${prev.title} (ends ${hhmm(prevEnd)}) and ` +
          `${next.title} (starts ${hhmm(next.startMin)}), but ${MODE_NAME[seg.selectedMode]} takes ${minutesLabel(travel)}. ` +
          `That's ${minutesLabel(short)} short.`,
      });
      proposals.push(...fixes(id, prev, next, short, activities.slice(i + 1)));
      for (const o of seg.options) {
        const t = travelMinutes(o);
        if (o.mode !== seg.selectedMode && t !== null && t <= available) {
          proposals.push({
            id: `switch_mode:${o.mode}:${id}`,
            issueId: id,
            kind: "switch_mode",
            label: `Switch to ${MODE_NAME[o.mode]} (${minutesLabel(t)}), which fits the ${minutesLabel(available)} gap`,
            changes: [{ type: "mode", segmentId: seg.id, from: seg.selectedMode, to: o.mode }],
          });
        }
      }
    }
  }
  return { gaps, issues, proposals };
}

function fixes(issueId: string, prev: DayActivity, next: DayActivity, minutes: number, rest: DayActivity[]): Proposal[] {
  const out: Proposal[] = [];
  const nextStart = next.startMin as number;
  if (nextStart + minutes < MAX_DAY_MIN) {
    out.push({
      id: `delay_next:${issueId}`,
      issueId,
      kind: "delay_next",
      label: `Start ${next.title} at ${hhmm(nextStart + minutes)} instead of ${hhmm(nextStart)}`,
      changes: [{ type: "activity", activityId: next.id, field: "startMin", from: nextStart, to: nextStart + minutes }],
    });
    const later = rest.filter((a) => a.startMin !== null);
    if (later.length > 1 && later.every((a) => (a.startMin as number) + minutes < MAX_DAY_MIN)) {
      out.push({
        id: `push_rest:${issueId}`,
        issueId,
        kind: "push_rest",
        label: `Push ${next.title} and the ${later.length - 1} stop${later.length > 2 ? "s" : ""} after it ${minutesLabel(minutes)} later`,
        changes: later.map((a) => ({
          type: "activity" as const,
          activityId: a.id,
          field: "startMin" as const,
          from: a.startMin as number,
          to: (a.startMin as number) + minutes,
        })),
      });
    }
  }
  if (prev.durationMin - minutes >= MIN_DURATION) {
    out.push({
      id: `shorten_prev:${issueId}`,
      issueId,
      kind: "shorten_prev",
      label: `Shorten ${prev.title} to ${minutesLabel(prev.durationMin - minutes)} (from ${minutesLabel(prev.durationMin)})`,
      changes: [
        { type: "activity", activityId: prev.id, field: "durationMin", from: prev.durationMin, to: prev.durationMin - minutes },
      ],
    });
  }
  return out;
}

// Converts a wall-clock time on a date in an IANA time zone to a UTC instant,
// for route departure times. Iterates once to settle across DST shifts.
export function zonedTimeToUtc(date: string, minutes: number, timeZone: string): Date {
  const [y, mo, d] = date.split("-").map(Number);
  const guess = Date.UTC(y, mo - 1, d, Math.floor(minutes / 60), minutes % 60);
  const offsetAt = (t: number) => {
    const parts = Object.fromEntries(
      new Intl.DateTimeFormat("en-US", {
        timeZone,
        hourCycle: "h23",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      })
        .formatToParts(new Date(t))
        .map((p) => [p.type, p.value]),
    );
    const asUtc = Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute, +parts.second);
    return asUtc - t;
  };
  let t = guess - offsetAt(guess);
  t = guess - offsetAt(t);
  return new Date(t);
}
