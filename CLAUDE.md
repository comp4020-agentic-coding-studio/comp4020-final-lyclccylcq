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
- **Direct manipulation first.** Search, add, retime, resize, change place
  and remove happen on the map and timeline and show at once. Forms are for
  details (notes, exact times), never the only way to act. Every drag has a
  button alternative (change time, move earlier/later, move to another day).
- **A day follows its times.** The server keeps each day in order: the
  starting point, then timed stops by time (equal times keep their existing
  order), then untimed stops in the order people chose. Adding or retiming
  puts a stop where its time belongs; a timed stop moves within its day only
  by changing its time ("Change time"; a drop on the timeline opens it), and
  only untimed stops have move earlier/later. Ordering never replaces,
  recreates or retimes a stop.
- **Users choose; Wayline connects.** Never add places, change times or
  replace stops on the user's behalf. The app suggests (a meal's usual time,
  a free slot); a person accepts. Overlaps are shown, never fixed silently.
- **Activities and transport are different things.** An activity is somewhere
  the travellers chose. A transport segment connects two *consecutive*
  activities and is deleted the moment they stop being neighbours. Don't store
  transport as an activity.
- **The starting point is the first activity of the first day** (`role =
  'start'`, set through `PUT /api/trips/:id/start`). Nothing is added or moved
  ahead of it and it can't be moved; changing it updates it in place and drops
  only the routes touching it. A new trip asks "Where would you like to
  start?" once (the `?new=1` link from creation); existing trips are never
  interrupted, and a trip without a start is still valid.
- **The map is a way to choose, never to add.** In the editor, clicking a
  Google place icon opens its panel; clicking anywhere else shows a marker and
  nearby places. Adding always takes the button. A place already in the plan
  says so, and adding it again is a deliberate "Add another visit".
- A spot picked on the map that isn't a Google place is stored with its own
  coordinates and a `custom:<uuid>` id (source `custom`). It's routed by
  coordinates, labelled "Pinned spot", and never given a made-up Google id.
  Its coordinates are the travellers' choice, so they don't expire.
- **No text chat, comments, reviews, social feeds, bookings, payments,
  expenses, AI-generated trips or multi-day route optimisation** (V1 scope).
  Ask first. The one authorised exception (October 2026) is the two-person,
  audio-only voice call between members of a trip (see "Voice calls"); it
  doesn't open the door to text chat, video, group calls or recording.

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
- Location: the browser's permission prompt appears only after the user
  presses "Use my location" (the first-visit card or the hero button); "Not
  now" and a refusal are remembered, and a refusal is never re-asked. The
  current location and the chosen destination are kept apart; the destination
  wins while set, and changing it never changes the current location.
  Coordinates are used for the request and never stored or logged on the
  server. The browser keeps ~1 km rounded copies in localStorage, and refreshes
  the location at most once per visit, only if the user said yes before and
  the browser still grants permission. No continuous tracking (no
  `watchPosition`). The privacy page (`/privacy`) must describe this.
- When nothing curated is near, show Google places as *individual places*,
  visibly distinct from itineraries. The "Explore places on the map" section
  (`public/explore-map.js`) is the same: places, never routes or itineraries.
- Google's errors reach users only as the plain messages from
  `describeGoogleError` in `src/google.ts`; raw Google errors go to the server
  log, and the server key never goes anywhere.
- Locally, keys live in `.env` (gitignored, read by `pnpm dev`/`pnpm start`
  via Node's `--env-file-if-exists`); on Fly, in `fly secrets`. `pnpm
  check:google` runs the live checks against a running app; `spec/` only ever
  mocks Google.
- Google calls happen on intent only: autocomplete is debounced (300 ms) with
  a session token; details and photos load when a place is opened; nearby
  places load on a map click (one request per category per click, reused when
  switching back); routes load when a route button is pressed. Public
  Google-backed endpoints are rate-limited per IP.
- Cover photos for curated itineraries and destinations are freely licensed
  Wikimedia Commons files, resized into `public/img/covers/` and listed in
  `public/photos.js` with author, license and source page. Every one is
  credited on its card or on `/credits`. Never hotlink or scrape images. A
  missing photo falls back to the gradient, never a broken image. My Trips
  cards use the same photos (`cover` from `trips.list`): the curated
  itinerary a trip was copied from (`dest_place_id` `tpl:`), else the curated
  city within 100 km of its destination or first stop, else the colour band.
  No Google request is made for them.
- Google place photos appear in a place's panel when it's opened, and as small
  thumbnails (160 px) in the editor's map-click nearby list only
  (`/api/places/nearby?rich=1`, which counts double against the rate limit).
  Each shows Google's author credit. Not on cards, search results or the
  homepage lists.
- In the editor, the place card is for reading and the scheduling card is
  for adding. The place card (`?view=guide`, the only request for Google's
  editorial summary, reviews and attributes, billed at the Enterprise +
  Atmosphere rate) shows only what Google returns: no scheduling inputs, no
  invented descriptions, and up to three of Google's reviews, unedited, with
  author links (long ones shortened until opened). Missing data is said
  plainly ("Google has no description…", "No Google reviews…"). "Add to
  Itinerary" opens the scheduling card (day, arrival, length, notes); nothing
  is sent or shared until "Confirm & add", and Cancel sends nothing. The
  suggested arrival is the previous stop's end, never a guessed travel time.

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
  Adding, removing, reordering or changing the start doesn't either: the
  affected legs show "Route not calculated", and "Calculate N missing routes"
  looks up only those.
- Demo places (`demo:` ids) are labelled "Demo place" everywhere, have no
  opening hours, and can't be routed.

## The AI copilot

- Deterministic first: `src/schedule.ts` computes end times, gaps, overlaps,
  shortfalls and every candidate fix with its exact edits. The model never
  does time arithmetic and never proposes an edit of its own.
- It reviews a day ("Review this day") and answers questions about the
  selected day, with or without issues, in the asker's language (Chinese or
  English). The day being discussed is always shown.
- The model gets structured, verified input (`copilotInput`, the selected day
  only) and answers with issue, proposal and activity ids from it;
  `validateAnswer` drops anything else. Keep it that way. Titles and notes
  are untrusted data inside `<day_data>`, never instructions.
- Every answer carries the day `fingerprint` it analysed; the UI marks it
  stale when the day changes, and `applyProposal` with an old `basedOn` is a
  409 that writes nothing. Applying needs a preview and a "Confirm change".
- Numbers shown come from the snapshot (`dayFacts`, issue messages, proposal
  previews), never from the model's text; model text is labelled "AI
  interpretation" and rendered as text nodes.
- With no provider configured the rule-based check and editing still work
  and the UI says AI is unavailable. Never show canned text as if a model
  wrote it. Users never see env var names or raw provider errors
  (`describeAiError`).
- Model calls only on request: never on render, map movement or snapshot
  receipt. Cached by model + day input + question + history + language;
  identical in-flight requests share one call; per-user per-minute and
  per-day limits and a global daily ceiling (`WAYLINE_AI_*`); bounded
  question (500), history (4 turns) and output; a timeout and cancellation.
- The conversation lives in the asking tab only. `spec/` only mocks the
  provider; `pnpm check:ai` is the separate live check.

## Voice calls

- Two members of the same trip, audio only, one call per person (across all
  their tabs). Media is native WebRTC between the browsers or via TURN;
  audio never touches the server, the AI, a recorder or a transcriber.
- Signalling (`src/calls.ts`, ADR 0004): authenticated same-origin POSTs
  under `/api/trips/:id/call`, delivered as targeted `call` events on the
  trip's SSE stream to the intended person's tab only. Sender identity comes
  from the session cookie; every action re-checks membership. The tab id
  must belong to a stream that user has open.
- Call state is in memory only: never saved, never a revision, never
  `mutate()`. No SDP, ICE candidate or audio is stored or logged. Messages
  are size- and rate-limited; invitations expire (30 s); a vanished tab gets
  a 20 s grace; calls end at 4 h. Single-machine, like the hub (ADR 0003).
- Hang-up, leaving the editor, sign-out and losing membership all end the
  call, tell the peer and stop the microphone. A reconnecting stream gets
  `resume` and never a replay of old offers or candidates.
- The microphone is requested only after Call or Accept. Denied, missing
  and busy devices, and blocked autoplay ("Turn on sound"), get plain
  messages.
- TURN credentials are short-lived, minted server-side per request
  (`POST /call/ice`, rate-limited); the TURN API token or shared secret never
  reaches the browser. Never embed public relay credentials. Don't call
  calling production-ready from same-machine or same-Wi-Fi tests;
  `spec/browser-call.test.ts` proves signalling and media on one machine,
  not NAT traversal.

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
- Changing the starting point carries `baseVersion` too (the start's version
  when choosing began, `null` if none); a mismatch is a 409 with the current
  start, never a silent replace. The field is required: a request without it
  is a 400 that writes nothing. (Leaving it optional let a request without it
  overwrite the start; the Crit 9 audit reproduced that in production.)
- Only shared itinerary data is live. A snapshot from the stream updates the
  timeline and markers but never moves someone's map (`keepView`); zoom, open
  panels, search results and exploring stay local to each browser.
- Where each tab's map is looking (centre, zoom, heading; never the device's
  location) is shared live with the others on the trip: `POST /view` with the
  tab's session id, relayed by the hub as `view` / `view-gone` events, kept
  in memory with the stream, never saved, never a revision, dropped after a
  minute without updates. It's sent only while someone else is on the trip,
  throttled to 400 ms, and the map says it's shared. Others' views show as a
  coloured marker or an edge arrow; jumping to one is a click, never automatic.
- Meals: a food stop can carry a meal (breakfast, brunch, lunch, afternoon
  tea, dinner). Each trip has usual meal times (`mealTimes`, owner-edited in
  Trip settings); picking a meal suggests its usual time, or the nearest free
  slot in its range, and says so. Nothing is replaced.

## Access and secrets

- Roles: owner, collaborator, everyone else. Non-members get the same 404 as
  a missing trip. Only owners invite, rename, change dates, delete or remove
  people; collaborators edit the itinerary and can leave.
- Invite links are 256-bit random tokens, stored hashed, shown once, replaced
  or revoked by the owner. Never authorise by trip id alone.
- Sessions are HttpOnly SameSite=Lax cookies (Secure behind Fly's TLS), stored
  hashed. Writes require JSON and a same-origin `Origin`.
- `GOOGLE_MAPS_SERVER_KEY`, `ANTHROPIC_API_KEY` and the TURN secrets
  (`CLOUDFLARE_TURN_API_TOKEN`, `WAYLINE_TURN_SECRET`) never leave the server.
  `/api/config` is the only place the browser key is exposed, and its key set
  is pinned by `spec/restart.test.ts`. No keys in the repo, ever. Browser
  and server Maps keys are different keys with different restrictions
  (`docs/google-maps-keys.md`).
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
  `spec/browser-call.test.ts` runs calls between two Chrome instances whose
  fake microphones play different tones, and checks each hears the other's.
- A testable README promise belongs in `spec/`. When a check is added for a
  bug, break the code once to see it fail.
- Never claim a Google or AI integration works unless it has been exercised
  with real credentials; say what was and wasn't verified. The same for
  calls across networks and TURN relay.
- Don't write first-person process claims, research or reflections for the
  student. Factual notes go in `docs/`.
- When I correct the same mistake twice, the fix goes here or into `spec/`.
