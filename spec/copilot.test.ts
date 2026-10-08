import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { describe, expect, inject, it } from "vitest";
import { aiProvider } from "../src/ai.ts";
import { copilotInput, createCopilot, validateAnswer } from "../src/copilot.ts";
import { analyseDay } from "../src/schedule.ts";
import type { Day } from "../src/trips.ts";
import { addActivity, newTrip, signUp } from "./helpers.ts";

// The AI half of the copilot. These checks never call a real model: they
// check what Wayline sends, what it accepts back, and what happens with no
// provider. A local stand-in answers in the Messages API's shape so the
// request and parsing code runs for real.
const baseUrl = inject("baseUrl");

function day(): Day {
  const activities = [
    { id: "zoo", dayId: "d", position: 0, title: "Taronga Zoo", kind: "attraction" as const, startMin: 540, durationMin: 180, notes: "", place: { placeId: "p1", source: "google", lat: 0, lng: 0 }, version: 1, updatedBy: null, updatedAt: 0 },
    { id: "lunch", dayId: "d", position: 1, title: "Lunch", kind: "food" as const, startMin: 735, durationMin: 60, notes: "", place: { placeId: "p2", source: "google", lat: 0, lng: 0 }, version: 1, updatedBy: null, updatedAt: 0 },
  ];
  const segments = [{ id: "s", fromId: "zoo", toId: "lunch", options: [{ mode: "TRANSIT" as const, status: "ok" as const, durationSec: 2100, distanceM: 5000 }], selectedMode: "TRANSIT" as const, computedAt: 0, departKey: "", stale: false }];
  return {
    id: "d",
    date: "2026-10-20",
    activities,
    segments,
    analysis: analyseDay(
      activities.map((a) => ({ id: a.id, title: a.title, startMin: a.startMin, durationMin: a.durationMin, placeId: a.place.placeId })),
      segments,
    ),
  };
}

describe("the AI copilot", () => {
  it("is off without a key, and the app says so instead of answering", async () => {
    expect(aiProvider({})).toBeNull();
    const c = await signUp(baseUrl);
    const trip = await newTrip(c);
    await addActivity(c, trip, { startMin: 540, durationMin: 180 });
    await addActivity(c, trip, { startMin: 600, durationMin: 60 });
    const config = (await c.get("/api/config")).data;
    if (config.ai.configured) return; // the app under test has a real provider
    const res = await c.send("POST", `/api/trips/${trip.id}/copilot`, { dayId: trip.days[0].id });
    expect(res.status).toBe(503);
    expect(res.data).toMatchObject({ configured: false });
    expect(res.data.answer).toBeUndefined();
    // the rule-based check still works
    expect((await c.get(`/api/trips/${trip.id}`)).data.days[0].analysis.issues).toHaveLength(1);
  });

  it("gives the model only verified facts, with ids to refer to", () => {
    const input = copilotInput(day(), { destination: "Sydney", timezone: "Australia/Sydney" });
    expect(input.issues).toEqual([expect.objectContaining({ id: "travel_tight:zoo:lunch", minutes: 20 })]);
    expect(input.proposals.map((p) => p.id)).toEqual(["delay_next:travel_tight:zoo:lunch", "shorten_prev:travel_tight:zoo:lunch"]);
    expect(input.connections[0]).toMatchObject({ minutesAvailable: 15, selectedMode: "TRANSIT", routes: [expect.objectContaining({ mode: "TRANSIT", minutes: 35 })] });
  });

  it("drops anything in the answer that doesn't refer to a real issue or proposal", () => {
    const answer = validateAnswer(
      {
        summary: "Lunch is too soon after the zoo.",
        issues: [{ issueId: "travel_tight:zoo:lunch", explanation: "Not enough time." }, { issueId: "made-up", explanation: "x" }],
        recommendations: [
          { proposalId: "invented:take-a-taxi", rationale: "Taxi line 999 leaves at 12:01." },
          { proposalId: "delay_next:travel_tight:zoo:lunch", rationale: "Keeps the full zoo visit." },
        ],
        caveats: [],
      },
      day(),
    );
    expect(answer.issues.map((i) => i.issueId)).toEqual(["travel_tight:zoo:lunch"]);
    expect(answer.recommendations.map((r) => r.proposalId)).toEqual(["delay_next:travel_tight:zoo:lunch"]);
    expect(validateAnswer("not json at all", day())).toEqual({ summary: "", issues: [], recommendations: [], caveats: [] });
  });

  it("sends a structured-output request and doesn't ask twice about the same plan", async () => {
    const seen: any[] = [];
    const stub = createServer(async (req, res) => {
      let raw = "";
      for await (const c of req) raw += c;
      seen.push({ headers: req.headers, body: JSON.parse(raw), url: req.url });
      res.setHeader("content-type", "application/json");
      res.end(
        JSON.stringify({
          stop_reason: "end_turn",
          content: [{ type: "text", text: JSON.stringify({ summary: "Push lunch back.", issues: [], recommendations: [{ proposalId: "delay_next:travel_tight:zoo:lunch", rationale: "ok" }], caveats: [] }) }],
        }),
      );
    });
    await new Promise<void>((r) => stub.listen(0, "127.0.0.1", r));
    const url = `http://127.0.0.1:${(stub.address() as AddressInfo).port}`;
    try {
      const provider = aiProvider({ ANTHROPIC_API_KEY: "test-key-not-real", ANTHROPIC_BASE_URL: url });
      const copilot = createCopilot(provider);
      const first = await copilot.ask("u", day(), { destination: "Sydney", timezone: "Australia/Sydney" });
      const again = await copilot.ask("u", day(), { destination: "Sydney", timezone: "Australia/Sydney" });
      expect(first).toMatchObject({ cached: false, answer: { recommendations: [{ proposalId: "delay_next:travel_tight:zoo:lunch" }] } });
      expect(again.cached).toBe(true);
      expect(seen).toHaveLength(1);
      expect(seen[0].url).toBe("/v1/messages");
      expect(seen[0].headers["x-api-key"]).toBe("test-key-not-real");
      expect(seen[0].body.output_config.format.type).toBe("json_schema");
      expect(seen[0].body.model).toBe("claude-opus-5-5");
    } finally {
      stub.close();
    }
  });
});
