# Process overview

_Draft at crit 8. Per the brief, this gets rewritten at each crit rather than
appended to._

## From brief to idea

The brief asks for a multi-user, real-time website that's good, and warns that
the median answer is a chat room with the nouns swapped. My idea is a virtual gym.
Spatial-presence products like Gather were the starting point, but a virtual
office is still a meeting. What I wanted from a real gym is narrower: training on
your own while seeing other people work nearby, with nobody asking anything of
you. That gave the design statement in the README, and it gave a list of things
the app must not become (Strava, Discord, a feed, a leaderboard, a coaching app).
I wrote both into my opening prompt to the agent before any code existed, so the
narrowing happened up front and wasn't a late correction.

## Harness and workflow

The prompt asked the agent to inspect the starter before choosing anything, to
explain the architecture first, and to keep the starter's contract (`/` returns
200, `/readme/` publishes the README, and data lives on `/data`). `CLAUDE.md`
turns the product statement into rules: presence on the floor, not in a list; no
feeds, rankings or messaging; persistence on the server; phones as first-class. It
also records the engineering rules the stack needs, such as erasable TypeScript
only, additive schema changes, and the pass never appearing in public data.

## Stack

Plain Node 24 (`http` and `node:sqlite`) with a hand-written client and no runtime
dependencies. The trade-offs are in
[decision record 1](docs/decisions/0001-plain-node-and-sqlite.md). In short: the
app is one page and an API on a 256 MB machine, so a framework would mostly sit
unused, and built-in SQLite avoids compiling a native module in the image. The
server and data model landed in
[`00a5898`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-lyclccylcq/commit/00a5898).

## Persistence and identity

Four tables: users, sessions (visits), sets and presence. Identity is an opaque id
plus a 12-character gym pass, which works like a bearer secret. The browser keeps
only the pass. Workout data is never kept in `localStorage`. Typing the pass on
another device gives you back the same person, and the display name is only a
label. A visit left open for three hours is closed at its last activity, so
nobody appears to be "resting" for days. Presence is one row per person,
rewritten on each change. Every change goes through four functions in
`src/gym.ts` (enter, choose, set, leave), which are the events crit 9 will
broadcast.

## Decisions narrowed or rejected

- **An event-log table** for crit 9 to tail was considered and left out. Nothing
  would read it yet, and the four action functions already give a broadcast one
  place to hook in.
- **Polling the floor** would have made other people appear without a reload. I
  held it back so crit 8 stays about persistence, and so the real-time choice is
  made deliberately at crit 9. For now, others appear only when the page loads,
  and the README says so.
- **Cardio as weight × reps** didn't fit, so each station declares what it
  measures: timed stations log minutes and no weight.
- **Screenshots changed the layout.** The first render at 1440px squeezed the
  weight and reps inputs until the numbers were cut off, and at 390px name tags
  spilled into neighbouring zones. Fields now stack, people are kept away from
  zone edges, and phones show only name and status. Those fixes are part of
  [`0e2b05b`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-lyclccylcq/commit/0e2b05b).

## Checks

[`c024afc`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-lyclccylcq/commit/c024afc)
adds checks for the README's testable promises. A new identity persists, and its
pass recovers it in any case or spacing. Two people with the same name stay
distinct. A set persists and puts you at its station. Leaving takes you off the
floor but keeps your history. Seven kinds of bad set data are rejected with
nothing saved. The public floor never contains a pass. The page carries every
station without script.

One honest note: these checks were written after the implementation in the same
session, so they never went red against a missing app. Persistence across a
server restart was verified by hand locally (stop, start, `/api/me` returns the
same set). It isn't in `spec/`, because the spec runs against an app it can't
restart.
