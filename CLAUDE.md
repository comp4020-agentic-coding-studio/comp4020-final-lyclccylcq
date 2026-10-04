# Same Gym: rules for the agent

Same Gym is a persistent pixel-art gym in which real workout activity controls
what your character is doing. People train on their own, in one shared room, and
can see who else is in and what they're doing. It is not a workout tracker drawn as
a gym: the room is the product, and logging is how you act in it. `README.md` is the argument for what good means
here. This file holds the rules that follow from it, and `spec/` holds the parts
that can be checked. If a change would contradict the README, stop and ask. Don't
quietly change the product.

> A good virtual gym should make individual training feel shared without turning
> exercise into a meeting, competition, or social feed.

## Product rules

- **The gym is the main view.** The pixel room fills the screen; the set panel is
  a small card over it (a bottom sheet on phones). Don't add dashboards, stats rows
  or history pages that compete with the room.
- **The equipment starts the workout.** Tapping a machine opens its setup
  (exercise if it has several, weight, reps or minutes). Nothing changes until
  Start set. Don't bring back an exercise list as the main way in.
- **Idle → training → resting.** Start set stores the plan and nothing else.
  Finish set records the set and moves you to resting at the machine. Cancel
  records nothing. Never create a set anywhere but `finish`.
- **Activity → place → animation.** Starting a set moves the character to that
  machine and plays its pose; finishing puts them in the resting pose beside it;
  stepping off sends them to the water. Never let a change of activity show only
  as text.
- **The floor is now; the locker is what's kept.** Current activity (presence,
  machine, state) is live and expires. History (visits, sets, heaviest sets) is
  kept and is read by opening your own locker in the locker room. Don't add a
  profile page, an account dashboard or a global "history" button. Reception
  checks you in and explains the gym; it doesn't show history.
- **Lockers are entities.** `lockers` rows are a number and an owner. The room
  shows numbers and whether each is taken, never who has it. `GET /api/locker`
  returns only the caller's own. Never key a locker or anything else by display
  name. When other people are live (crit 9), keep their lockers shut.
- **Don't widen the locker into a fitness platform.** No charts, calories, body
  weight, streaks or 1RM estimates. A "best" is the heaviest finished set of a
  weighted lift, nothing computed.
- **Spatial presence before social networking.** Other people appear in the
  room, on the machine they're using. Never in a sidebar list, a roster or a
  feed.
- **The floor shows the present, not a history.** There's no feed or scrollback of
  anyone's activity. Others see only who you are, which station, which exercise,
  and whether you're training or resting.
- **Numbers are private.** Weights and reps belong to their owner: they appear in
  your own panel and on your own label, never in `/api/floor` or on anyone
  else's view. No rankings, scores, streaks, badges or leaderboards unless I
  explicitly ask.
- **One machine, one person.** Each physical machine (`bench-a`, `bench-b`, …) is
  its own station. The server records who is on it and refuses a second person
  (409). Several machines share a kind, its exercises and its art.
- **Adding equipment is three edits, all data:** a kind with its exercises and
  poses in `src/equipment.ts`, footprints in `MACHINES_AT` in `public/world.js`
  (in machine order), and a `draw(r, colour, frame, pose)` in `KINDS` in
  `public/sprites.js`. Don't add an exercise the gym can't show someone doing,
  and don't add a machine-looking thing that can't be used: furniture must read
  as furniture.
- **No messaging, comments, voice or video.** If co-presence ever needs a signal
  between people, it is a lightweight, ephemeral reaction, and only when I ask.
- **Don't add a feature because fitness apps usually have one.** That rules out
  plans, programmes, AI coaching, nutrition, charts and personal records. Ask
  first.
- **Interactions stay light.** Logging a set is: pick an exercise, adjust weight
  and reps (prefilled from your last set of that exercise), Finish set. Don't add
  required fields or steps.
- **Persistence is part of the experience.** Whatever someone does is stored on
  the server. Coming back (refresh, tomorrow, another device with the gym pass)
  puts them where they were. `localStorage` holds only the gym pass, never workout
  data or state.
- **Persist meaning, derive the picture.** The server stores what someone is doing
  (machine, exercise, state, planned set, since when, when it expires). Position,
  route, pose and frame are derived in `world.js` and never stored.
- **Nobody trains forever.** An unfinished set expires unrecorded after 10 minutes
  (plus its planned minutes if timed), and a rest after 15. Both free the machine.
  Someone idle for 45 minutes has gone home: they're marked away and their visit
  closes at their last activity. Expiry happens when state is read; there is no
  background job.
- **`presence` is the only live table.** Everything else (users, lockers,
  sessions, sets) is history and is never rewritten by expiry.
- **Phones are first-class.** Every change must work at 390px wide. On a phone
  the screen is a camera onto the same gym at 2× pixels (3× on desktop). Never
  shrink the world to fit. Check both widths before calling UI work done.
- **Design for a handful of people at once**, about one class: two or three
  machines per station. Don't build for scale the room can't show.

## Pixel art rules

- All art is drawn in code in `public/sprites.js`: rectangles on one world-pixel
  grid, the shared palette `P`, a 1 px `INK` outline added by `make()`. Don't load
  image assets, and never copy another product's sprites or maps (Gather was a
  reference for scale and feel only).
- The canvas is scaled by whole numbers with `image-rendering: pixelated`. No
  smoothing, no fractional zoom.
- Animations are two frames. Clarity beats detail: the pose should say the
  exercise at a glance.
- Text people read (name tags, the panel, the door) is HTML over the canvas, not
  pixels: it has to stay readable and accessible.

## Real-time (crit 9)

Real-time is still to come: right now other people appear only when the page
loads. When it arrives:

- Broadcast from the action functions in `src/gym.ts` (enter, start, finish,
  cancel, stepOff, leave), sending the same public
  shape as `/api/floor` (never a pass, never numbers).
- Feed it to `world.setPeople()`, which already treats everyone as an entity: a
  newcomer walks in from the door, a changed exercise walks to the new machine,
  someone leaving walks out. Other people's changes move their character, not a
  notification or a list item.
- Choose the transport deliberately and record why in a decision record in
  `docs/decisions/`. Server-sent events need no dependency; WebSockets would.
- Until then, don't describe the app as real-time anywhere: not in `README.md`, the
  UI copy or `PROCESS.md`.

## Engineering rules

- **Stack:** Node 24's own `http` server and `node:sqlite`, TypeScript run directly
  by Node (type stripping, so only erasable syntax: no `enum`, no parameter
  properties, and imports end in `.ts`). The client is hand-written HTML, CSS
  and JS in `public/`, with no build step: `reception.js` (check-in, how-to),
  `locker.js` (your history), `app.js` (the floor's panel and wiring),
  `world.js` (layout, people, routes, camera, the canvas loop) and `sprites.js`
  (the art). **Add no runtime dependency without
  asking.**
- **Storage:** one SQLite file under `DATA_DIR` (`/data` on Fly, the only place that
  survives a redeploy; `./data` locally). Schema changes must be additive (`create
  ... if not exists`, a new column with a default), because the live database
  already has people in it.
- **Identity:** a user is an opaque id. The display name is a label: never look
  anyone up by name. The gym pass is a secret. It is returned only to its owner
  (`/api/me`) and must never appear in `/api/floor` or anything public.
- **Every state change goes through `src/gym.ts`** (enter, start, finish, cancel,
  stepOff, leave). They
  are the events the live floor will broadcast, so keep them as single functions
  rather than scattering writes.
- **Validate on the server.** The client's checks are a convenience; the server
  rejects bad input with a 400 and writes nothing.
- **Starter contract:** `/` answers 200; `/readme/` serves `README.md` in full,
  rendered on the server with no script needed; the app listens on
  `0.0.0.0:$PORT`. Don't touch `fly.toml`'s machine, volume or region settings, or
  `spec/invariants.test.ts`.

## Before calling something done

- Start the app (`pnpm start`) and run `pnpm check`. Both must be green.
- For UI changes, look at it at 1920×1080 and 390×844. `spec/viewports.test.ts`
  catches a shrunk or blurred world, a machine you can't tap, a tap that starts
  a set instead of setting one up, a camera that loses you, a machine that
  doesn't animate, overlapping name tags and cramped inputs.
  `spec/lifecycle.test.ts` covers expiry and old data with a fake clock. Run the
  spec on a fresh `DATA_DIR`: people left on machines in a local database will
  make the browser checks find them taken. Only a person can
  judge whether it still feels like a gym.
- A promise the README makes that can be tested belongs in `spec/`. When you add
  or change one, add or change its check.
- When I correct the same mistake twice, the fix goes here or into `spec/`, not
  into another retry.
