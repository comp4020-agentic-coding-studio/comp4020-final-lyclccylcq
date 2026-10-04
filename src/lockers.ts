import type { DatabaseSync } from "node:sqlite";
import { exerciseByName } from "./equipment.ts";

// The locker room: what the gym remembers about each person. Presence
// (gym.ts) is only what someone is doing now and expires; lockers, visits and
// sets are kept.
//
// A locker is an entity of its own (a number, and who it belongs to), so the
// room can show every locker and, later, other people's, while what's inside
// stays readable only by its owner.

export const LOCKER_COUNT = 36;
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
const RECENT_VISITS = 5;

interface SessionRow {
  id: number;
  started_at: number;
  ended_at: number | null;
  sets: number;
  last_set: number;
}

interface SetRow {
  session_id: number;
  exercise: string;
  weight_kg: number;
  amount: number;
  setting: number | null;
  done_at: number;
}

export function createLockers(db: DatabaseSync, clock: () => number, count = LOCKER_COUNT) {
  const q = {
    of: db.prepare("select number from lockers where user_id = ?"),
    numbers: db.prepare("select number from lockers where number <= ? order by number"),
    assign: db.prepare("insert into lockers (number, user_id, assigned_at) values (?, ?, ?)"),
    // with every locker taken, the one whose owner has been gone longest is
    // cleared for the newcomer; the old owner's history stays with them
    longestAway: db.prepare(`
      select l.number from lockers l left join presence p on p.user_id = l.user_id
      where l.number <= ? and coalesce(p.state, 'away') = 'away'
      order by coalesce(p.since, 0) asc limit 1`),
    reassign: db.prepare("update lockers set user_id = ?, assigned_at = ? where number = ?"),
    visits: db.prepare(`
      select s.id, s.started_at, s.ended_at, count(t.id) as sets, max(t.done_at) as last_set
      from sessions s join sets t on t.session_id = s.id
      where s.user_id = ? group by s.id order by s.id desc limit ?`),
    setsFrom: db.prepare("select session_id, exercise, weight_kg, amount, setting, done_at from sets where user_id = ? and session_id >= ? order by id"),
    visitsSince: db.prepare(`
      select count(distinct s.id) as n from sessions s join sets t on t.session_id = s.id
      where s.user_id = ? and s.started_at >= ?`),
    heaviest: db.prepare(`
      select exercise, weight_kg, amount, done_at from sets
      where user_id = ? and weight_kg > 0
      order by exercise, weight_kg desc, amount desc, done_at asc`),
  };

  // Your locker number, giving you one if you have none yet.
  function ensure(userId: string): number | null {
    const mine = q.of.get(userId) as { number: number } | undefined;
    if (mine) return mine.number;
    const used = new Set((q.numbers.all(count) as { number: number }[]).map((r) => r.number));
    let free = 0;
    for (let n = 1; n <= count && !free; n++) if (!used.has(n)) free = n;
    if (free) {
      q.assign.run(free, userId, clock());
      return free;
    }
    const gone = q.longestAway.get(count) as { number: number } | undefined;
    if (!gone) return null; // everyone with a locker is in the gym right now
    q.reassign.run(userId, clock(), gone.number);
    return gone.number;
  }

  return {
    ensure,

    // The room as anyone sees it: which lockers are taken, not by whom.
    room() {
      const used = new Set((q.numbers.all(count) as { number: number }[]).map((r) => r.number));
      return Array.from({ length: count }, (_, i) => ({ number: i + 1, taken: used.has(i + 1) }));
    },

    // What's inside, for its owner only: recent visits with their sets, how
    // many visits this past week, and the heaviest set of each lift with a
    // load (never assistance, which is the opposite of load).
    contents(userId: string) {
      const number = ensure(userId);
      const now = clock();
      const visits = q.visits.all(userId, RECENT_VISITS) as unknown as SessionRow[];
      const ids = new Set(visits.map((v) => v.id));
      const sets = ids.size ? (q.setsFrom.all(userId, Math.min(...ids)) as unknown as SetRow[]).filter((s) => ids.has(s.session_id)) : [];

      const byExercise = new Map<string, { weight_kg: number; amount: number; done_at: number }>();
      for (const s of q.heaviest.all(userId) as unknown as SetRow[]) {
        if (!byExercise.has(s.exercise) && exerciseByName.get(s.exercise)?.metric === "load") byExercise.set(s.exercise, s);
      }
      const latestVisit = visits[0]?.started_at ?? Infinity;

      return {
        now,
        number,
        visitsThisWeek: (q.visitsSince.get(userId, now - WEEK_MS) as { n: number }).n,
        visits: visits.map((v) => {
          const exercises: { exercise: string; sets: { weightKg: number; amount: number; setting: number | null; doneAt: number }[] }[] = [];
          for (const s of sets.filter((s) => s.session_id === v.id)) {
            let group = exercises.find((g) => g.exercise === s.exercise);
            if (!group) exercises.push((group = { exercise: s.exercise, sets: [] }));
            group.sets.push({ weightKg: s.weight_kg, amount: s.amount, setting: s.setting, doneAt: s.done_at });
          }
          return { id: v.id, startedAt: v.started_at, endedAt: v.ended_at, lastSetAt: v.last_set, sets: v.sets, exercises };
        }),
        bests: [...byExercise]
          .map(([exercise, s]) => ({ exercise, weightKg: s.weight_kg, amount: s.amount, doneAt: s.done_at, fromLatestVisit: s.done_at >= latestVisit }))
          .sort((a, b) => b.doneAt - a.doneAt)
          .slice(0, 5),
      };
    },
  };
}
