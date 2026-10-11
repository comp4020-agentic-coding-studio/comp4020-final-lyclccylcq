# 3. Several people on one trip: live snapshots over SSE, versioned edits

Date: 2026-10-09 (proposed) · updated 2026-10-12 · Status: accepted
(implemented and verified in production; drafted by the agent, accepted at
the author's request after the Crit 9 checks below)

## Context

Wayline's group plans one trip together: a map beside a day-by-day timeline.
`README.md` defines good partly as "there is one shared plan, never
diverging copies", "people decide" and "a private trip stays private", and
promises that a change "appears within about a second" while "an edit made
against an outdated version is refused instead of silently overwriting
someone". The app is one Node process on one `shared-cpu-1x` Fly machine with
256 MB and no runtime dependencies (ADR 0001). Trips are small: a few days,
tens of stops.

## Problem

When two people have the same trip open, what should each of them see, and
what happens when both change the same thing? A fast transport alone doesn't
answer that: the app also has to decide which state is shared, how
simultaneous edits behave, and how one person's actions avoid disrupting
another's screen.

## Options considered

How changes travel:

- **WebSockets**: two-way, but a dependency or a hand-rolled protocol, and
  edits already work as ordinary HTTP requests.
- **Polling**: simple, but a one-second target means a request per second per
  open tab, mostly answering "nothing changed".
- **Server-sent events** from Node's own `http`, with edits as normal
  requests. EventSource reconnects by itself and sends cookies, so
  authorisation is the same as for every other route.

What travels:

- **Diffs**: smaller, but every client must merge them correctly, and a
  missed event leaves it wrong until reload.
- **Whole-trip snapshots**: a few KB per change, but a client can't drift; it
  shows the highest revision it has seen.

When two people change the same thing:

- **Last write wins**: simple, but silently overwrites a collaborator, which
  breaks the README's promise.
- **Optimistic concurrency** (versions): an edit based on an outdated version
  is refused with the current state, and the person chooses.
- **CRDTs or operational transformation**: merge simultaneous edits
  automatically; built for shared text, which a trip of short fields doesn't
  need, at the cost of a dependency and much harder reasoning.

## Decision

- Edits are HTTP requests. Each runs in one SQLite transaction that bumps the
  trip's `rev`, then the server sends the whole snapshot to every member's
  open stream on `/api/trips/:id/events`. Clients ignore a snapshot older
  than the one they have; the first event on any stream is a fresh snapshot,
  so a reconnect catches up.
- Content edits carry `baseVersion`. A mismatch is a 409 with the current
  activity; the edit dialog offers "load theirs" or "save mine over theirs".
  Changing the starting point is versioned the same way. Adds are idempotent
  by `clientId`, so two people adding at once both keep their stop.
- Order needs no version because the server owns it: timed stops sit where
  their time puts them, untimed ones in the order people chose.
- Only shared itinerary data is live. A snapshot from the stream updates the
  timeline and markers but never moves another person's map; open panels,
  search results and exploring stay in each browser. Where each tab's map is
  looking is shared as separate, transient presence events: in memory with
  the stream, never saved, never a revision.

## Rationale

Snapshots plus versions keep "one shared plan" true without merge logic:
there is only ever the server's copy, and a conflict becomes a visible
choice for a person ("people decide") rather than something the app resolves
silently. SSE needs no dependency and reuses cookie authorisation, so a
non-member gets the same 404 on the stream as anywhere else ("a private trip
stays private"). Keeping map views out of the shared state follows the same
reasoning: a collaborator's change shouldn't take over your screen.

## Consequences

- Measured (two Chrome sessions, n=10 each): a change reached the other
  session in a median of 29–31 ms on a local server and 30–42 ms on
  production (max 86 ms). After a local server restart with both pages open,
  the other page reconnected by itself and showed a new change 0.8 s after
  it was made. A signed-in outsider got 404 for the trip, its stream and its
  edits. Records: `docs/crit-9-notes.md`; checks in `spec/realtime.test.ts`,
  `spec/browser.test.ts`, `spec/start.test.ts`, `spec/order.test.ts`.
- Reconnect reconciliation is free: no event log, no replay.
- Two people editing the same stop's text at once: the second save is refused
  and must choose. There's no automatic merge of text.

## Limitations

- The hub is in memory, so this holds only while Fly runs one machine
  (deploys use `--ha=false`). A second machine would need a shared channel,
  such as SQLite polling or a pub/sub service.
- Snapshot size grows with the trip: fine at tens of stops, worth revisiting
  at hundreds.
- Reconnect after a restart was measured locally, not on production.

## History

- 2026-10-09: proposed with SSE, snapshots, per-activity versions and
  version-free moves.
- 2026-10-12 (Crit 9): the starting point got its own version check (two
  simultaneous start changes used to keep only the last); remote snapshots
  stopped moving other people's maps; map-view presence was added as
  transient events.
- 2026-10-12: moves of timed stops within a day were replaced by time-based
  ordering, so order is decided by the server from the times people set.
