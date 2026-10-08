import { createHash } from "node:crypto";
import type { AiProvider } from "./ai.ts";
import { hhmm, minutesLabel, travelMinutes } from "./schedule.ts";
import type { Day } from "./trips.ts";

// The copilot explains a day's schedule problems and recommends among the
// fixes the deterministic checks already worked out. The model sees only
// verified data: the itinerary, route durations Google returned, the issues,
// and the candidate proposals with their exact edits. It answers with ids
// from that list; anything else it returns is dropped before the user sees
// it, and nothing is applied until the user accepts a proposal.

export type CopilotAnswer = {
  summary: string;
  issues: { issueId: string; explanation: string }[];
  recommendations: { proposalId: string; rationale: string }[];
  caveats: string[];
};

export const SCHEMA = {
  type: "object",
  properties: {
    summary: { type: "string" },
    issues: {
      type: "array",
      items: {
        type: "object",
        properties: { issueId: { type: "string" }, explanation: { type: "string" } },
        required: ["issueId", "explanation"],
        additionalProperties: false,
      },
    },
    recommendations: {
      type: "array",
      items: {
        type: "object",
        properties: { proposalId: { type: "string" }, rationale: { type: "string" } },
        required: ["proposalId", "rationale"],
        additionalProperties: false,
      },
    },
    caveats: { type: "array", items: { type: "string" } },
  },
  required: ["summary", "issues", "recommendations", "caveats"],
  additionalProperties: false,
};

const SYSTEM = `You are the schedule copilot inside Wayline, a collaborative travel itinerary planner.
You receive one day of a trip as JSON: the activities the travellers chose, route durations that a maps provider returned, scheduling issues the app detected with exact arithmetic, and candidate proposals (each with exact edits) the app generated.

Your job:
- Explain each issue in plain, friendly language, in one or two sentences.
- Recommend which proposals make most sense and why, referring to them only by their "id". Recommend at most three, best first. Keeping the plan as it is can be the right answer; say so in the summary if it is.
- Respect the travellers' choices: never suggest dropping a place they chose, and never invent new places.

Strict rules:
- Use only facts present in the input. Do not invent transit lines, departure times, fares, opening hours, distances or durations.
- Do not do time arithmetic of your own; the input already contains the computed times and shortfalls.
- Only use issueId and proposalId values that appear in the input.
- If a route is marked stale or unavailable, say that it should be recalculated rather than guessing.
- Keep the summary under 60 words.`;

export function copilotInput(day: Day, trip: { destination: string; timezone: string }) {
  const name = new Map(day.activities.map((a) => [a.id, a.title]));
  return {
    destination: trip.destination,
    date: day.date,
    activities: day.activities.map((a, i) => ({
      order: i + 1,
      id: a.id,
      title: a.title,
      type: a.kind,
      start: a.startMin === null ? null : hhmm(a.startMin),
      end: a.startMin === null ? null : hhmm(a.startMin + a.durationMin),
      duration: minutesLabel(a.durationMin),
      notes: a.notes || undefined,
    })),
    connections: day.analysis.gaps.map((g) => {
      const seg = day.segments.find((s) => s.id === g.segmentId);
      return {
        from: name.get(g.fromId),
        to: name.get(g.toId),
        minutesAvailable: g.availableMin,
        routeStatus: g.status,
        selectedMode: g.mode,
        routes: seg?.options.map((o) => ({
          mode: o.mode,
          minutes: travelMinutes(o),
          unavailableReason: o.status === "ok" ? undefined : o.message,
          transitLines: o.steps
            ?.filter((s) => s.kind === "transit")
            .map((s) => (s.kind === "transit" ? `${s.vehicle ?? "Transit"} ${s.line ?? ""}`.trim() : "")),
        })),
      };
    }),
    issues: day.analysis.issues.map((i) => ({ id: i.id, severity: i.severity, minutes: i.minutes, description: i.message })),
    proposals: day.analysis.proposals.map((p) => ({ id: p.id, forIssue: p.issueId, description: p.label })),
  };
}

// Keeps only what refers to real issues and proposals, and caps lengths.
export function validateAnswer(raw: unknown, day: Day): CopilotAnswer {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const issueIds = new Set(day.analysis.issues.map((i) => i.id));
  const proposalIds = new Set(day.analysis.proposals.map((p) => p.id));
  const clip = (v: unknown, n: number) => (typeof v === "string" ? v.trim().slice(0, n) : "");
  const list = (v: unknown) => (Array.isArray(v) ? v : []) as Record<string, unknown>[];
  return {
    summary: clip(r.summary, 600),
    issues: list(r.issues)
      .filter((i) => issueIds.has(String(i?.issueId)))
      .map((i) => ({ issueId: String(i.issueId), explanation: clip(i.explanation, 500) })),
    recommendations: list(r.recommendations)
      .filter((p) => proposalIds.has(String(p?.proposalId)))
      .slice(0, 3)
      .map((p) => ({ proposalId: String(p.proposalId), rationale: clip(p.rationale, 400) })),
    caveats: (Array.isArray(r.caveats) ? r.caveats : []).map((c) => clip(c, 300)).filter(Boolean).slice(0, 3),
  };
}

export function createCopilot(provider: AiProvider | null) {
  // The same day asked about twice gets the same answer without another
  // model call; any change to the day changes the key.
  const cache = new Map<string, CopilotAnswer>();
  const recent = new Map<string, number[]>();

  return {
    configured: provider !== null,
    model: provider?.model ?? null,

    async ask(userId: string, day: Day, trip: { destination: string; timezone: string }): Promise<{ answer: CopilotAnswer; cached: boolean }> {
      if (!provider) throw new Error("no provider");
      const input = copilotInput(day, trip);
      const key = createHash("sha256").update(JSON.stringify(input)).digest("hex");
      const hit = cache.get(key);
      if (hit) return { answer: hit, cached: true };

      const now = Date.now();
      const times = (recent.get(userId) ?? []).filter((t) => now - t < 60_000);
      if (times.length >= 6) throw Object.assign(new Error("Too many copilot requests. Wait a minute and try again."), { status: 429 });
      recent.set(userId, [...times, now]);

      const raw = await provider.completeJson({ system: SYSTEM, user: JSON.stringify(input), schema: SCHEMA });
      const answer = validateAnswer(raw, day);
      cache.set(key, answer);
      if (cache.size > 200) cache.delete(cache.keys().next().value as string);
      return { answer, cached: false };
    },
  };
}
