# Process overview

_Rewritten at crit 9 to describe Wayline as it stands; it will be rewritten again at crit 10, not appended to._

## From Virtual Gym to Wayline

Until crit 8 this project was Virtual Gym, a shared pixel-art gym where your real workout moved your character ([`a6f7c78...abe24a5`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-lyclccylcq/compare/a6f7c78...abe24a5)). Others were visible, but nothing they did touched your session, and I couldn't justify why anyone would use it alongside the fitness apps they already have. Making it live wouldn't have fixed that: it would still have been people side by side, not acting on anything shared. So I pivoted to Wayline, a collaborative trip planner, where one person's change shapes everyone's day ([`6305228`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-lyclccylcq/commit/6305228), documented in [`0953ec9`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-lyclccylcq/commit/0953ec9)).
## Stack, and why

Node 24's own `http` and built-in SQLite, TypeScript by type stripping, and hand-written ES modules with no build step ([decision record 1](docs/decisions/0001-plain-node-and-sqlite.md)). I kept this from the gym because the course machine is one small Fly instance with one volume, and a trip planner's data is small. The cost is hand-written routing and DOM code, and the gain is no runtime dependencies to audit or update. Real-time is server-sent events from an in-process hub ([ADR 0003](docs/decisions/0003-sse-snapshots-and-versioned-edits.md)): edits are ordinary requests, so the stream needs no protocol of its own and reuses cookie authorisation. That holds only while Fly runs one machine. Google Places and Routes are called only on the server and only on intent (a click, a button), because they're billed per request and their terms limit what may be stored.

## How I work with the agent

Each pass starts from a long prompt I write: what to build, what not to touch (keys, Fly secrets, unrelated features), what to verify, and that nothing is pushed or deployed without my approval. Before choices that change the product, the agent stops and asks. My answers become rules in `CLAUDE.md` in the same commit, so they hold in later sessions. Every UI change is checked in a real browser at 1920×1080 and 390×844, and every testable promise goes into `spec/`. For Crit 9 I also had a separate session audit the deployed site without trusting the build session's results.

## What good means, and where it lives

`README.md` argues what good means: planning by touching the map and timeline, one shared plan, truthful travel data, an AI that suggests while people decide, and private trips. `CLAUDE.md` turns that into rules, and `spec/` checks the testable parts: outsiders get 404, retried adds don't duplicate, stale edits are refused, changes reach another real browser within a second. Whether planning feels direct is judged, not tested.

The README's sources pull in two directions. Shirky, Sloan and Shneiderman support building for one small group, acted on directly. Fowler supports refusing stale edits. Local-first software argues for offline editing and automatic merging. I agree with its aim of never losing someone's work, but for a few people planning short fields together I chose one copy on the server and a visible choice instead. Figma's server authority is close to mine, except that it lets the last writer win.

## The multi-user decision

The decision I wrote down is what happens when two people change the same thing ([ADR 0003](docs/decisions/0003-sse-snapshots-and-versioned-edits.md)). The options were last-write-wins, optimistic versions, and automatic merging (CRDTs or operational transformation). Last-write-wins silently overwrites a collaborator, which breaks "one shared plan". Automatic merging is built for shared text, and a trip is short fields. So each edit carries the version it was based on. A stale one is refused with a 409, and the person chooses "Load their version" or "Save mine over theirs". The cost is a visible interruption where a merge might have been silent, and no offline editing.

Two further choices follow the same reasoning. The server decides order from times, so ordering never conflicts ([`3f27110`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-lyclccylcq/commit/3f27110)). Only the itinerary is shared live: someone else's change never moves your map, and where each person is looking is transient presence that is never saved ([`b4bb133`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-lyclccylcq/commit/b4bb133), [`3f27110`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-lyclccylcq/commit/3f27110)).

## Corrections, and where they landed

- **A gap review before the crit** ([`b4bb133`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-lyclccylcq/commit/b4bb133)) found three things the first build missed: a simultaneous start change silently replaced the other, a collaborator's edit reset everyone's map, and a route request reached a configuration check before the membership check. Version and access fixes have automated tests; map preservation was checked manually.
- **A stray "false" in the UI** came from native DOM calls given a boolean. It was fixed at six call sites, and a spec check now fails on the pattern ([`a32c15b`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-lyclccylcq/commit/a32c15b)).
- **Reading versus scheduling.** I asked for a place's information to be kept apart from adding it, so nothing is shared until "Confirm & add" ([`19fbd1c`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-lyclccylcq/commit/19fbd1c)).
- **The audit's find.** The server checked the start's version only when a request included it, so a request without it overwrote the start in production; only the editor, which always sends it, was protected. The field is now required. The new test failed against the old code with the audit's 200, and the rule is in `CLAUDE.md` ([`7278cfe`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-lyclccylcq/commit/7278cfe)).
- **Order by time.** Asked whether manual order or times should win, I chose times. That changed a README sentence and the product rules, and new tests caught the server answering in the old order ([`3f27110`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-lyclccylcq/commit/3f27110)).

## Evidence

The checks pass locally and in CI: 110 tests at [`54c282e`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-lyclccylcq/commit/54c282e). Earlier manual measurements on production put healthy sync at medians of 30–42 ms ([`c8b258c`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-lyclccylcq/commit/c8b258c)). The independent audit of [`54c282e`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-lyclccylcq/commit/54c282e), with two Chrome sessions on the live site, saw:

- 28–45 ms for adds, retimes, deletes, start changes and edits;
- 409s with both resolutions working;
- 404 after a collaborator was removed;
- after a real network drop, recovery 2057 ms after the connection returned.

These are small samples, not guarantees. Details and screenshots are in [`docs/crit-9-notes.md`](docs/crit-9-notes.md).

## Limitations

- Recovery after a production restart is untested.
- Keeping your map still during others' edits, and the edge arrows, were checked by hand only.
- My Trips photos cover template trips and those near a curated city.
- There are no view-only links.
- The AI copilot hasn't been run with a real key.
- Nobody outside the project has planned a trip with it yet.

Next time I would do two things earlier. First, I'd judge how much the screen shows: with the Google map in place, the editor felt busier, not clearer, and I expect to simplify what the map shows. Second, I'd decide how each new service's keys are stored before adding it, not afterwards. Wayline's keys ended up in a git-ignored `.env` and Fly secrets.
