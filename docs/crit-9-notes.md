# Crit 9 notes (factual record, written by the agent)

Raw material for `PROCESS.md` and `reflections/crit-9.md`, which the author
writes. Nothing here is a first-person claim about the author's process.

Crit 9 brief ("All at once"): the app is real-time by the brief's definition
and deployed by the cutoff; one decision about how the app behaves with
several people is written down with options and costs; the repo shows the
process (commits, `PROCESS.md`, `reflections/crit-9.md`); the author can
account for how they directed, grounded and corrected the work.

## What already existed before this crit's session

Built during the Wayline pivot (commits `6305228`, `0953ec9`):

- SSE hub (`src/realtime.ts`): one stream per open editor on
  `/api/trips/:id/events`, whole-trip snapshot after every committed change,
  `retry: 2000`, 20 s keep-alive comments, presence ("N people are planning
  this trip"), streams of removed members closed.
- Server-authoritative store (`src/trips.ts`): every change in one SQLite
  transaction via `mutate()`, trip `rev` bumped, then broadcast. Clients
  ignore snapshots with a lower `rev`; the first event on any stream is a
  fresh snapshot, so a reconnect catches up.
- Concurrency: per-activity `baseVersion` → 409 with the current activity;
  the edit dialog offers "load theirs" or "save mine over theirs". Moves need
  no version. Adds are idempotent by `clientId`.
- Sharing: owner/collaborator roles; 256-bit invite links stored hashed,
  replaceable and revocable; non-members get the same 404 as a missing trip.
- ADR 0003 (`docs/decisions/0003-sse-snapshots-and-versioned-edits.md`):
  status "proposed", drafted by the agent, awaiting the author's decision.
- Deployment: `fly.toml` runs one machine; CI deploys with `--ha=false`. The
  in-memory hub depends on that (stated in `realtime.ts`, CLAUDE.md, ADR 0003).

## Changed in this session (2026-10-12)

| Gap found | Change | Test |
|---|---|---|
| Two simultaneous start changes: the second silently replaced the first | `PUT /start` takes `baseVersion`; mismatch → 409 with the current start; the panel explains and allows a deliberate retry | `spec/start.test.ts` "refuses a change based on a start someone else has replaced" |
| A collaborator's change re-fitted everyone's map (zoom/position reset) | Snapshots from the stream pass `keepView`; only the person's own actions move their map | checked by reading the code path; the CI map is the schematic, so not covered by an automated test |
| Route request on someone else's trip returned 503 (no key) before the membership check | membership checked first (404) | `spec/start.test.ts` "can't be set or routed on someone else's trip" |
| No two-browser test for remove, retime or start change | added | `spec/browser.test.ts` "collaborating live, every kind of change" |

Decisions asked of the author in this session: view-only links — not now
(owner/collaborator kept); PROCESS.md — the author writes it, from these notes.

## Results

- `pnpm check`: 13 files, 94 tests passing (fresh `DATA_DIR`, no keys).
- End-to-end latency, two Chrome sessions on one machine, local server, from
  the sender's request to the receiver's render, n=10 each: add 29 ms, reorder
  31 ms, retime 31 ms, remove 29 ms (medians; max 34 ms).
- Real dropped connection: the server was restarted with both pages open. The
  receiver showed "Reconnecting…", reconnected by itself, and showed a change
  made after the restart 786 ms after it was made, with no reload.
- Production latency (commit `b4bb133`, Fly `syd`, one machine), two Chrome
  sessions (1440×900 and 390×844) on the author's machine against
  https://comp4020-final-lyclccylcq.fly.dev, same method, n=10 each: add
  median 30 ms (max 63), reorder 39 ms (max 42), retime 42 ms (max 48),
  remove 31 ms (max 86). Both sessions ended with identical timelines.
  Devices on another network will add their own network time.
- Production access check: a signed-in outsider got 404 for reading the
  trip, opening its live stream, changing its start and renaming it; the
  owner's trip was unchanged.
- Not tested on production: reconnect after a server restart (local only).

## Known limits

- One Fly machine only: a second machine would split the hub (ADR 0003).
- Whole snapshots: a few KB per change; fine at tens of stops.
- Two people editing the same activity's text at once: the second must
  choose; no text merge.
- No view-only links.

## What the author needs to supply for `reflections/crit-9.md`

- Which multi-user decision you are presenting, and whether you accept,
  amend or reject ADR 0003 as drafted (its status line still says
  "proposed").
- Why that choice fits what `README.md` says good means, in your words.
- The option your pod is likely to argue for, and your answer to it.
- How you directed this session: what you asked for, what you chose when
  asked (view-only, PROCESS.md), and anything you corrected or rejected.
- What you saw at the crit itself (devices, what synced, what didn't).
