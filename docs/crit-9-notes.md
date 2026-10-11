# Crit 9 notes (factual record and evidence pack, written by the agent)

Raw material for `PROCESS.md` and `reflections/crit-9.md`, which the author
writes. The course is explicit that both are the author's own account
("written by you"; "an agent can help you find sources, check citations or
spot a gap"), so nothing here is a first-person claim or a draft of either.
Every commit below exists in this repo; links go to GitHub.

Crit 9 brief ("All at once"): the app is real-time by the brief's definition
and deployed by the cutoff; one decision about how the app behaves with
several people is written down with options and costs, and the author can say
why; the repo shows the process (commits, `PROCESS.md`, `reflections/crit-9.md`);
the author can account for how they directed, grounded and corrected the work.
Indicative lengths: `PROCESS.md` grows towards 900–1100 words (rewritten at
each crit); a reflection is 150–300 words.

## Commits since the pivot

| Commit | What it shows |
|---|---|
| [`6305228`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-lyclccylcq/commit/6305228) | Virtual Gym replaced by Wayline; SSE hub, versioned edits, invites already in this first build |
| [`0953ec9`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-lyclccylcq/commit/0953ec9) | The pivot documented in `PROCESS.md` and `README.md` |
| [`4e0b815`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-lyclccylcq/commit/4e0b815) | Public discovery homepage |
| [`a32c15b`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-lyclccylcq/commit/a32c15b) | Explore Map; a stray "false" traced to native `replaceChildren()` and guarded by a spec check that scans `public/` |
| [`a1a431c`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-lyclccylcq/commit/a1a431c) | Remembered location; licensed Wikimedia photos with credits |
| [`7799fab`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-lyclccylcq/commit/7799fab) | Planning from the map: place clicks, nearby exploring, custom spots, a starting point |
| [`b4bb133`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-lyclccylcq/commit/b4bb133) | Crit 9 gap review: start changes versioned (409 instead of silent replace), remote changes no longer move another person's map, membership checked before configuration; two-browser tests |
| [`c8b258c`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-lyclccylcq/commit/c8b258c) | Production latency and access checks recorded |
| [`19fbd1c`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-lyclccylcq/commit/19fbd1c) | Reading about a place separated from scheduling it; "nothing is shared until Confirm & add" |
| [`3f27110`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-lyclccylcq/commit/3f27110) | Days ordered by time on the server; map-view presence with edge arrows; meals |

## How the real-time part works (as deployed)

- Edits are HTTP requests; each runs in one SQLite transaction that bumps the
  trip's `rev`, then the whole snapshot goes to every member's open SSE
  stream. Clients ignore older revisions; a reconnecting stream starts with a
  fresh snapshot. (`src/trips.ts` `mutate()`, `src/realtime.ts`)
- Concurrency: per-activity `baseVersion` → 409 with the current activity;
  the dialog offers "load theirs" or "save mine over theirs". The start is
  versioned the same way. Adds are idempotent by `clientId`. Order is decided
  by the server from times, so it needs no version.
- Permissions: owner and collaborators via revocable 256-bit invite links;
  non-members get 404 on the trip, its stream and every edit.
- Shared vs personal: the itinerary (stops, times, order, start, meals) is
  shared and saved. Map camera, open place card, search results, nearby
  exploring and the start being chosen stay in the browser. Where each tab's
  map is looking is shared live but in memory only: never saved, never a
  revision, gone with the tab or after a minute.
- One Fly machine; the in-memory hub depends on it (ADR 0003, `fly.toml`,
  `--ha=false`).
- The decision record: `docs/decisions/0003-sse-snapshots-and-versioned-edits.md`
  (accepted at the author's request on 2026-10-12, after the checks below).

## Where direction or a check changed the outcome

Each item is supported by the commit or file named. Whether and how to use
them is the author's call.

1. **Gaps found by review, not by the first build** ([`b4bb133`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-lyclccylcq/commit/b4bb133)):
   the start could be silently overwritten by a simultaneous change;
   a collaborator's change reset everyone's map; a route request reached a
   configuration check before the membership check. Each has a test.
2. **Questions put to the author and the answers taken**, recorded as rules
   in `CLAUDE.md` in the commits that implemented them:
   - travel times stay on a button rather than recalculating on every edit
     ([`7799fab`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-lyclccylcq/commit/7799fab));
   - no view-only links yet; this notes file instead of an agent-written
     `PROCESS.md` ([`b4bb133`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-lyclccylcq/commit/b4bb133));
   - time decides order, and moving a timed stop means changing its time,
     chosen over keeping free manual reordering; per-trip meal times;
     "Change place" ([`3f27110`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-lyclccylcq/commit/3f27110)).
     This changed a `README.md` sentence ("moves lunch" became "moves lunch
     to one o'clock") and the product rules.
3. **A UI bug traced to its cause and guarded** ([`a32c15b`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-lyclccylcq/commit/a32c15b)):
   the stray "false" came from native DOM calls; the fix covered six call
   sites, and a spec check now fails on the pattern.
4. **Measured, not assumed** ([`c8b258c`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-lyclccylcq/commit/c8b258c)):
   end-to-end latency between two browser sessions, locally and in production.

Not in the history (observed during sessions, reported to the author, not
committed as evidence): a CI run on [`a32c15b`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-lyclccylcq/commit/a32c15b)
failed because Chrome didn't start within 10 s and passed on a rerun (visible
in the GitHub Actions log); while building time ordering, new tests showed the
server answered the person making a change in the old order until the fix in
[`3f27110`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-lyclccylcq/commit/3f27110).
Cite these only if you can point a reader to them.

## Results

- `pnpm check` on 2026-10-12: 14 files, 110 tests passing (fresh `DATA_DIR`,
  no keys). `pnpm check:evidence`: passing.
- Latency, two Chrome sessions, from the sender's request to the receiver's
  render, n=10 each: local medians 29–31 ms (max 34 ms); production medians
  30–42 ms (max 86 ms), Fly `syd`, measured from the author's machine.
- Reconnect: after a local server restart with both pages open, the other
  page reconnected by itself and showed a new change 0.8 s after it was made.
  Not repeated on production.
- Access: a signed-in outsider got 404 for reading the trip, opening its
  stream, changing its start and renaming it.
- Map-view presence on production: an off-screen collaborator showed as an
  edge arrow pointing the right way; clicking it moved only the clicker's
  map; the trip's revision didn't change.

## `PROCESS.md` review (gaps, not a rewrite)

- It is the crit 8 version (1449 words against an indicative 900–1100); its
  first line says it will be rewritten at crit 9.
- Its body is about Virtual Gym; Wayline appears only in the closing pivot
  section, written before any Crit 9 work.
- Statements now out of date: "Real-time presence, and choosing its
  transport, are crit 9" (now built); "still has to be implemented fully"
  (the collaboration is implemented; evaluation with real groups is still
  pending, as `README.md` says).
- Missing for Crit 9: the concurrency decision and why it beat the
  alternatives (ADR 0003 holds the facts); shared vs personal state; how the
  work was checked (the measurements above); where the author's direction
  changed the outcome (the list above).
- All 11 commits it currently cites exist.

## Material for `reflections/crit-9.md`

The two prompts: what was the breakthrough that moved the work forward? What
did this work change about who I want to be as a software developer?

Themes the evidence supports (choose, reject or replace):

- Real-time turned out to be less about speed (30–40 ms was easy) than about
  deciding what is shared: the map refit fix, presence kept out of saved
  state, place exploration kept personal until "Confirm & add".
- Concurrency as a product decision: refusing a stale edit (409 and a choice)
  instead of last-write-wins, and the starting point that slipped through
  until a review.
- Order as a decision: choosing time-based order over free reordering, and
  what that cost (README and rules changed).

Questions only the author can answer:

- Which of these did you experience as the turning point, and when?
- Did any result surprise you or change your mind?
- What would you now check first in a multi-user feature?
- How did you decide when to accept the agent's proposal and when to ask for
  a different option?

## Crit 9 readiness

| Requirement | State |
|---|---|
| Real-time, deployed: a change reaches other sessions in about a second, no reload | Done and measured on production |
| One multi-user decision written down with options and costs | ADR 0003, accepted; the author should be able to defend it in the pod |
| Commits that grew with the work | Done (table above) |
| `PROCESS.md` process overview | Needs the author's rewrite for crit 9 |
| `reflections/crit-9.md` | Missing: the cutoff sweep needs it |
| Account of directing, grounding, correcting | Evidence above; the account is the author's |
| Checks green, site live at the cutoff | Green locally and in CI at the last push; recheck after the final push |
