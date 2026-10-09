# Wayline: rules for the agent

Wayline is a collaborative travel itinerary planner: a shared trip, an
interactive map and a day-by-day timeline, with real transport times between
consecutive stops and an AI copilot that explains schedule problems. It
replaced the Virtual Gym in October 2026; the gym's history stays in git,
`PROCESS.md`, `reflections/` and `docs/decisions/0001–0002`. `README.md` is
the argument for what good means here. This file holds the rules that follow
from it, and `spec/` holds the parts that can be checked. If a change would
contradict the README, stop and ask. Don't quietly change the product.

> People choose where they want to go. Wayline helps them figure out how to
> get there.

## Product rules

- **The map and the timeline are the product.** The editor is a large map
  beside one day's timeline (tabs on phones). The copilot is a collapsible
  side panel. Don't add dashboards, feeds or panels that compete with them.
- **Direct manipulation first.** Search, add, reorder, retime, resize and
  remove happen on the map and timeline and show at once. Forms are for
  details (notes, exact times), never the only way to act. Every drag has a
  button alternative (move earlier/later, move to another day).
- **Users choose; Wayline connects.** Never add places, reorder the plan or
  change times on the user's behalf. The app suggests; a person accepts.
- **Activities and transport are different things.** An activity is somewhere
  the travellers chose. A transport segment connects two *consecutive*
  activities and is deleted the moment they stop being neighbours. Don't store
  transport as an activity.
- **No chat, comments, reviews, social feeds, bookings, payments, expenses,
  AI-generated trips or multi-day route optimisation** (V1 scope). Ask first.

## Discovery (homepage)

- The homepage is public: anyone can browse curated itineraries, search
  destinations and preview. Trips, copying an itinerary and invites need an
  account.
- Itineraries are Wayline's own templates (`itinerary_templates`,
  `src/curated.ts`), labelled "Curated by Wayline". Never present them as
  user-generated, and never add ratings, view counts or popularity numbers.
- Never write a Google place id by hand. Curated stops carry a search query
  and approximate coordinates; `discovery.ts` stores an id only when Google
  returns a match within 1.5 km, and the UI labels unmatched stops
  "Approximate location".
- Rank by great-circle distance (`haversineKm`, to the template or its
  nearest stop), never by matching city names.
- Location: ask only when the user presses "Use my location"; if refused,
  don't ask again that session. Coordinates are used for the request and
  never stored or logged on the server; the browser keeps a ~1 km rounded copy
  in sessionStorage only.
- When nothing curated is near, show Google places as *individual places*,
  visibly distinct from itineraries.
- Google calls happen on intent only: autocomplete is debounced (300 ms) with
  a session token; details and photos load when a place is opened; routes
  load when "Get travel times" is pressed. Public Google-backed endpoints are
  rate-limited per IP.

## Truthful transportation

- Route data (durations, lines, stops, times, geometry) comes only from the
  Routes API response. Draw a route line only from Google's polyline; the
  dashed stop-order line must stay visibly different. Never estimate, interpolate or invent a route, line, departure or
  fare. If Google can't answer, say why, in the UI.
- Display arithmetic on real data is fine ("arrive ≈ 12:05" = departure +
  Google's duration) but must be labelled as approximate.
- Transit needs a departure time within Google's window (7 days back to 100
  days ahead); say so instead of calling the API outside it.
- Route lookups are explicit (a button) and deduplicated server-side by
  pair + departure. Never call Google on drag, render, or snapshot receipt.
  A time change marks a route *stale*; it doesn't recalculate on its own.
- Demo places (`demo:` ids) are labelled "Demo place" everywhere, have no
  opening hours, and can't be routed.

## The AI copilot

- Deterministic first: `src/schedule.ts` computes end times, gaps, overlaps,
  shortfalls and every candidate fix with its exact edits. The model never
  does time arithmetic and never proposes an edit of its own.
- The model gets structured, verified input (`copilotInput`) and answers with
  ids from it; `validateAnswer` drops anything else. Keep it that way.
- Nothing is applied without an explicit click. `applyProposal` re-derives the
  proposal and refuses (409) if any value it changes has moved since the
  preview.
- With no provider configured the rule-based check still works and the UI
  says AI is unavailable. Never show canned text as if a model wrote it.
- One model call per unchanged day (cached by input hash), per-user rate
  limited, only on request.

## Collaboration and integrity

- The server is authoritative. Every itinerary change goes through
  `createTripStore` in `src/trips.ts`, inside `mutate()`: one transaction, trip
  `rev` bumped, stale segments pruned, then the snapshot broadcast. Persist
  first, broadcast after commit. Don't write to these tables anywhere else.
- Content edits carry `baseVersion`; a mismatch is a 409 with the current
  activity, and the UI offers "load theirs" or "save mine over theirs". Never
  drop the version check to make a conflict go away.
- Adds carry a client-generated `clientId` (unique per trip), so retries and
  reconnect replays can't duplicate.
- Clients ignore snapshots with a lower `rev` than they hold; on reconnect the
  stream sends a fresh snapshot. Real-time is SSE from one in-process hub;
  this holds only while Fly runs one machine (ADR 0003).
- Presence is secondary. It never substitutes for synchronising the plan.

## Access and secrets

- Roles: owner, collaborator, everyone else. Non-members get the same 404 as
  a missing trip. Only owners invite, rename, change dates, delete or remove
  people; collaborators edit the itinerary and can leave.
- Invite links are 256-bit random tokens, stored hashed, shown once, replaced
  or revoked by the owner. Never authorise by trip id alone.
- Sessions are HttpOnly SameSite=Lax cookies (Secure behind Fly's TLS), stored
  hashed. Writes require JSON and a same-origin `Origin`.
- `GOOGLE_MAPS_SERVER_KEY` and `ANTHROPIC_API_KEY` never leave the server.
  `/api/config` is the only place the browser key is exposed, and its key set
  is pinned by `spec/restart.test.ts`. No keys in the repo, ever.
- Google content: store place ids indefinitely; coordinates and route
  options are a temporary copy dropped/refreshed after 30 days; addresses,
  hours and details are fetched live and never stored. Show "Google Maps"
  attribution where Google data appears without a Google map.

## Engineering rules

- **Stack:** Node 24's `http` and `node:sqlite`, TypeScript by type stripping
  (erasable syntax only: no `enum`, no parameter properties, imports end in
  `.ts`). Client is hand-written HTML/CSS/JS modules in `public/` with no build
  step: `app.js` (routing, nav, auth, dashboard, join), `home.js` (the
  discovery homepage), `preview.js` (itinerary preview), `places.js` (place
  inspector), `editor.js` (the trip workspace), `map.js` (Google map or
  labelled schematic), `ui.js` (helpers). Server-side Google calls live only
  in `src/google.ts`, behind `src/discovery.ts` and the trip routes.
  **Add no runtime dependency without asking.** The AI provider uses `fetch`
  for this reason.
- Build DOM with `h()`; user text goes in as text nodes, never `innerHTML`.
- **Storage:** `DATA_DIR/wayline.db` (`/data` on Fly). Schema changes are
  additive. The old `gym.db` beside it is left untouched as the gym's record.
- **Validate on the server.** Bad input is a 400 that writes nothing.
- **Starter contract:** `/` answers 200; `/readme/` serves `README.md` in full,
  server-rendered; listen on `0.0.0.0:$PORT`. Don't touch `fly.toml`'s machine,
  volume or region settings, or `spec/invariants.test.ts`.

## Before calling something done

- Start the app on a fresh `DATA_DIR` (`pnpm start`) and run `pnpm check`;
  both must be green. `pnpm check:evidence` too before a crit.
- For UI changes, look at it at 1920×1080 and 390×844 in a real browser.
  `spec/browser.test.ts` checks layout at both, keyboard reordering,
  persistence after reload, and two browsers seeing each other's changes.
- A testable README promise belongs in `spec/`. When a check is added for a
  bug, break the code once to see it fail.
- Never claim a Google or AI integration works unless it has been exercised
  with real credentials; say what was and wasn't verified.
- Don't write first-person process claims, research or reflections for the
  student. Factual notes go in `docs/`.
- When I correct the same mistake twice, the fix goes here or into `spec/`.
