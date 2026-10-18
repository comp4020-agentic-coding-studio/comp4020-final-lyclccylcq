import type { DatabaseSync } from "node:sqlite";
import { bad } from "./errors.ts";
import type { Role } from "./permissions.ts";
import { authorize } from "./permissions.ts";

// Travel preferences (docs/ai.md). Two levels:
//   - a person's defaults, private to them, reused on every trip: food
//     (cuisines, diet, allergies, price) and their usual travel choices
//   - a trip's shared choices (transport, pace, budget, interests), set by
//     any member, which override that person's defaults for that trip
// Diet and allergies are never stored on a trip or shown to other members:
// they come only from the person who asks the AI.

export const CUISINES = ["local", "chinese", "japanese", "korean", "thai", "vietnamese", "indian", "italian", "french", "mexican", "middle_eastern", "seafood", "cafe"] as const;
export const DIETS = ["vegetarian", "vegan", "halal", "kosher", "gluten_free", "dairy_free"] as const;
export const PRICES = ["budget", "moderate", "premium", "any"] as const;
export const TRANSPORT = ["walk", "transit", "drive", "mixed", "any"] as const;
export const PACES = ["relaxed", "balanced", "intensive"] as const;
export const INTERESTS = ["nature", "museums", "history", "architecture", "shopping", "photography", "local_food", "entertainment", "outdoors"] as const;

export type Food = { cuisines: string[]; diets: string[]; allergies: string; price: (typeof PRICES)[number] };
export type Travel = {
  transport: (typeof TRANSPORT)[number];
  avoidModes: ("WALK" | "TRANSIT" | "DRIVE")[]; // hard: never pick these
  maxWalkMin: number | null; // a single walk longer than this is avoided
  fewerTransfers: boolean;
  prefer: "faster" | "cheaper" | "any";
  pace: (typeof PACES)[number];
  interests: string[];
  budget: (typeof PRICES)[number];
};
export type UserPrefs = { food: Food; travel: Travel; confirmed: boolean };
export type TripPrefs = Partial<Travel>;
export type Effective = { food: Food; travel: Travel; source: { user: boolean; trip: boolean }; confirmed: boolean };

export const DEFAULT_FOOD: Food = { cuisines: [], diets: [], allergies: "", price: "any" };
export const DEFAULT_TRAVEL: Travel = { transport: "any", avoidModes: [], maxWalkMin: null, fewerTransfers: false, prefer: "any", pace: "balanced", interests: [], budget: "any" };

type Row = Record<string, unknown>;
const pick = <T extends string>(v: unknown, allowed: readonly T[], field: string): T => {
  if (!allowed.includes(v as T)) throw bad(`${field} must be one of: ${allowed.join(", ")}.`);
  return v as T;
};
const list = (v: unknown, allowed: readonly string[], field: string): string[] => {
  if (!Array.isArray(v)) throw bad(`${field} must be a list.`);
  const out = [...new Set(v.map((x) => pick(x, allowed, field)))];
  return out;
};

function foodInput(v: unknown): Food {
  const f = (v && typeof v === "object" ? v : {}) as Row;
  const allergies = typeof f.allergies === "string" ? f.allergies.trim() : f.allergies === undefined ? "" : null;
  if (allergies === null) throw bad("Allergies must be text.");
  if (allergies.length > 200) throw bad("Keep allergies under 200 characters.");
  if (/[\p{Cc}]/u.test(allergies)) throw bad("Allergies can't contain control characters.");
  return {
    cuisines: f.cuisines === undefined ? [] : list(f.cuisines, CUISINES, "Cuisines"),
    diets: f.diets === undefined ? [] : list(f.diets, DIETS, "Dietary needs"),
    allergies,
    price: f.price === undefined ? "any" : pick(f.price, PRICES, "Restaurant price"),
  };
}

// Only the fields given; a trip may set some and leave the rest to each person.
function travelInput(v: unknown, partial: boolean): Partial<Travel> {
  const t = (v && typeof v === "object" ? v : {}) as Row;
  const out: Partial<Travel> = {};
  if (t.transport !== undefined) out.transport = pick(t.transport, TRANSPORT, "Transport");
  if (t.avoidModes !== undefined) out.avoidModes = list(t.avoidModes, ["WALK", "TRANSIT", "DRIVE"], "Modes to avoid") as Travel["avoidModes"];
  if (t.maxWalkMin !== undefined) {
    if (t.maxWalkMin !== null && (!Number.isInteger(t.maxWalkMin) || (t.maxWalkMin as number) < 5 || (t.maxWalkMin as number) > 120)) throw bad("Longest walk must be 5–120 minutes, or none.");
    out.maxWalkMin = t.maxWalkMin as number | null;
  }
  if (t.fewerTransfers !== undefined) out.fewerTransfers = t.fewerTransfers === true;
  if (t.prefer !== undefined) out.prefer = pick(t.prefer, ["faster", "cheaper", "any"] as const, "Prefer");
  if (t.pace !== undefined) out.pace = pick(t.pace, PACES, "Pace");
  if (t.interests !== undefined) out.interests = list(t.interests, INTERESTS, "Interests");
  if (t.budget !== undefined) out.budget = pick(t.budget, PRICES, "Budget");
  if (out.avoidModes && out.avoidModes.length === 3) throw bad("Leave at least one way of getting around.");
  return partial ? out : { ...DEFAULT_TRAVEL, ...out };
}

export function createPreferences(db: DatabaseSync, roleOf: (tripId: string, userId: string) => Role | null, now = () => Date.now()) {
  const q = (sql: string) => db.prepare(sql);
  const read = (sql: string, id: string): Row | null => {
    const r = q(sql).get(id);
    return r ? (JSON.parse(String(r.data)) as Row) : null;
  };

  function mine(userId: string): UserPrefs & { saved: boolean } {
    const r = read("select data from user_preferences where user_id = ?", userId);
    if (!r) return { food: DEFAULT_FOOD, travel: DEFAULT_TRAVEL, confirmed: false, saved: false };
    return { food: { ...DEFAULT_FOOD, ...(r.food as Food) }, travel: { ...DEFAULT_TRAVEL, ...(r.travel as Travel) }, confirmed: r.confirmed === true, saved: true };
  }

  function forTrip(userId: string, tripId: string): TripPrefs {
    authorize(roleOf(tripId, userId), "view");
    return (read("select data from trip_preferences where trip_id = ?", tripId) as TripPrefs | null) ?? {};
  }

  return {
    mine,
    forTrip,

    saveMine(userId: string, input: Row): UserPrefs {
      const prefs: UserPrefs = { food: foodInput(input.food), travel: travelInput(input.travel, false) as Travel, confirmed: true };
      q("insert into user_preferences (user_id, data, updated_at) values (?, ?, ?) on conflict (user_id) do update set data = excluded.data, updated_at = excluded.updated_at").run(userId, JSON.stringify(prefs), now());
      return prefs;
    },

    // Shared trip choices: any member may set them. Food never goes here.
    saveTrip(userId: string, tripId: string, input: Row): TripPrefs {
      authorize(roleOf(tripId, userId), "add_activity");
      if ("food" in input || "allergies" in input || "diets" in input) throw bad("Food and allergies are personal; set them in your own preferences.");
      const prefs = travelInput(input.travel ?? input, true);
      q("insert into trip_preferences (trip_id, data, updated_by, updated_at) values (?, ?, ?, ?) on conflict (trip_id) do update set data = excluded.data, updated_by = excluded.updated_by, updated_at = excluded.updated_at").run(tripId, JSON.stringify(prefs), userId, now());
      return prefs;
    },

    // What the AI uses for this person on this trip: their own food, and
    // the trip's shared choices over their own travel defaults.
    effective(userId: string, tripId: string): Effective {
      const u = mine(userId);
      const t = forTrip(userId, tripId);
      return { food: u.food, travel: { ...u.travel, ...t }, source: { user: u.saved, trip: Object.keys(t).length > 0 }, confirmed: u.confirmed };
    },
  };
}

export type Preferences = ReturnType<typeof createPreferences>;
