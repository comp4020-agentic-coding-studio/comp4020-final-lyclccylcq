import { describe, expect, it } from "vitest";
import { bestStart, type GHours, type GPeriod, hoursFromGoogle, hoursOn, mealFits } from "../src/hours.ts";

// Opening hours, from the shapes Google's Places API (New) actually returns:
// periods with open/close day (0 = Sunday) and time, dated "current" periods
// for about the next week, special days, and KITCHEN secondary hours.
const p = (d: number, oh: number, om: number, cd: number, ch: number, cm: number): GPeriod => ({ open: { day: d, hour: oh, minute: om }, close: { day: cd, hour: ch, minute: cm } });
const weekly = (periods: GPeriod[]): GHours => ({ regular: periods, current: null, kitchen: null, specialDates: [] });
const SUN = "2026-10-25"; // a Sunday
const t = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3));

describe("does a meal fit the restaurant's hours?", () => {
  // closes 21:00 every day
  const until9 = weekly([0, 1, 2, 3, 4, 5, 6].map((d) => p(d, 11, 0, d, 21, 0)));

  it("1. refuses a 20:30 dinner at a place closing at 21:00, and says when to arrive instead", () => {
    const f = mealFits(hoursOn(until9, SUN), t("20:30"), 75);
    expect(f).toMatchObject({ ok: false, reason: "too_late", closesAt: t("21:00"), latestStart: t("19:15") });
    if (!f.ok) expect(f.message).toMatch(/closes at 21:00/);
  });

  it("2. accepts a 19:00 dinner there (75 min + 30 min buffer ends 20:45)", () => {
    expect(mealFits(hoursOn(until9, SUN), t("19:00"), 75)).toMatchObject({ ok: true, basis: "regular", latestStart: t("19:15") });
    expect(mealFits(hoursOn(until9, SUN), t("19:15"), 75).ok).toBe(true);
    expect(mealFits(hoursOn(until9, SUN), t("19:20"), 75).ok).toBe(false);
  });

  it("3. sees a midday break: lunch must finish by 13:30, dinner from 17:00", () => {
    // Tsukiji Sushiko's weekday hours from Google: 11:30–13:30 and 17:00–22:00
    const sushi = weekly([1, 2, 3, 4, 5].flatMap((d) => [p(d, 11, 30, d, 13, 30), p(d, 17, 0, d, 22, 0)]));
    const mon = hoursOn(sushi, "2026-10-26");
    expect(mealFits(mon, t("12:30"), 60).ok).toBe(false); // ends 13:30, no buffer
    expect(mealFits(mon, t("11:30"), 60).ok).toBe(true);
    const gap = mealFits(mon, t("15:00"), 45);
    expect(gap).toMatchObject({ ok: false, reason: "break" });
    if (!gap.ok) expect(gap.message).toBe("It's closed between 13:30 and 17:00.");
    expect(mealFits(mon, t("19:00"), 75).ok).toBe(true);
  });

  it("4. runs on past midnight: a place open 11:30–03:30 takes a 22:30 dinner", () => {
    // Gonpachi from Google: every day 11:30 to 03:30 the next day
    const late = weekly([0, 1, 2, 3, 4, 5, 6].map((d) => p(d, 11, 30, (d + 1) % 7, 3, 30)));
    const day = hoursOn(late, SUN);
    expect(mealFits(day, t("22:30"), 90)).toMatchObject({ ok: true, closesAt: 24 * 60 + 3 * 60 + 30 });
    expect(mealFits(day, t("01:00"), 60).ok).toBe(true); // still Saturday night's period
    expect(mealFits(day, t("10:00"), 60).ok).toBe(false); // before opening
    // Google's "always open" (one period, no close), e.g. Ichiran
    expect(mealFits(hoursOn(weekly([{ open: { day: 0, hour: 0, minute: 0 } }]), SUN), t("23:00"), 90).ok).toBe(true);
  });

  it("5. never treats unknown hours as confirmed", () => {
    const day = hoursOn(null, SUN);
    expect(day.basis).toBe("unknown");
    expect(mealFits(day, t("20:30"), 75)).toMatchObject({ ok: true, basis: "unknown" });
    expect(hoursFromGoogle({})).toBeNull();
  });

  it("6. prefers Google's dated hours for that date (special days), and marks weekly hours as unverified", () => {
    const g: GHours = {
      regular: [0, 1, 2, 3, 4, 5, 6].map((d) => p(d, 11, 0, d, 22, 0)),
      // a holiday Sunday: Google's current hours say it closes at 18:00
      current: [{ open: { day: 0, hour: 11, minute: 0, date: { year: 2026, month: 10, day: 25 } }, close: { day: 0, hour: 18, minute: 0, date: { year: 2026, month: 10, day: 25 } } }],
      kitchen: null,
      specialDates: [SUN],
    };
    const sun = hoursOn(g, SUN);
    expect(sun).toMatchObject({ basis: "dated", special: true });
    expect(mealFits(sun, t("19:00"), 75).ok).toBe(false); // regular hours would have said yes
    // a date outside Google's dated window falls back to the weekly hours, unverified
    expect(hoursOn(g, "2026-12-20").basis).toBe("regular");
    // a dated window that has no period on a date means closed that day
    const closedMon: GHours = { ...g, current: [...g.current!, { open: { day: 2, hour: 11, minute: 0, date: { year: 2026, month: 10, day: 27 } }, close: { day: 2, hour: 22, minute: 0, date: { year: 2026, month: 10, day: 27 } } }] };
    expect(hoursOn(closedMon, "2026-10-26")).toMatchObject({ basis: "dated", open: [] });
  });

  it("7. revalidates whatever time the person picks", () => {
    const day = hoursOn(until9, SUN);
    expect(mealFits(day, t("18:30"), 75).ok).toBe(true);
    expect(mealFits(day, t("20:00"), 75).ok).toBe(false); // they moved it later
    expect(mealFits(day, t("18:30"), 150).ok).toBe(false); // or made it longer
  });

  it("8. refuses a meal that runs past closing, with or without the buffer", () => {
    const day = hoursOn(until9, SUN);
    expect(mealFits(day, t("20:00"), 90)).toMatchObject({ ok: false, reason: "too_late" });
    expect(mealFits(day, t("19:30"), 60, 0).ok).toBe(true); // a caller can choose no buffer
  });

  it("respects Google's kitchen hours as last orders, and never invents one", () => {
    const g: GHours = { ...weekly([0, 1, 2, 3, 4, 5, 6].map((d) => p(d, 11, 0, d, 23, 0))), kitchen: [0, 1, 2, 3, 4, 5, 6].map((d) => p(d, 11, 0, d, 20, 30)) };
    const day = hoursOn(g, SUN);
    expect(mealFits(day, t("20:00"), 60).ok).toBe(true);
    expect(mealFits(day, t("21:00"), 60)).toMatchObject({ ok: false, reason: "kitchen" });
    expect(hoursOn(weekly([p(0, 11, 0, 0, 23, 0)]), SUN).kitchen).toBeNull();
  });

  it("10. finds the best fitting start in a window, or none", () => {
    const day = hoursOn(until9, SUN);
    expect(bestStart(day, t("18:00"), t("20:30"), 75, t("18:30"))).toBe(t("18:30"));
    expect(bestStart(day, t("19:30"), t("20:30"), 75, t("20:00"))).toBeNull(); // nothing fits before closing
    expect(bestStart(day, t("19:00"), t("20:30"), 75, t("20:00"))).toBe(t("19:15")); // latest that still fits
  });

  it("reads Google's response shape, including kitchen hours and special days", () => {
    const g = hoursFromGoogle({
      regularOpeningHours: { periods: [p(0, 11, 0, 0, 21, 0)] },
      currentOpeningHours: { periods: [], specialDays: [{ date: { year: 2026, month: 12, day: 31 } }] },
      regularSecondaryOpeningHours: [{ secondaryHoursType: "DELIVERY", periods: [] }, { secondaryHoursType: "KITCHEN", periods: [p(0, 11, 0, 0, 20, 0)] }],
    });
    expect(g).toMatchObject({ specialDates: ["2026-12-31"], kitchen: [expect.any(Object)] });
  });
});

// The browser's copy (public/hours.js) gives the same answers as the server's.
describe("the browser's copy of the hours check", async () => {
  // @ts-expect-error plain JS module without types
  const web = await import("../public/hours.js");
  const s = await import("../src/hours.ts");
  const cases: [GHours, string, string, number][] = [
    [weekly([0, 1, 2, 3, 4, 5, 6].map((d) => p(d, 11, 0, d, 21, 0))), SUN, "20:30", 75],
    [weekly([0, 1, 2, 3, 4, 5, 6].map((d) => p(d, 11, 0, d, 21, 0))), SUN, "19:00", 75],
    [weekly([1, 2, 3, 4, 5].flatMap((d) => [p(d, 11, 30, d, 13, 30), p(d, 17, 0, d, 22, 0)])), "2026-10-26", "15:00", 45],
    [weekly([0, 1, 2, 3, 4, 5, 6].map((d) => p(d, 11, 30, (d + 1) % 7, 3, 30))), SUN, "22:30", 90],
    [weekly([{ open: { day: 0, hour: 0, minute: 0 } }]), SUN, "23:00", 90],
  ];
  it("agrees with the server on every case", () => {
    for (const [h, date, at, dur] of cases) {
      expect(web.mealFits(web.hoursOn(h, date), t(at), dur)).toEqual(s.mealFits(s.hoursOn(h, date), t(at), dur));
    }
    expect(web.hoursOn(null, SUN)).toEqual(s.hoursOn(null, SUN));
  });
});
