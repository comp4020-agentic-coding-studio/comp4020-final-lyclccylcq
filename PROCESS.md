# Process overview

_Rewritten at crit 8; it will be rewritten again at crits 9 and 10, not appended to._

## Starting point

The brief asks for a multi-user, real-time site that's good. My idea came from Gather's shared rooms, applied to exercise: not a meeting space, but the feeling of training on your own while other people work nearby, with nobody asking anything of you. Before any code, I wrote the design statement and what the app must not become: Strava, Discord, a feed, a leaderboard, a coach. What I hadn't worked out was how the app should *feel*. My first build turned out more like a tracker than I'd intended.

## How I work with the agent

Each pass starts from one long prompt I write first: the concept, hard scope limits (no AI, nutrition, rankings, chat, feeds, and "don't begin crit 9"), what to verify, and an instruction to inspect the code and explain any architectural choice before writing it. Then comes a separate review pass that tests the app rather than trusting it. The trade-off is a large diff per pass that I can't read line by line, so: the agent drives a real browser and shows me screenshots, the checks that matter most are broken on purpose to show that they can fail, and every correction goes into `CLAUDE.md` or `spec/` so that it holds in later sessions. When the agent proposed something I hadn't asked for, I decided case by case. I accepted a canvas renderer, a full-room locker rule, and keeping your place on a same-tab refresh, and I record which choices were its rather than mine.

## How the design changed

**First build and review.** The server and data model landed in [`00a5898`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-lyclccylcq/commit/00a5898) and the floor in [`0e2b05b`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-lyclccylcq/commit/0e2b05b). The review I ordered found drift that the tests hadn't. Everyone's last weights were on their public name tag, which made it a quiet leaderboard, and the welcome screen showed running totals. Both came out in [`427dad9`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-lyclccylcq/commit/427dad9). "Numbers are private" became a `CLAUDE.md` rule and a check that the public floor carries no weights or reps ([`9c92d5c`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-lyclccylcq/commit/9c92d5c)).

**The gym became the interface.** After a second audit, every check passed, and I still decided the direction was wrong. Five dashed zones with dots and a logging panel read as a workout tracker with a gym theme. I redirected the work toward a large pixel-art room where your real workout controls what your character does, and the label alone isn't enough ([`a5608bd`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-lyclccylcq/commit/a5608bd)).

**Equipment, not a list.** Next I asked for the workout to start from the machines ([`5c39867`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-lyclccylcq/commit/5c39867)). `src/equipment.ts` describes kinds of equipment, each with its exercises and the pose each one animates. Several physical machines share a kind, so adding equipment means editing data, not writing new logic. Occupancy moved to the server: the browser had been guessing who was on bench A, and two browsers could disagree. Start, Finish and Cancel became distinct states, and only Finish records a set.

**The locker.** The obvious places for history were a profile page or reception. I ruled out both: a profile page is the start of a dashboard, and reception is where you get in. History went into your own locker instead ([`e50a865`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-lyclccylcq/commit/e50a865)), which gave the project its main rule: the floor shows what is happening now, and the locker keeps what you've done. `CLAUDE.md` now forbids a profile dashboard.

**Walk first, then set up.** After shipping, I listed usability corrections: start at the entrance, walk to a machine before its setup opens, a closable panel, usable barbells, a stair climber, and sets that "appear not to be adjustable" ([`1ca9a9b`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-lyclccylcq/commit/1ca9a9b)). I asked the agent to reproduce the last one before fixing it. With real clicks and typing, the next set was editable, and `60×8` then `65×6` were saved as separate records. The actual gaps were different:
- a started set was frozen, so Finish recorded the target;
- there was no set number;
- every machine took weight and reps, even assisted pull-ups and cardio.

Sets are now numbered, Finish records what you actually did, and each exercise uses one of three metrics: load, assistance, or time plus a level. A check goes red if the setup opens before you arrive.

**A set that silently vanished.** I later found a finished set missing from my locker. The data was fine. The real bug was that, when a set had already stopped on the server, Finish got a 409. The page didn't refresh your own state, so it kept showing "in progress" and nothing was saved. The fix, and a browser check for it, are in [`3bd0313`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-lyclccylcq/commit/3bd0313).

## Stack and state

Plain Node 24 with built-in SQLite and no runtime dependencies ([decision record 1](docs/decisions/0001-plain-node-and-sqlite.md)): one page and an API on a 256 MB machine don't need a framework, at the cost of hand-written routing. The world is one hand-drawn canvas with HTML text on top ([decision record 2](docs/decisions/0002-canvas-pixel-world.md)), which avoids an engine and asset files at the cost of drawing every sprite in code.

The state split is architectural. Users, lockers, visits and sets are kept in one SQLite file on the Fly volume. Presence is the only live table: an unfinished set expires unrecorded, an idle person is gone after 45 minutes, and opening the gym afresh puts you back at the entrance. The browser stores only an opaque gym pass (plus a tab-only flag so a refresh mid-set keeps your place). The server stores meaning; the browser derives position, route and animation from it.

## Where it stands, and what's deferred

Other people appear in the same room, on their machines, showing exercise and state. But they appear as of your last page load, your last action, or your return to the tab, not live. Real-time presence, and choosing its transport, are crit 9. Direct interaction, such as a fist bump while someone rests, comes after that, and only as much as presence needs. I deliberately haven't built leaderboards, chat, feeds, coaching, nutrition or analytics: all were within reach, but none makes it feel more like others are training in the same space.

The first checks were written after the code they test, so they never failed against a missing app. Six later ones were broken on purpose to show they catch their bug: the viewport layout, the returning browser, animation, occupancy, walk-first, and the vanished set. The locker checks weren't. Persistence across a server restart is still verified by hand, because the spec runs against an app it can't restart.
