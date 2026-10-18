# Crit 10 notes (factual record and evidence pack)

The evidence behind `PROCESS.md`, `docs/permissions.md` and
`reflections/crit-10.md`. It records what exists and how it was checked, not
opinions or reasons, which belong to the author. Three kinds of evidence:

- **automated checks** in `spec/`, run by `pnpm check` locally and in CI;
- **local real-API runs**, on throwaway databases with the real OpenAI and
  Google keys from `.env`, on 2026-10-19;
- **production checks** against https://comp4020-final-lyclccylcq.fly.dev on
  2026-10-19 (Fly release v33, commit `a005e90`).

Crit 10 brief ("Fly by instruments"): the app is multi-user and deployed by
the cutoff; permissions are checked on the server and the decision is written
down with why; server-side logs record who did what and outlive the crit; at
the crit, two pod members use the app from its URL in separate Chrome profiles
while the author narrates from `mise exec -- flyctl logs -a
comp4020-final-lyclccylcq`; the repo shows process (`PROCESS.md`,
`reflections/crit-10.md`). Group Bada: cutoff Monday 19 October 2026, 13:30
(Canberra time); session 15:30–17:00.

Official writing constraints: `PROCESS.md` runs to 900–1100 words and is
rewritten at each crit; reflections answer the two standing prompts in
150–300 words (`reflections/README.md`). The final-project page advises
drafting `README.md` and `PROCESS.md` yourself.

## Commits since Crit 9 (`54c282e`)

| Commit | What it contains |
|---|---|
| [`1f973dd`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-lyclccylcq/commit/1f973dd) | Structured logging (`src/log.ts`), the permission module (`src/permissions.ts`), 24-hour invite links with owner approval, publishing, forks and reviews (`src/publications.ts`); `spec/logging.test.ts`, `spec/permissions.test.ts`; 28 files |
| [`b20fc88`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-lyclccylcq/commit/b20fc88) | OpenAI via the official SDK (`src/ai.ts`), app-wide AI limits in SQLite (`src/aiusage.ts`), travel preferences (`src/preferences.ts`), Plan with AI (`src/planner.ts`) |
| [`a005e90`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-lyclccylcq/commit/a005e90) | Fixes found by real-API testing: a leg with no transit route had silently become a car trip; dietary needs had stopped all restaurant suggestions; token counts were dropped from logs |

Earlier post-Crit-9 commits added the copilot, voice calls, unique display
names and invite-by-username (`61fe60b`, `fcf8928`, `356140f`).

## Logging (`docs/logging.md`)

- One JSON line per significant action, to stdout/stderr, which `flyctl logs`
  shows. Each carries `userId`, `username`, `tripId`, `requestId`, and for
  live streams `connectionId`.
- The user comes from the session cookie (`auth.userForToken`), never a
  request body; `spec/logging.test.ts` sends a forged `userId` and checks the
  log still names the real sender.
- A broadcast is logged after the change that caused it, with the same
  `requestId`.
- Not logged: map-view updates (up to every 400 ms), keep-alives, place
  searches, call signalling. Never logged: passwords, cookies, tokens, keys,
  notes, coordinates (checked by tests and a scan of 1,155 log lines).

## Permissions and invitations (`docs/permissions.md`, `src/permissions.ts`)

- Owner does everything. A collaborator adds stops, and changes, moves or
  removes only stops they added (`activities.created_by`). Non-members get 404;
  members without the right get 403.
- Before `1f973dd`, opening a link and pressing "Join" made you a collaborator,
  the link never expired, and any collaborator could edit or remove any stop.
- Now: a link expires 24 hours after creation (server clock); opening it only
  lets a signed-in person request to join; the owner approves or rejects each
  request; a forwarded link needs its own request. Legacy links are cleared at
  startup.
- Removing a member sends `revoked` on their open streams and closes them.

Tests: `spec/permissions.test.ts` (14), including expiry on a controlled clock
and a forwarded link. Deliberately breaking the permission check failed 3
tests; breaking the approval step failed 1. A browser test runs request,
approve and collaborate in two Chrome sessions.

## Publishing, forks, reviews

A publication is a snapshot (no notes, members or links); editing the trip
doesn't change it until the owner republishes. "Use This Template" creates a
new private trip owned by the forker, recording where it came from. Reviews
are 1–5 stars, one per person, averaged on the server.

## AI (`docs/ai.md`)

- The model returns ids only; the server builds edits, shows a preview, and
  applies exactly that draft on Apply Plan, refused if the day changed.
- Timed stops never move; excluded modes are never chosen; places come only
  from Google; allergy text is never sent to the model.
- Limits are app-wide (100/day, 3 at once, a token budget), held in SQLite.

## Verification results

**Automated:** typecheck and 210 tests in 21 files pass at `a005e90`, locally
and in CI.

**Local real API (5 calls total, model `gpt-6.1-sol`):** structured JSON call
passed; a four-stop Sydney day planned with 3 Google routes calculated first;
lunch filled with a Google-rated restaurant in free time; Finger Wharf
suggested for architecture interest; the trip was unchanged before Apply and
updated live after.

**Production (2026-10-19):** sign-up, trip, Google search and Google map
load; join by link with approval; a collaborator's add reached the owner in
79 ms; the collaborator's trip delete was refused (403); one real AI plan
generated and applied, fixed times kept; an outsider got 404; Fly logs showed
no ERROR lines and no key-shaped text. Temporary trips were deleted; test
accounts `smokemve1aob4a/b/c` and one `smokemap…` remain.

## Not verified

- Two pod members on the live site in separate Chrome profiles: that's the
  crit itself.
- Behaviour under real load, or with more than one Fly machine.
- AI quality beyond the Sydney examples.
