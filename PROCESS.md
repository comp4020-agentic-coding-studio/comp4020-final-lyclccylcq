# Process overview

_Draft at crit 8. Per the brief, this gets rewritten at each crit, not appended to._

## From brief to idea

The brief asks for a multi-user, real-time website that's good, and warns that the
median answer is a chat room with the nouns swapped. My idea is a virtual gym.
Spatial-presence products like Gather were the starting point, but a virtual office
is still a meeting. What I wanted from a real gym is narrower: training on your own
while other people work nearby, with nobody asking anything of you. That gave the
design statement in the README, and a list of things the app must not become:
Strava, Discord, a feed, a leaderboard, a coaching app.

A gym also suits a spatial interface better than most ideas, because where someone
is standing already says what they're doing. Being at the squat rack *is* the
status. So the floor is the main view, and logging is something you do at a station
rather than in a form beside the map.

## How I directed the agent

I worked in two passes, a build and a review, each starting from a long prompt I
had written before any code existed. Then I ran the review again as a second audit.

**Build pass.** The prompt set out the concept, the scope limits (no AI, nutrition,
rankings, messaging or heavy accounts), the crit 8 journey, and the rule that
persistence must be server-side, with `localStorage` holding no more than a token. It
told the agent to inspect the starter and explain the architecture before writing
anything, and to put the course's requirements ahead of mine where they
conflicted. The server and data model landed in
[`00a5898`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-lyclccylcq/commit/00a5898),
the floor and panel in
[`0e2b05b`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-lyclccylcq/commit/0e2b05b),
and the checks in
[`c024afc`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-lyclccylcq/commit/c024afc).

**Review pass.** I then told the agent to stop adding features and audit the result
as a crit 8 submission in four areas: the crit requirements, persistence
correctness, the product concept and the documentation. The prompt asked it to test
the flow rather than assume it worked, and to remove anything that pushed toward a
normal fitness tracker. The corrections it produced are below. Each one is a place
where the first build had drifted from the README.

**Second audit.** I ran the same review brief again in a fresh session, so the
first review's write-up wasn't taken on trust. The agent drove a new user through
the journey in headless Chrome on an empty database. The agent didn't use the
existing tests for this, because those tests hadn't caught the problems the first
review found. It found nothing wrong with the product direction, and two small
gaps:

- Recovering with a pass typed in lowercase worked, but the browser saved what was
  typed rather than the server's canonical pass, so the pass card and the stored
  pass could differ. The browser now stores the pass the server returns.
- No check covered the path a returning person actually takes: join through the
  door in a real browser, reload, and still be the same person. The API checks
  used the pass directly. `spec/viewports.test.ts` now covers it and asserts the
  pass is the only thing in `localStorage`. With the client broken on purpose to
  save a wrong pass, the check went red.

It also found the deployed URL doesn't answer: the repo is still private, so CI
has never deployed, and there's no Fly token on this machine for a manual deploy.

**Visual direction correction.** After the second audit I looked at the running
app again and decided the direction itself was wrong, even though every check
passed. Five dashed zones with round dots and a big panel beside them read as a
workout tracker with a gym theme. I redirected the agent with a long prompt: a
large pixel-art gym that feels like walking into a real one, with Gather as a
reference for spatial scale and presence only, and none of its assets, maps or
code. The main constraint was that it be "a persistent virtual gym in which real
workout activity controls what your pixel character is doing". Choosing Bench Press
has to put your character on a bench, pressing. Changing the label isn't enough.

I asked the agent to inspect the code and explain any renderer choice before
building it. It proposed one hand-drawn canvas, no engine and no image files, with
the words kept as HTML on top
([decision record 2](docs/decisions/0002-canvas-pixel-world.md)). The changes:

- **The room.** A 60×38-tile gym, drawn at 3× on desktop and 2× on phones and
  never shrunk to fit, so it's larger than the screen. Zones: cardio by the
  windows, machines, free weights by the mirror, benches, squat racks on wooden
  platforms, stretch and recovery, and a lobby with lockers and the front door. The
  furniture (leg press, cable crossover, rowers, plate trees, sofa, vending machine)
  is there for density and isn't interactive.
- **Exercises cut to what the gym can show.** The server's stations went from
  five areas with twelve exercises to seven stations with one exercise each: bench
  press, squat, lat pulldown, dumbbell curl, treadmill, bike and stretching. Each
  has two or three machines and a two-frame animation. Exercises with no animation
  (seated cable row, leg press, push-up, rower and others) were removed rather than
  shown as text. Someone who hasn't chosen yet now stands in the lobby, not at a
  "rest" station.
- **Meaning stored, picture derived.** Persistence didn't change: the server still
  stores exercise, state and since when. `world.js` turns that into a machine, a
  walking route (breadth-first over the tile grid) and a pose, so a reload puts
  you back on the same machine without storing anything visual. Every person,
  including you, is an entity in `setPeople()`. A newcomer walks in from the
  door, a change of exercise walks to the new machine, and someone leaving walks
  out, which is what crit 9's live feed needs.

## Stack

Plain Node 24 (`http` and `node:sqlite`) with a hand-written client and no runtime
dependencies. The trade-offs are in
[decision record 1](docs/decisions/0001-plain-node-and-sqlite.md). In short: the app
is one page and an API on a 256 MB machine, so a framework would mostly sit unused,
and built-in SQLite avoids compiling a native module in the image. Docker isn't
installed on my machine, so the image hasn't been built locally. Instead, the
review ran the server from exactly the files the `Dockerfile` copies, on an empty
data directory with production settings, and the full check passed.

## Identity and persistence

There are four tables: users, sessions (visits), sets and presence, in one SQLite
file at `/data/gym.db`. `/data` is the Fly volume, the only storage the course setup
keeps across restarts and redeploys. A person is an opaque id plus a 12-character
gym pass, which the browser sends as a bearer token. The browser stores the pass
and nothing else. Typing the pass on another device brings back the same person;
the display name is only a label. Presence is one row per person, rewritten on each
change, and a visit left open for three hours is closed at its last activity. Every
change goes through four functions in `src/gym.ts` (enter, choose, set, leave),
which are the events crit 9 will broadcast.

I tested this in a real browser by driving headless Chrome: join, choose, log a set,
refresh, navigate away and back, quit the browser, restart the server, reopen. Then
I wiped `localStorage` and recovered using only the typed pass. At every step the
person, their station, their set and a still-running rest timer came back.

## What the review corrected

- **Other people's weights were on the public floor.** The first build put each
  person's last set on their label, so everyone's numbers sat side by side. That's
  the comparison the README says the app avoids. Now others see who you are, where
  you are, the exercise and whether you're training or resting. Your numbers appear
  only to you
  ([`427dad9`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-lyclccylcq/commit/427dad9)).
  This changes something my build prompt had asked for, so it's a correction I've
  accepted, not one the agent made silently.
- **Tracker drift.** The welcome-back screen showed running totals ("N sets over M
  visits"). That's analytics, not presence, so it was removed (same commit).
- **An empty gym didn't look like a shared space.** A first-time visitor at an empty
  floor saw a diagram with one dot in it. Each station now draws open spots, and
  people take a spot instead of a random point
  ([`d1a481b`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-lyclccylcq/commit/d1a481b)).
  That also fixed labels piling up.
- **Mislabelled space.** The rest area was subtitled "Between sets", but people rest
  at their own station, so it's now "Recovery". Newcomers standing there said
  "Warming up"; they now say "Just arrived". "Split Squat" and "Incline Dumbbell
  Press" became "Leg Press" and "Chest Press", so each exercise sits where you'd
  look for it.
- **Phones lost the activity.** To save space, phone labels had dropped the
  exercise name, so the floor showed only that someone was resting. Now only the
  numbers drop.

## Problems along the way

- **Layout bugs only visible in screenshots.** At 1440px the first panel squeezed
  the weight and reps inputs until the numbers were cut off, and at 390px name tags
  spilled into neighbouring zones. Both were fixed in the build pass. In the review
  the agent made this a sensor rather than a habit of looking:
  `spec/viewports.test.ts` drives Chrome at both marking viewports
  ([`9c92d5c`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-lyclccylcq/commit/9c92d5c)).
- **The first version of that sensor passed with the bug still there.** It checked
  the inputs at the cardio station, which has no weight field. Putting the old CSS
  back showed it staying green, so it now checks a weighted station, and it goes
  red when the old CSS is put back.
- **Walking slowed to a crawl near the machine.** On the phone screenshot the
  character was still walking three seconds after choosing the pulldown. Walking
  speed was recalculated each frame from the distance left, so it decayed as the
  character got closer. It's now set once when the walk starts.
- **Furniture covered the floor's zone names.** The dumbbell racks and lockers
  stood on the painted "FREE WEIGHTS" and "LOBBY" in the first full-room
  screenshot. They were moved down a row. A script then checked that nothing
  overlaps and that every machine and lobby spot can be reached from the door.
- **A failing check that was right.** The new viewport check failed with you
  "idle" at the pulldown. My earlier hand-testing had left two people on both
  pulldown machines, so the app had correctly put you in line beside them. Instead
  of weakening the check, the agent made waiting visible ("Waiting for a machine")
  and ran the checks on a fresh database, as CI does.
- **The panel squeezed the inputs again.** The old viewport check caught the
  weight input at 48px in the new desktop panel. The panel was widened and the
  stepper buttons narrowed.
- **A false alarm.** Full-page screenshots showed people faded at desktop width.
  Measuring the computed opacity showed it was 1: the capture was replaying the
  entrance animation. No change was needed.

## Rejected or deferred

- **An event-log table** for crit 9 to read from. Nothing would read it yet, and the
  four action functions already give a broadcast one place to hook in.
- **Free roaming (WASD) and a character creator.** You walk where your workout
  takes you, and everyone has one body in their own shirt colour. Both can come
  later without changing the data model.
- **A game engine or sprite image files.** See decision record 2.
- **Polling the floor.** I held it back so crit 8 stays about persistence and the
  real-time choice is made deliberately at crit 9. Others appear when the page
  loads, and the README says exactly that.

## Checks, honestly

The first checks were written after the implementation in the same session, so
they never failed against a missing app. Three are exceptions: the viewport sensor
and the returning-browser check were both shown to catch the bug they were written
for. The pixel-world check was shown to go red when animation is switched off.
Restart persistence is verified by
hand, not in `spec/`, because the spec runs against an app it can't restart.
