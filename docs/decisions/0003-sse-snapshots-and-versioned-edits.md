# 3. Live updates: SSE with whole-trip snapshots, versioned edits

Date: 2026-10-09 · Status: proposed (drafted by the agent during the Wayline
pivot; for the author to accept, amend or reject)

## Context

Wayline needs a change by one collaborator to appear in every other open
editor within about a second, with the server as the authority. The app is one
Node process on one `shared-cpu-1x` Fly machine with 256 MB, and adds no
runtime dependencies (ADR 0001). Trips are small: a few days, tens of
activities.

## Options

- **WebSockets.** Two-way, but needs a dependency or a hand-rolled protocol,
  and edits already travel well as ordinary POST/PATCH requests.
- **Polling.** Simple, but a one-second target means a request per second per
  open tab, mostly answering "nothing changed".
- **Server-sent events** from Node's own `http`, with edits still sent as
  normal requests. EventSource reconnects by itself and sends cookies, so
  authorisation is the same as for every other route.

For the payload:

- **Diffs** are smaller but every client must merge them correctly, and a
  missed event leaves it wrong until reload.
- **Whole-trip snapshots** cost a few KB per change but can't drift: the
  client shows the highest revision it has seen.

For concurrent edits:

- **Last write wins** silently overwrites a collaborator.
- **Per-activity versions** (optimistic concurrency) refuse an edit based on
  an outdated version.
- **CRDTs/OT** solve simultaneous text editing, which V1 doesn't need.

## Decision

SSE on `/api/trips/:id/events`; after each committed transaction the server
sends the full snapshot (with a monotonically increasing `rev`) to every
member's open stream. Content edits carry `baseVersion` and get a 409 with the
current activity on mismatch; the editor offers to load theirs or save over
it. Moves need no version (the server places the item among the current
order). Adds are idempotent by `clientId`.

## Consequences

- No dependency; reconnect reconciliation is free, because the first event on
  any stream is a fresh snapshot.
- The hub is in memory. It's correct only while Fly runs a single machine;
  a second machine would need a shared channel (e.g. SQLite polling or a
  pub/sub service).
- Snapshot size grows with the trip; fine at tens of activities, worth
  revisiting at hundreds.
- Two people editing the *same* activity's notes at once: the second save is
  refused and must choose. No automatic merge of text.
