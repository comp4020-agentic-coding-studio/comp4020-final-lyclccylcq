// What the gym has, by kind of equipment. Each kind lists only the exercises
// done on it, each with a pose: the movement the client animates. Several
// physical machines can share a kind (Flat Bench A, B, C); each is its own
// station that one person at a time can use. Where a machine stands in the
// room is the client's business (public/world.js); which machine someone is
// on is the server's.

// Every exercise records a set in one of three ways, so the gym needs one
// set table, not one per machine:
//   load   – weight lifted (kg) × reps
//   assist – reps, helped by a counterweight (kg): more assistance is easier,
//            so it is never treated as weight lifted
//   time   – minutes, with an optional setting such as speed or level
export type Metric = "load" | "assist" | "time";

export interface Setting {
  label: string;
  unit: string;
  min: number;
  max: number;
  step: number;
}

export interface Exercise {
  name: string;
  pose: string;
  metric: Metric;
  setting?: Setting; // time only: the one optional dial on the machine
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

const load = (name: string, pose: string): Exercise => ({ name, pose, metric: "load" });
const assist = (name: string, pose: string): Exercise => ({ name, pose, metric: "assist" });
const time = (name: string, pose: string, setting?: Setting): Exercise => ({ name, pose, metric: "time", ...(setting ? { setting } : {}) });
const level = (max = 20): Setting => ({ label: "Level", unit: "", min: 1, max, step: 1 });

export const KINDS: Kind[] = [
  { id: "treadmill", name: "Treadmill", count: 4, exercises: [time("Treadmill", "run", { label: "Speed", unit: "km/h", min: 1, max: 25, step: 0.5 })] },
  { id: "bike", name: "Exercise Bike", count: 3, exercises: [time("Exercise Bike", "cycle", level())] },
  { id: "rower", name: "Rowing Machine", count: 2, exercises: [time("Rowing", "row", { label: "Damper", unit: "", min: 1, max: 10, step: 1 })] },
  { id: "stairs", name: "Stair Climber", count: 2, exercises: [time("Stair Climber", "climb", level())] },
  { id: "bench", name: "Flat Bench", count: 3, exercises: [load("Bench Press", "press")] },
  { id: "incline", name: "Incline Bench", count: 2, exercises: [load("Incline Bench Press", "press")] },
  {
    id: "dbbench",
    name: "Dumbbell Bench",
    count: 2,
    exercises: [load("Dumbbell Bench Press", "db-press"), load("Seated Dumbbell Press", "seated-press")],
  },
  {
    id: "dumbbells",
    name: "Dumbbell Spot",
    count: 3,
    exercises: [load("Dumbbell Curl", "curl"), load("Lateral Raise", "lateral"), load("Goblet Squat", "goblet")],
  },
  { id: "shoulder", name: "Shoulder Press", count: 1, exercises: [load("Machine Shoulder Press", "overhead")] },
  { id: "rack", name: "Squat Rack", count: 2, exercises: [load("Squat", "squat")] },
  { id: "platform", name: "Lifting Platform", count: 2, exercises: [load("Deadlift", "deadlift"), load("Barbell Row", "barbell-row")] },
  { id: "legpress", name: "Leg Press", count: 2, exercises: [load("Leg Press", "legpress")] },
  { id: "legext", name: "Leg Extension", count: 1, exercises: [load("Leg Extension", "legext")] },
  { id: "legcurl", name: "Leg Curl", count: 1, exercises: [load("Leg Curl", "legcurl")] },
  { id: "pulldown", name: "Lat Pulldown", count: 2, exercises: [load("Lat Pulldown", "pulldown")] },
  { id: "row", name: "Seated Cable Row", count: 1, exercises: [load("Seated Cable Row", "cable-row")] },
  {
    id: "cable",
    name: "Cable Station",
    count: 2,
    exercises: [load("Triceps Pushdown", "pushdown"), load("Cable Curl", "cable-curl"), load("Face Pull", "face-pull")],
  },
  { id: "pullup", name: "Assisted Pull-up & Dip", count: 1, exercises: [assist("Assisted Pull-up", "pullup"), assist("Assisted Dip", "dip")] },
  { id: "preacher", name: "Preacher Curl", count: 1, exercises: [load("Preacher Curl", "preacher")] },
  { id: "mats", name: "Stretch Mat", count: 4, exercises: [time("Stretching", "stretch")] },
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
