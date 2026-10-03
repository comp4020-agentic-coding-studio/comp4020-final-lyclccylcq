# Same Gym: rules for the agent

Same Gym is a shared gym floor: people train on their own, and they can see who
else is in and what they're doing. `README.md` is the argument for what good means
here. This file holds the rules that follow from it, and `spec/` holds the parts
that can be checked. If a change would contradict the README, stop and ask. Don't
quietly change the product.

> A good virtual gym should make individual training feel shared without turning
> exercise into a meeting, competition, or social feed.

## Product rules

- **Spatial presence before social networking.** Other people appear on the
  floor, at the station where they're training. Never in a sidebar list, a
  roster or a feed.
- **The floor shows the present, not a history.** There's no feed or scrollback of
  anyone's activity. Others see only who you are, which station, which exercise,
  and whether you're training or resting.
- **Numbers are private.** Weights and reps belong to their owner: they appear in
  your own panel and on your own label, never in `/api/floor` or on anyone
  else's view. No rankings, scores, streaks, badges or leaderboards unless I
  explicitly ask.
- **The space has to show its capacity.** Every station draws open spots, and
  people take a spot rather than a random point, so an empty gym still reads as a
  room for several people and labels don't pile up. A new station or exercise
  needs a place on the floor; don't add exercises that have no clear station.
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
- **Phones are first-class.** Every change must work at 390px wide, without
  shrinking the desktop map until it's unreadable: the floor reflows to a
  two-column map with the panel underneath. Check both widths before calling UI
  work done.
- **Design for a handful of people at once**, about one class: five stations with a
  few spots each. Don't build for scale the room can't show.

## Real-time (crit 9)

Real-time is still to come: right now other people appear only when the page
loads. When it arrives:

- Broadcast from the four action functions in `src/gym.ts`, sending the same public
  shape as `/api/floor` (never a pass, never numbers).
- Other people's changes should move their dot on the floor, not post a
  notification or add a list item.
- Choose the transport deliberately and record why in a decision record in
  `docs/decisions/`. Server-sent events need no dependency; WebSockets would.
- Until then, don't describe the app as real-time anywhere: not in `README.md`, the
  UI copy or `PROCESS.md`.

## Engineering rules

- **Stack:** Node 24's own `http` server and `node:sqlite`, TypeScript run directly
  by Node (type stripping, so only erasable syntax: no `enum`, no parameter
  properties, and imports end in `.ts`). The client is hand-written HTML, CSS
  and JS in `public/`, with no build step. **Add no runtime dependency without
  asking.**
- **Storage:** one SQLite file under `DATA_DIR` (`/data` on Fly, the only place that
  survives a redeploy; `./data` locally). Schema changes must be additive (`create
  ... if not exists`, a new column with a default), because the live database
  already has people in it.
- **Identity:** a user is an opaque id. The display name is a label: never look
  anyone up by name. The gym pass is a secret. It is returned only to its owner
  (`/api/me`) and must never appear in `/api/floor` or anything public.
- **Every state change goes through `src/gym.ts`** (enter, choose, set, leave). They
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
  catches labels spilling out of zones, cramped inputs and sideways scroll, but
  only a person can judge whether it still feels like a room.
- A promise the README makes that can be tested belongs in `spec/`. When you add
  or change one, add or change its check.
- When I correct the same mistake twice, the fix goes here or into `spec/`, not
  into another retry.
