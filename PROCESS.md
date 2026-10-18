# Process overview — Crit 10

## From a crowded gym to one shared plan

Wayline began as Virtual Gym, a pixel-art room where a real workout moved a character ([`a6f7c78...abe24a5`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-lyclccylcq/compare/a6f7c78...abe24a5)). The gym could show who was online, but another person's presence did not change what I could do. I struggled to explain why anyone would keep it open beside a conventional workout tracker.

The pivot to a travel planner was a choice about interaction rather than technology: two people planning a day must act on the same decisions. I replaced the gym with a map and timeline around one shared itinerary ([`6305228`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-lyclccylcq/commit/6305228); [`0953ec9`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-lyclccylcq/commit/0953ec9)).

## Why this stack

I kept Node 24's HTTP server, built-in SQLite, TypeScript run by type stripping, and a small client made from browser modules ([ADR 0001](docs/decisions/0001-plain-node-and-sqlite.md)).

The course gives me one small Fly machine and one persistent volume. SQLite fits a few friends planning tens of stops, and avoiding a large framework leaves fewer moving parts. The costs are routes and DOM behaviour that I must maintain myself, and a single-machine assumption I cannot ignore.

The later OpenAI integration introduced an SDK, so the initial "no dependencies" argument is no longer literally true ([`b20fc88`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-lyclccylcq/commit/b20fc8895863ef981768b88a3609030ff23ea226)).

Google Places and Routes remain server-side and are fetched on demand: travel times should come from a real route, not something the model invents.

## From real-time to accountable collaboration

Crit 9 asked whether edits could arrive together. I chose HTTP writes plus server-sent events, carrying whole-trip snapshots and increasing revisions ([ADR 0003](docs/decisions/0003-sse-snapshots-and-versioned-edits.md)).

Polling would waste requests; WebSockets would introduce a second protocol for writes already handled by HTTP. Whole snapshots cost more bytes than diffs but let a reconnect recover from current state.

An edit based on a stale version receives a 409, letting a person load the other edit or deliberately save over it. I rejected last-write-wins because quietly losing somebody's plan would contradict the product's purpose; automatic merging seemed excessive for short itinerary fields.

This was not correct merely because the browser appeared to work. A separate Crit 9 audit found that changing the starting point without a `baseVersion` bypassed a conflict check: the normal UI always supplied one, but a direct request could overwrite it.

Requiring the field on the server, with a regression test, corrected the assumption ([`7278cfe`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-lyclccylcq/commit/7278cfee5dd14cadd063479a29bf3774b0465841)).

The same period clarified what should *not* be shared: another person's edit updates my itinerary, not my map camera; the place their map is viewing is transient presence, never a saved stop ([`b4bb133`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-lyclccylcq/commit/b4bb133); [`3f27110`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-lyclccylcq/commit/3f27110)).

Crit 10 raised a different question: could the server tell *which person* changed something, and whether they had the right?

My first instinct about a share link was too permissive. Anyone could forward it, so possession could not mean that the owner intended to invite that account.

A 24-hour expiry reduces the lifetime of a leaked link but does not solve that identity problem. I therefore separated a link from permission: it allows a signed-in person to request access, and the owner approves or refuses that particular account.

Links are stored as hashes, expire after 24 hours, and old permanent links are disabled ([`1f973dd`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-lyclccylcq/commit/1f973dda60f0d606893cb61ef8866be0b47bad77); [permissions](docs/permissions.md)).

The same change made roles explicit. The owner controls membership, overall trip settings, publishing and deletion. Collaborators can add stops and change only stops they created.

Non-members cannot read a private trip, including its SSE stream; removing someone also closes their existing stream.

These checks live in `src/permissions.ts`, not just in disabled buttons. This restricts some useful flexibility, but it gives an owner a defensible boundary rather than assuming that everybody who can see a plan can rewrite it ([`1f973dd`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-lyclccylcq/commit/1f973dda60f0d606893cb61ef8866be0b47bad77); [`spec/permissions.test.ts`](spec/permissions.test.ts)).

## Making behaviour visible

For Crit 10 I asked for structured, server-side JSON logs that resolve identity from the existing session cookie; a separate anonymous identity system would only create disagreement between HTTP actions and SSE connections.

The logger uses request context to attach a user, request ID and trip ID to meaningful actions.

It distinguishes an added stop, an approval, a denied deletion and the broadcast caused by an edit.

It deliberately omits rapid map-view updates and keep-alives: logging everything would bury the events I need to narrate.

Tokens, cookies, notes and coordinates are excluded ([`1f973dd`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-lyclccylcq/commit/1f973dda60f0d606893cb61ef8866be0b47bad77); [logging design](docs/logging.md)).

The point is not a pretty dashboard; it is evidence I can follow from a person's click to the server's decision.

## Keeping reuse separate from permission

Publishing introduced another distinction.

An owner can publish a read-only snapshot; another person using it creates an independent private fork, not membership of the original trip.

Reviews attach to the publication, not its forks.

This adds product scope beyond the Crit 10 minimum, but it prevents a public example from becoming a back door into somebody else's working plan ([`1f973dd`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-lyclccylcq/commit/1f973dda60f0d606893cb61ef8866be0b47bad77)).

The new AI planner follows the same principle: it drafts one day using user preferences and Google-backed candidates, previews exact changes, and applies only after confirmation and a fresh permission/version check ([`b20fc88`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-lyclccylcq/commit/b20fc8895863ef981768b88a3609030ff23ea226); [AI design](docs/ai.md)). Real-API testing exposed two faults: a silent car trip where transit had no route, and no restaurants for a vegetarian ([`a005e90`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-lyclccylcq/commit/a005e90)).

## How I direct and check the agent

I work through prompts that specify the behaviour, constraints, and what the agent must not change.

After reviewing an implementation, I revise assumptions rather than treating a passing build as an answer.

The forwarded-link problem is a case where the feature could work mechanically but the product rule was wrong.

I carried the revised rule into `CLAUDE.md`, put its observable consequences into `spec/permissions.test.ts`, and documented the roles for a future reviewer.

The README argues for one truthful shared plan; the agent rules constrain changes; the tests try to catch violations. These are three different jobs, not three copies of a feature list.

The earlier Crit 9 production audit measured live sync and a network-drop recovery with two browsers ([`54c282e`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-lyclccylcq/commit/54c282e5dee07c4efce667af0177be8cb9eaa10f); [audit notes](docs/crit-9-notes.md)).

For Crit 10, the repository contains tests for the invite and permission lifecycle and a two-browser join-and-edit path. A scripted check on the deployed site confirmed an approved join, a refused deletion and an AI plan ([notes](docs/crit-10-notes.md)), but classmates have not yet exercised it.

I still need to tail Fly logs beside two independent Chrome profiles and observe what happens when the second person attempts an owner-only action.

Logs will help diagnose a failure; they cannot replace that test.

My unresolved constraints are the one-machine SSE hub and SQLite budget counters, uncertain behaviour across production restarts, and AI cost controls that depend on provider-side limits as well as the app's own.

The lesson from this iteration is that a convincing shared screen needs boundaries and instruments behind it.
