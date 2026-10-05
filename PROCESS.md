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

**Equipment and the set lifecycle.** My next prompt kept the direction but
named three gaps: too few machines, a workout picked from a list instead of from
the equipment, and only a Finish button, with no real start. It also asked for a
visual polish pass, and said explicitly not to begin crit 9.

- **Machines moved to the server.** The previous build let each browser pick a
  free machine by hashing people's ids, so two browsers could disagree about who
  was on bench A. `src/equipment.ts` now lists 18 kinds of equipment with their
  exercises and poses, for 37 machines. The server records which machine each
  person is on and refuses a second person. Positions and art stay in the
  browser, matched by machine id. That's the occupancy model crit 9 needs.
- **Start, finish, cancel.** `/api/activity` and `/api/sets` were replaced by
  start, finish, cancel and step-off. Start stores the planned set and records
  nothing; Finish records it and leaves you resting at the machine; Cancel records
  nothing. Tapping a machine only opens its setup.
- **A set nobody finishes.** I asked for an explicit decision about a browser
  disappearing mid-set. A started set survives a reload, so you can finish it.
  After ten minutes (plus its planned minutes, if timed) it expires unrecorded and
  the machine is freed. A rest lets go of the machine after fifteen.
- **The schema stayed additive.** Four columns were added to the presence table
  when they're missing. Old rows of someone mid-exercise with no machine are read
  as standing about. A separate "ready" state for "at a machine, not started" was
  rejected: the table's CHECK constraint would have meant rebuilding it, so
  cancelling leaves you idle with the machine noted instead.
- **The room.**
  - Furniture that looked like a machine but couldn't be used (ellipticals, a
    decor leg press, a chest press, a cable crossover) was removed or made real.
  - Reception got a counter with a screen, a check-in tablet and the gym's name,
    a stool, a kiosk, turnstiles, an entry floor, a sofa and lockers.
  - Daylight now falls under the windows, there's a wall TV, and towel shelves
    and bins are dotted around.
  - The water and rest corner is where people go when they step off a machine.
  - A small limb-drawing helper made seated, reclined and lying poses possible.

**The locker.** The next question was where the gym keeps what you've done. The
obvious answers were a profile page or a history screen at reception. I ruled both
out in my prompt:
- A profile page is the first piece of a fitness dashboard, the thing the README
  says this isn't.
- Reception is where you get in, not where you look back.

So history went into a place in the room: your own locker, in a locker room between
reception and the floor. That gave the app a clear spatial rule, which the
README now states. The floor is what's happening now. The locker is what the gym
remembers. Reception gets you in.

- **Lockers are rows of their own** (number, owner), not a column on the user. The
  room can then show all 36 doors, and later other people's, while
  `GET /api/locker` only ever returns the caller's own. The public floor carries
  only which numbers are taken.
- **Assignment is automatic:** the lowest free number on checking in, or on the
  next read for identities from before lockers existed. The rule for a full room
  was the agent's call, not mine, and I've kept it: the locker of whoever has been
  gone longest goes to the newcomer, and their history stays with them. I've
  flagged it as something to revisit if the gym outgrows a class.
- **What's inside was kept small:**
  - recent visits, each with its sets grouped by exercise
  - visits in the last 7 days
  - the heaviest finished set of each weighted lift

  "This week" became "the last 7 days" because the server doesn't know where your
  week starts. "Best" stayed the plain heaviest set, with no 1RM estimate.
- **Reception lost the history it had.** The welcome-back screen used to say
  "Last visit Sunday, 6 sets". Now it says your locker is still yours, and
  check-in hands you your pass, your locker number and two lines on how the gym
  works.
- **Live state got shorter.** "When I leave, my live presence disappears" didn't
  hold for someone who just closed the tab: they stayed in the gym for three
  hours. Someone idle for 45 minutes is now gone, and their visit is closed at
  their last set. Training and resting already expired sooner.
- **Walking to your locker is local for now.** Your character walks over when you
  open it, but nothing is stored, so others won't see you at your locker until
  that's part of presence.
- **The code follows the places:**
  - `src/lockers.ts` holds what's kept.
  - `src/gym.ts` holds what's live.
  - `public/reception.js` gets you in.
  - `public/locker.js` shows your history.

**A usability pass: walk, then set up.** After shipping crit 8 I sent a
correction list:
- new arrivals should start at the entrance
- the character should walk to a machine before its setup opens
- the corner panel should close
- the barbells should be usable
- add a stair climber and an assisted pull-up
- sets "appear not to be adjustable"

I asked the agent to reproduce that last one before deciding what it was.

- **The set problem wasn't what it looked like.** Driving Chrome with real mouse
  clicks and typing at both screen sizes, the next set's weight and reps could be
  edited, and `60×8` then `65×6` were saved as two separate sets. So the bug as
  reported didn't reproduce. The agent found three gaps that made it feel that
  way instead:
  - Once Start was pressed, the set was frozen. Finish recorded the target, and
    the only way to log fewer reps was to cancel.
  - There was no set number. Between sets the form looked like the first setup
    again, labelled "Reps", so it wasn't clear you were setting up the next set.
  - Every machine took weight + reps or minutes, so there was nowhere for
    treadmill speed, stair-climber level or pull-up assistance.

  The fix:
  - Each set shows its number, counted from this visit.
  - Finish takes the reps or minutes you actually did.
  - Each exercise now asks for one of three metrics: load, assist or time.
- **Walking became a real step.** `/api/approach` notes that you're standing at a
  machine, without holding it or recording anything. The client walks you there
  and opens the setup only on arrival. Between sets, tapping another machine asks
  "Leave your station?"; mid-set, it says to finish or cancel first.
- **Arriving.** A new spot column says where an idle person stands: the entrance
  or the lounge. Opening the gym in a new tab calls `/api/arrive`, which starts
  you at the entrance and drops an unfinished set unrecorded. The agent proposed
  keeping your place on a refresh in the same tab (a `sessionStorage` flag that
  holds no data); I accepted it. Without it, a refresh mid-set would lose the
  set.
- **Equipment.**
  - Two lifting platforms for deadlifts and barbell rows, replacing a decorative
    barbell.
  - Two stair climbers.
  - A dip mode on the existing assisted pull-up machine.
  - A small jointed-figure helper draws the side-on lifts from joint positions,
    instead of a hand-placed rectangle for every frame.
- **The panel closes.** Closing it only hides it. A small button in the top bar
  says what you're doing ("Set in progress 00:42") and brings it back.

Problems in this pass:
- A test collision: one test left its person mid-set on the bench the next test
  needed. Each test now uses its own machine.
- On a phone, the new top-bar button pushed "Gym pass" off the screen. Narrow
  screens now show only the logo, without the gym's name.
- The walk-first check was shown to go red when the setup opened on tap.
- **A set that silently vanished.** After the push, I reported a finished set
  missing from my locker. The server data and the locker code were both fine.
  Reproducing it found the real bug: when a set stopped on the server (the
  ten-minute limit, or the gym opened in another tab), Finish got a 409. The page
  only refetched the floor, not you, so it kept showing "Set 1 in progress", and
  the error was redrawn away. Finish did nothing, and nothing was recorded. A 409
  now refreshes your own state and says the set wasn't recorded and why. The tab
  also catches up when you come back to it. A browser check covers it.

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

There are five tables in one SQLite file at `/data/gym.db`. Users, lockers,
sessions (visits) and sets are history and are kept. Presence is the only live
table, and it expires. `/data` is the Fly volume, the only storage the course setup
keeps across restarts and redeploys. A person is an opaque id plus a 12-character
gym pass, which the browser sends as a bearer token. The browser stores the pass
and nothing else. Typing the pass on another device brings back the same person;
the display name is only a label. Presence is one row per person, rewritten on each
change, and a visit left open for three hours is closed at its last activity. Presence
now also stores the machine, the planned set and when it expires. Every change
goes through six functions in `src/gym.ts` (enter, start, finish, cancel, step
off, leave), which are the events crit 9 will broadcast.

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
- **A test that sampled in step with the animation.** My flow script said the
  treadmill wasn't animating. It sampled every 350 ms, close to two of the
  treadmill's 170 ms frames, so it kept landing on the same frame. The app was
  fine. The spec samples at uneven gaps now.
- **Checks sharing one database.** The phone viewport check found the lat
  pulldown taken: the desktop run's test person was still resting on it. Each
  run now leaves the gym when it's done, and CLAUDE.md says to run the spec on a
  fresh `DATA_DIR`.
- **Art covering art.** The seated dumbbell press's name tag hid the arms doing
  the press, and the water station sat on the "WATER & REST" floor lettering.
  Both were found in screenshots and moved.
- **Furniture in front of lockers.** The first locker-room layout put a sink, a
  towel rail and a plant on the row in front of the bottom bank. The layout
  script, which checks that every machine, locker and lounge spot can be reached
  from the door, flagged eleven lockers nobody could stand at. They were moved.
- **A wrong test, not wrong code.** The full-room locker test expected a returning
  member to get nothing. The rule gave them the locker of someone who had been
  away a day, which is what the rule says. The test was fixed, not the code.
- **Counting the wrong buttons.** The "every machine is tappable" check started
  counting locker doors too. It now counts machines only.
- **A false alarm.** Full-page screenshots showed people faded at desktop width.
  Measuring the computed opacity showed it was 1: the capture was replaying the
  entrance animation. No change was needed.

## Rejected or deferred

- **An event-log table** for crit 9 to read from. Nothing would read it yet, and the
  action functions already give a broadcast one place to hook in.
- **Free roaming (WASD) and a character creator.** You walk where your workout
  takes you, and everyone has one body in their own shirt colour. Both can come
  later without changing the data model.
- **A game engine or sprite image files.** See decision record 2.
- **Editing the reps you actually did at Finish.** The set records what you
  started with. Changing it is one field away, but it wasn't asked for.
- **Rest timer settings.** The rest timer always runs; there's no switch for it.
- **Polling the floor.** I held it back so crit 8 stays about persistence and the
  real-time choice is made deliberately at crit 9. Others appear when the page
  loads, and the README says exactly that.

## Checks, honestly

The first checks were written after the implementation in the same session, so
they never failed against a missing app. Three are exceptions: the viewport sensor
and the returning-browser check were both shown to catch the bug they were written
for. The pixel-world check was shown to go red when animation is switched off,
and the occupancy check went red when the server stopped refusing a second person
on a machine.
Restart persistence is verified by
hand, not in `spec/`, because the spec runs against an app it can't restart.
