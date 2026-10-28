import type { ServerResponse } from "node:http";
import type { User } from "./auth.ts";
import { AiError } from "./ai.ts";
import { describeAiError } from "./copilot.ts";
import { HttpError } from "./errors.ts";
import { googleConfigured, nearbyPlaces } from "./google.ts";
import { clock as clockOf, hoursOn, mealFits } from "./hours.ts";
import { note, shortId } from "./log.ts";
import { type Candidate, changeId, dayCentre, eatDraft, freeSlots, mealSearchPoints, nearbyDraft, type PlanDraft, type Planner, searchTypes, toCandidates } from "./planner.ts";
import type { Preferences } from "./preferences.ts";
import type { TripSnapshot, TripStore } from "./trips.ts";

// The planning assistant's two requests (CLAUDE.md, "The AI copilot"): a
// preview of one day's plan, and applying exactly that preview. A plan is
// applied by id, so a client can't edit it on the way back; drafts are
// disposable, kept 30 minutes in memory. Every write still goes through the
// trip store (applyPlan, inside one mutate()), and route lookups through the
// server's ordinary deduplicated path (calculateRoute).

type Reply = { status: number; data: unknown };
const reply = (status: number, data: unknown): Reply => ({ status, data });
const DRAFT_TTL_MS = 30 * 60_000;

export function createPlanning(deps: {
  trips: TripStore;
  preferences: Preferences;
  planner: Planner;
  calculateRoute: (user: User, tripId: string, input: Record<string, unknown>) => Promise<TripSnapshot>;
}) {
  const { trips, preferences, planner, calculateRoute } = deps;
  const drafts = new Map<string, { userId: string; tripId: string; draft: PlanDraft; at: number }>();

  // "Plan with AI" for one day: a preview only; nothing changes until /apply
  // The planning assistant. Three actions, each a preview only; nothing
  // changes until /plan/apply. "eat" and "nearby" use Google and plain rules
  // (no model call); "optimize" makes one model call over the whole day.
  // signal: the person left; no model call starts, a running one is cancelled.
  async function draft(user: User, tripId: string, input: Record<string, unknown>, signal: AbortSignal): Promise<Reply> {
    const action = input.action === "eat" || input.action === "nearby" ? input.action : "optimize";
    const snap = trips.view(user.id, tripId);
    const day = snap.days.find((d) => d.id === input.dayId);
    if (!day) throw new HttpError(404, "That day isn't part of this trip.");
    if (action === "optimize" && !planner.configured) return reply(503, { configured: false, error: "AI planning isn't available on this server. Planning by hand still works." });
    const prefs = preferences.effective(user.id, tripId);
    if (!prefs.confirmed) return reply(409, { code: "preferences", error: "Set your travel preferences first.", effective: prefs });
    if (action !== "optimize" && !googleConfigured()) return reply(503, { error: "Place suggestions need Google Maps configured on the server." });
    // Real travel times first: legs between consecutive routable stops that
    // have no Google route yet are calculated through the ordinary
    // (deduplicated, cached) route path, at most six per plan. A leg Google
    // can't route stays "not calculated"; nothing is estimated.
    const routable = (a: (typeof day.activities)[number]) => a.place?.source === "google" || (a.place?.source === "custom" && a.place.lat !== null);
    const missing = googleConfigured()
      ? day.activities.slice(0, -1).flatMap((a, i) => {
          const b = day.activities[i + 1];
          const seg = day.segments.find((s) => s.fromId === a.id && s.toId === b.id);
          return routable(a) && routable(b) && (!seg || seg.stale) ? [[a.id, b.id]] : [];
        }).slice(0, 6)
      : [];
    let routed = 0;
    for (const [fromId, toId] of missing) {
      try {
        await calculateRoute(user, tripId, { fromId, toId });
        routed++;
      } catch {
        // left uncalculated; the preview says so
      }
    }
    const fresh = routed ? trips.view(user.id, tripId) : snap;
    const planDay = fresh.days.find((d) => d.id === day.id) ?? day;
    const routeNotes: string[] = [];
    if (routed) routeNotes.push(`Calculated ${routed} travel time${routed === 1 ? "" : "s"} with Google Maps.`);
    if (missing.length > routed) routeNotes.push(`${missing.length - routed} travel time${missing.length - routed === 1 ? "" : "s"} couldn't be calculated.`);
    const search = async (points: { lat: number; lng: number }[], types: { type: string; kind: "food" | "attraction" }[], radius: number) => {
      // one Places request per type per point, at most six; a failure leaves it out rather than guessing
      const jobs = points.flatMap((pt) => types.map((t) => ({ pt, t }))).slice(0, 6);
      const groups = await Promise.all(jobs.map(async ({ pt, t }) => ({ kind: t.kind, places: (await nearbyPlaces(pt, radius, t.type, { withPrice: true }).catch(() => ({ places: [] }))).places })));
      return toCandidates(groups, planDay, points[0]);
    };
    const keep = (draft: PlanDraft) => {
      const id = shortId("plan");
      const t = Date.now();
      for (const [k, v] of drafts) if (t - v.at > DRAFT_TTL_MS) drafts.delete(k);
      drafts.set(id, { userId: user.id, tripId, draft, at: t });
      return id;
    };
    const withIds = (draft: PlanDraft) => ({ ...draft, changes: draft.changes.map((c) => ({ ...c, id: changeId(c) })) });

    if (action === "eat") {
      const gaps = planDay.review.meals;
      const gap = gaps.find((g) => g.meal === input.meal) ?? gaps[0];
      if (!gap) return reply(200, { action, meals: [], summary: "No meal looks missing on this day.", changes: [], caveats: [], picks: [] });
      const points = mealSearchPoints(planDay, gap);
      if (!points.length) return reply(200, { action, meals: gaps, summary: "The stops around this meal have no places on the map.", changes: [], caveats: [], picks: [] });
      const types = [{ type: "restaurant", kind: "food" as const }, ...(prefs.food.cuisines.includes("cafe") ? [{ type: "cafe", kind: "food" as const }] : [])];
      const draft = eatDraft(planDay, prefs, gap, await search(points, types, 1200));
      draft.caveats.unshift(...routeNotes);
      note({ dayId: day.id, meal: gap.meal, changes: draft.changes.length, event: "AI_EAT_SUGGESTED", action: "find_food", message: "User asked for places to eat (Google only, no model call)" });
      return reply(200, { draftId: keep(draft), meals: gaps, ...withIds(draft) });
    }

    if (action === "nearby") {
      const slots = freeSlots(planDay);
      const points = slots.flatMap((sl) => {
        const a = planDay.activities.find((x) => x.id === sl.afterActivityId);
        return a?.place?.lat != null && a.place.lng != null ? [{ lat: a.place.lat, lng: a.place.lng }] : [];
      }).slice(0, 2);
      const types = searchTypes(prefs).filter((t) => t.kind === "attraction").slice(0, 3);
      const candidates = points.length ? await search(points, types, 2000) : [];
      const draft = nearbyDraft(planDay, prefs, candidates);
      draft.caveats.unshift(...routeNotes);
      note({ dayId: day.id, changes: draft.changes.length, event: "AI_NEARBY_SUGGESTED", action: "explore_nearby", message: "User asked for nearby places (Google only, no model call)" });
      return reply(200, { draftId: keep(draft), ...withIds(draft) });
    }

    const centre = dayCentre(planDay, fresh.center);
    let candidates: Candidate[] = [];
    let candidateNote: string | null = null;
    if (!centre) candidateNote = "This day has no places on the map yet, so there's nothing nearby to suggest.";
    else if (!googleConfigured()) candidateNote = "Nearby suggestions need Google Maps configured on the server.";
    else {
      // missing meals are searched where they'd go on the route; other ideas near the day
      const mealPoints = planDay.review.meals.flatMap((g) => mealSearchPoints(planDay, g)).slice(0, 2);
      const foodCands = mealPoints.length ? await search(mealPoints, [{ type: "restaurant", kind: "food" }], 1200) : [];
      const sightCands = await search([centre], searchTypes(prefs).filter((t) => t.kind === "attraction").slice(0, 2), 2500);
      candidates = [...foodCands.slice(0, 6), ...sightCands.slice(0, 6)];
      if (!candidates.length) candidateNote = "Google found no new places near this day to suggest.";
    }
    try {
      // gone while routes and places were looked up: don't spend a model call
      if (signal.aborted) throw new AiError("cancelled", "The request was cancelled.");
      const draft = await planner.plan({ userId: user.id, tripId, day: planDay, prefs, candidates, signal });
      if (candidateNote) draft.caveats.unshift(candidateNote);
      draft.caveats.unshift(...routeNotes);
      const id = keep(draft);
      note({ dayId: day.id, changes: draft.changes.length, routesCalculated: routed, candidates: candidates.length });
      return reply(200, { draftId: id, action, ...withIds(draft) });
    } catch (err) {
      const status = (err as { status?: number }).status;
      if (status === 429 || status === 503 || err instanceof HttpError) throw err;
      const d = describeAiError(err);
      return reply(d.status, { error: d.error.replace("AI copilot", "AI planner"), retry: d.retry });
    }
  }

  return {
    // Listens from the start, before any slow lookup. Only a connection that
    // closes before the response ended is a cancellation.
    async draft(user: User, tripId: string, input: Record<string, unknown>, res: ServerResponse): Promise<Reply> {
      const ac = new AbortController();
      const onClose = () => {
        if (!res.writableEnded) ac.abort();
      };
      res.on("close", onClose);
      try {
        return await draft(user, tripId, input, ac.signal);
      } finally {
        res.off("close", onClose);
      }
    },

    // Applies a previewed draft, all of it or only the chosen changes (changeIds).
    // Every change is re-checked against the day as it is now (fingerprint,
    // permissions, places, times, modes) in one mutate(). Applying part of a
    // draft changes the day, so the rest of it goes stale and is refused (409).
    apply(user: User, tripId: string, input: Record<string, unknown>): TripSnapshot {
      const entry = typeof input.draftId === "string" ? drafts.get(input.draftId) : undefined;
      if (!entry || entry.tripId !== tripId || entry.userId !== user.id || Date.now() - entry.at > DRAFT_TTL_MS) {
        trips.requireMember(tripId, user.id);
        throw new HttpError(410, "This plan has expired. Make a new one.", { code: "expired" });
      }
      const d = entry.draft;
      const wanted = Array.isArray(input.changeIds) ? new Set(input.changeIds.filter((x): x is string => typeof x === "string")) : null;
      const picked = wanted ? d.changes.filter((c) => wanted.has(changeId(c))) : d.changes;
      if (!picked.length) throw new HttpError(400, "Choose at least one suggestion to apply.");
      // a person may change a suggestion's time or length before adding it; the
      // hours check below then runs on what's actually being saved
      const edits = input.edits && typeof input.edits === "object" ? (input.edits as Record<string, { startMin?: unknown; durationMin?: unknown }>) : {};
      const chosen = picked.map((c) => {
        const e = edits[changeId(c)];
        if (c.type !== "add" || !e) return c;
        const startMin = e.startMin === null ? null : Number.isInteger(e.startMin) ? (e.startMin as number) : c.startMin;
        const durationMin = Number.isInteger(e.durationMin) && (e.durationMin as number) >= 5 && (e.durationMin as number) <= 600 ? (e.durationMin as number) : c.durationMin;
        return { ...c, startMin, durationMin };
      });
      // Every restaurant is re-checked against its opening hours on the trip's
      // date before anything is written, whichever action made it (eat,
      // optimize). A time its known hours rule out is refused for review, never
      // applied quietly.
      const tripDay = trips.view(user.id, tripId).days.find((x) => x.id === d.dayId);
      for (const c of chosen) {
        if (c.type !== "add" || c.kind !== "food" || c.startMin === null || !tripDay) continue;
        const fit = mealFits(hoursOn(c.candidate.hours ?? null, tripDay.date), c.startMin, c.durationMin);
        if (!fit.ok) throw new HttpError(409, `${c.candidate.name}: ${fit.message}${fit.latestStart !== null ? ` The latest start that fits is ${clockOf(fit.latestStart)}.` : ""}`, { code: "hours", changeId: changeId(c), latestStart: fit.latestStart });
      }
      const snap = trips.applyPlan(user.id, tripId, {
        dayId: d.dayId,
        basedOn: d.basedOn,
        changes: chosen.map((c) =>
          c.type === "move"
            ? { type: "move", activityId: c.activityId, toIndex: c.toIndex }
            : c.type === "mode"
              ? { type: "mode", segmentId: c.segmentId, to: c.to }
              : {
                  type: "add",
                  clientId: c.clientId,
                  title: c.candidate.name,
                  kind: c.kind === "food" ? "food" : "attraction",
                  startMin: c.startMin,
                  durationMin: c.durationMin,
                  meal: c.meal,
                  notes: c.warning ?? "",
                  place: { placeId: c.candidate.placeId, source: c.candidate.source === "demo" ? "demo" : "google", lat: c.candidate.lat, lng: c.candidate.lng },
                },
        ),
      });
      drafts.delete(input.draftId as string);
      note({ dayId: d.dayId, changes: chosen.length, of: d.changes.length });
      return snap;
    },
  };
}
