// What the gym has, by kind of equipment. Each kind lists only the exercises
// done on it, each with a pose: the movement the client animates. Several
// physical machines can share a kind (Flat Bench A, B, C); each is its own
// station that one person at a time can use. Where a machine stands in the
// room is the client's business (public/world.js); which machine someone is
// on is the server's.

export interface Exercise {
  name: string;
  pose: string;
  measure: "reps" | "min"; // timed work (cardio, stretching) logs minutes
  weighted: boolean;
}

export interface Kind {
  id: string;
  name: string;
  count: number;
  exercises: Exercise[];
}

export interface Machine {
  id: string;
  kind: string;
  name: string;
}

const reps = (name: string, pose: string, weighted = true): Exercise => ({ name, pose, measure: "reps", weighted });
const mins = (name: string, pose: string): Exercise => ({ name, pose, measure: "min", weighted: false });

export const KINDS: Kind[] = [
  { id: "treadmill", name: "Treadmill", count: 4, exercises: [mins("Treadmill", "run")] },
  { id: "bike", name: "Exercise Bike", count: 3, exercises: [mins("Exercise Bike", "cycle")] },
  { id: "rower", name: "Rowing Machine", count: 2, exercises: [mins("Rowing", "row")] },
  { id: "bench", name: "Flat Bench", count: 3, exercises: [reps("Bench Press", "press")] },
  { id: "incline", name: "Incline Bench", count: 2, exercises: [reps("Incline Bench Press", "press")] },
  {
    id: "dbbench",
    name: "Dumbbell Bench",
    count: 2,
    exercises: [reps("Dumbbell Bench Press", "db-press"), reps("Seated Dumbbell Press", "seated-press")],
  },
  {
    id: "dumbbells",
    name: "Dumbbell Spot",
    count: 3,
    exercises: [reps("Dumbbell Curl", "curl"), reps("Lateral Raise", "lateral"), reps("Goblet Squat", "goblet")],
  },
  { id: "shoulder", name: "Shoulder Press", count: 1, exercises: [reps("Machine Shoulder Press", "overhead")] },
  { id: "rack", name: "Squat Rack", count: 2, exercises: [reps("Squat", "squat")] },
  { id: "legpress", name: "Leg Press", count: 2, exercises: [reps("Leg Press", "legpress")] },
  { id: "legext", name: "Leg Extension", count: 1, exercises: [reps("Leg Extension", "legext")] },
  { id: "legcurl", name: "Leg Curl", count: 1, exercises: [reps("Leg Curl", "legcurl")] },
  { id: "pulldown", name: "Lat Pulldown", count: 2, exercises: [reps("Lat Pulldown", "pulldown")] },
  { id: "row", name: "Seated Cable Row", count: 1, exercises: [reps("Seated Cable Row", "cable-row")] },
  {
    id: "cable",
    name: "Cable Station",
    count: 2,
    exercises: [reps("Triceps Pushdown", "pushdown"), reps("Cable Curl", "cable-curl"), reps("Face Pull", "face-pull")],
  },
  { id: "pullup", name: "Assisted Pull-up", count: 1, exercises: [reps("Assisted Pull-up", "pullup", false)] },
  { id: "preacher", name: "Preacher Curl", count: 1, exercises: [reps("Preacher Curl", "preacher")] },
  { id: "mats", name: "Stretch Mat", count: 4, exercises: [mins("Stretching", "stretch")] },
];

const LETTERS = "ABCDEFGH";

export const MACHINES: Machine[] = KINDS.flatMap((k) =>
  Array.from({ length: k.count }, (_, i) => ({
    id: `${k.id}-${LETTERS[i].toLowerCase()}`,
    kind: k.id,
    name: k.count > 1 ? `${k.name} ${LETTERS[i]}` : k.name,
  })),
);

export const machineById = new Map(MACHINES.map((m) => [m.id, m]));
export const kindById = new Map(KINDS.map((k) => [k.id, k]));
export const exerciseByName = new Map(KINDS.flatMap((k) => k.exercises.map((e) => [e.name, e] as const)));
