import { describe, expect, it } from "vitest";
import { reviewDay, type ReviewStop } from "../src/review.ts";
import { DEFAULT_MEAL_TIMES } from "../src/trips.ts";

// A day can have no timing conflicts and still be missing a meal or a route.
// These are the planning assistant's status lines: plain rules, no model.
const stop = (id: string, title: string, start: string | null, durationMin: number, over: Partial<ReviewStop> = {}): ReviewStop => {
  const [h, m] = (start ?? "0:0").split(":").map(Number);
  return { id, title, kind: "attraction", role: null, meal: null, startMin: start === null ? null : h * 60 + m, durationMin, hasPlace: true, ...over };
};

// The Tokyo day from the brief: seven stops 09:00–20:51, lunch at 12:40, no dinner.
const tokyo = () => [
  stop("senso", "Senso-ji", "09:00", 90),
  stop("skytree", "Tokyo Skytree", "10:45", 90),
  stop("lunch", "Ramen lunch", "12:40", 60, { kind: "food" }),
  stop("ueno", "Ueno Park", "14:00", 90),
  stop("akiba", "Akihabara", "16:00", 90),
  stop("shibuya", "Shibuya Crossing", "18:00", 45),
  stop("shinjuku", "Shinjuku Gyoen night walk", "19:21", 90),
];

describe("reviewing a day beyond timing conflicts", () => {
  it("flags the Tokyo day's missing dinner, and doesn't count lunch as dinner", () => {
    const r = reviewDay(tokyo(), [], DEFAULT_MEAL_TIMES);
    expect(r.span).toEqual({ from: 540, to: 20 * 60 + 51 });
    expect(r.stops).toBe(7);
    expect(r.meals.map((m) => m.meal)).toEqual(["dinner"]);
    expect(r.notes.map((n) => n.text)).toContain("Dinner may be missing");
    // where dinner would go: in the evening part of the route, not at the end
    expect(r.meals[0]).toMatchObject({ afterId: "shibuya", beforeId: "shinjuku" });
  });

  it("respects an assigned meal, and a food stop counts only for its own meal", () => {
    const withDinner = [...tokyo(), stop("izakaya", "Izakaya", "19:00", 60, { kind: "food" })];
    expect(reviewDay(withDinner, [], DEFAULT_MEAL_TIMES).meals).toEqual([]);
    // a café marked as afternoon tea at 15:00 isn't dinner
    const tea = [...tokyo(), stop("cafe", "Café", "15:00", 30, { kind: "food", meal: "afternoon_tea" })];
    expect(reviewDay(tea, [], DEFAULT_MEAL_TIMES).meals.map((m) => m.meal)).toEqual(["dinner"]);
    // a stop explicitly marked dinner covers it even if it isn't "food"
    const marked = [...tokyo(), stop("market", "Night market", "18:50", 60, { meal: "dinner" })];
    expect(reviewDay(marked, [], DEFAULT_MEAL_TIMES).meals).toEqual([]);
  });

  it("uses the trip's own meal times, and doesn't ask for meals outside the day", () => {
    const morning = [stop("a", "A", "09:00", 60), stop("b", "B", "10:30", 60)];
    expect(reviewDay(morning, [], DEFAULT_MEAL_TIMES).meals).toEqual([]); // ends before lunch
    const late = { ...DEFAULT_MEAL_TIMES, dinner: { from: 20 * 60, to: 22 * 60, usual: 21 * 60 } };
    expect(reviewDay(tokyo(), [], late).meals).toEqual([]); // the day ends at 20:51, before a 21:00 dinner
    const noLunch = tokyo().filter((s) => s.id !== "lunch");
    expect(reviewDay(noLunch, [], DEFAULT_MEAL_TIMES).meals.map((m) => m.meal)).toEqual(["lunch", "dinner"]);
  });

  it("notes long walks, legs with no route, long gaps and a crowded day, as advice", () => {
    const segs = [
      { fromId: "senso", toId: "skytree", selectedMode: "WALK" as const, options: [{ mode: "WALK" as const, status: "ok", durationSec: 25 * 60 }, { mode: "TRANSIT" as const, status: "none" }] },
      { fromId: "akiba", toId: "shibuya", selectedMode: "WALK" as const, options: [{ mode: "WALK" as const, status: "ok", durationSec: 75 * 60 }] },
      { fromId: "ueno", toId: "akiba", selectedMode: null, options: [{ mode: "TRANSIT" as const, status: "none" }, { mode: "WALK" as const, status: "error" }] },
    ];
    const r = reviewDay(tokyo(), segs, DEFAULT_MEAL_TIMES);
    expect(r.notes.map((n) => n.kind)).toEqual(expect.arrayContaining(["long_walk", "no_route"]));
    expect(r.notes.find((n) => n.kind === "long_walk")?.text).toBe("75 min walk from Akihabara to Shibuya Crossing");
    expect(r.notes.every((n) => n.level === "advice")).toBe(true);
    const gappy = [stop("a", "A", "09:00", 60), stop("b", "B", "14:00", 60)];
    expect(reviewDay(gappy, [], DEFAULT_MEAL_TIMES).notes.find((n) => n.kind === "long_gap")?.text).toBe("4 h free after A (10:00–14:00)");
    const crowded = Array.from({ length: 10 }, (_, i) => stop(`s${i}`, `S${i}`, `${8 + i}:00`, 60));
    expect(reviewDay(crowded, [], DEFAULT_MEAL_TIMES).notes.some((n) => n.kind === "overloaded")).toBe(true);
  });
});
