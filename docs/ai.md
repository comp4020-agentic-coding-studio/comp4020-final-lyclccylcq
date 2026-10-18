# AI: the copilot, Plan with AI, limits and the API key

Wayline's AI features run on the existing Fly backend, which calls the model
provider (OpenAI) directly, through the official `openai` SDK and the Responses API. There is no separate gateway. Google Maps stays
separate (`src/google.ts`).

```
browser ──► Wayline on Fly (session auth, trip permissions, app-wide limits, usage records)
                │
                └──► src/ai.ts ──► OpenAI Responses API   (key: OPENAI_API_KEY; .env locally, a Fly secret in production)
```

`src/ai.ts` is the only code that talks to the provider. Replacing it with a
gateway later means changing that one module.

## Features

- **Copilot** (`src/copilot.ts`): reviews a day and answers questions about it.
  It recommends among fixes the app calculated itself; it can't change the plan.
- **Plan with AI** (`src/planner.ts`): drafts one day.
  1. The server collects verified facts: the day's stops, Google routes already
     calculated for it, and up to 12 Google places near the day (one Places
     request per type, at most four types, chosen from the person's interests
     and cuisines; price level only when Google gives one).
  2. The model returns ids only: an order for the stops without set times, and
     up to four of those Google places to add, each after an existing stop.
  3. The server builds exact edits (`buildDraft`): times for added stops come
     from the previous stop's end and the pace (never a guessed travel time),
     and modes for calculated legs from the transport preferences.
  4. The person sees a preview. **Apply Plan** sends only the draft's id; the
     server applies exactly what it previewed, in one change, and refuses if
     the day changed (409) or the person lacks the right (a collaborator can
     add stops but not reorder the owner's or choose modes: 403).

### Hard constraints and soft preferences

| Hard (enforced in code; never broken) | Soft (steer the model) |
|---|---|
| Stops with a set time never move | Cuisines |
| Excluded travel modes are never chosen | Pace (visit length, how many stops a day holds) |
| Added places come only from Google's results | Interests |
| Allergies and dietary needs: every food suggestion says to check with the restaurant | Budget and restaurant price, where Google gives a price level |
| A longer walk than the person's limit isn't chosen when another mode works | Transport preference, fewer transfers, cheaper or faster |

Google can't confirm allergens, halal, kosher, vegan or medical diets, so
Wayline never claims a place meets one. Allergy text is never sent to the
model, only that the person has allergies.

## Preferences (`src/preferences.ts`)

- **Your defaults** (`user_preferences`): food (cuisines, dietary needs,
  allergies, restaurant price) and your usual travel choices. Private to you,
  reused on every trip.
- **The trip's shared choices** (`trip_preferences`): transport, modes to
  avoid, longest walk, fewer transfers, pace, interests, budget. Any member
  can set them; they override your defaults on that trip and never change
  them. Food is never stored on a trip or shown to other members.
- Plan with AI asks for preferences once, the first time (409
  `code: "preferences"` until you've saved them), with defaults for
  everything. Change them later from **Preferences** in the Copilot panel.

## Limits

All app-wide: one shared budget for everyone, whichever signed-in person asks.
There are no per-user quotas (a course demo with few users). User ids are
recorded for the logs only.

| Limit | Default | Variable |
|---|---|---|
| Model calls per UTC day | 100 | `WAYLINE_AI_DAILY_LIMIT` |
| Model calls running at once | 3 | `WAYLINE_AI_CONCURRENT` |
| Tokens per UTC day (input + output) | 400,000 | `WAYLINE_AI_DAILY_TOKENS` |
| Output tokens per call (reasoning included) | 3,000 (planner asks for 2,500) | `WAYLINE_AI_MAX_OUTPUT_TOKENS` |
| Timeout per call | 45 s | `WAYLINE_AI_TIMEOUT_MS` |
| Automatic retries | none (the SDK's are off) | `AI_RETRIES` in `src/ai.ts` |
| Input | question 500 chars, 4 earlier turns, notes 300 chars, 40 stops (copilot) / 25 stops and 12 candidates (planner) | `LIMITS`, `PLAN_LIMITS` |

How they're enforced (`src/aiusage.ts`):

- Every call writes an `ai_usage` row **before** the provider is contacted,
  inside one `begin immediate` SQLite transaction that also counts today's
  rows, today's tokens and the calls still running. Two simultaneous requests
  can't both take the last slot, and the counts survive restarts and deploys.
- A call reserves its maximum output tokens up front; when it finishes, the
  provider's real token count replaces the reservation.
- A call that never finishes (a crash, a machine stopped mid-request) holds
  its slot only until its lease ends (timeout + 30 s); the next request
  closes it as `abandoned`.
- Over a limit: the request is refused with "AI planning is temporarily
  unavailable because the usage limit has been reached" (503), or "busy"
  (429) when three are already running. The provider isn't called, and the
  rest of the site works as usual. Cached copilot answers cost nothing.

**Limitation:** this holds while every Wayline process shares one SQLite file,
which is the case on Fly's single machine and volume (ADR 0003). A second
machine with its own volume would have its own counts.

## Usage and cost

Each call records: user id, trip id, feature (`copilot`, `plan_day`), time,
model, status, input and output tokens, and an estimated cost. Tokens come
from the Responses API's `usage`: `input_tokens` (cached input included) and
`output_tokens` (reasoning tokens included, which OpenAI bills as output). Cost is computed only when you set your provider's prices in
`WAYLINE_AI_PRICE_INPUT_PER_MTOK` and `WAYLINE_AI_PRICE_OUTPUT_PER_MTOK`
(USD per million tokens, from OpenAI's pricing page for your `OPENAI_MODEL`);
otherwise it's `null`, never guessed. Cached input is counted at the full input
price, so the estimate errs high.

To see usage:

- `GET /api/admin/ai-usage`, signed in as a username listed in
  `WAYLINE_AI_ADMINS`: today's totals, the limits, and the last 30 days by
  feature and model. Everyone else gets a 404.
- The structured logs: `AI_REQUEST_COMPLETED` / `AI_REQUEST_FAILED` (with
  tokens, cost, duration) and `AI_LIMIT_REACHED`, e.g.
  `flyctl logs -a comp4020-final-lyclccylcq | grep '"event":"AI_'`.

Neither ever contains the key, prompts or answers.

## The API key

- Set it as a Fly secret, from your own terminal, so it never appears in this
  repo or in a chat: `fly secrets set OPENAI_API_KEY=... -a comp4020-final-lyclccylcq`.
  Locally it goes in `.env` (gitignored). `.env.example` has only an empty
  placeholder.
- It's read on the server only (`src/ai.ts`). It's never sent to the browser
  (`/api/config`'s keys are pinned by `spec/restart.test.ts`), never logged
  (startup prints only "set"/"missing"; `sanitize()` redacts key-shaped text),
  and never included in an error (`describeAiError` returns plain messages).
- Without it, AI features say they're unavailable and everything else works.
- The default model is `gpt-6.1-sol` (`DEFAULT_MODEL` in `src/ai.ts`); set
  `OPENAI_MODEL` to use another. Answers use Structured Outputs (a strict JSON
  schema) and `store: false`, so nothing is kept on OpenAI's side for later
  turns. The SDK's own retries are turned off (`maxRetries: 0`).

**What Fly secrets do and don't protect.** They keep the key out of the code,
the image and git. Anyone with admin access to the Fly app (or able to run
code in the machine) can still read it. The app-wide limits cap what Wayline
itself will spend, but not what someone holding the key could spend directly.

### Set limits at the provider, too

App limits alone don't protect the account. In the OpenAI platform settings:

- **Use a project and key just for Wayline**, so the key can be revoked
  without affecting anything else and its spend is visible on its own. A
  project key can be limited to the endpoints it needs (Responses) and to the
  models Wayline uses.
- **Set a budget** for the project. Check the dashboard's current wording to
  confirm whether it stops requests or only notifies: don't assume an alert
  stops spending.
- **Turn on usage notifications** at a threshold well below the budget.
- **Check usage** in the dashboard now and then; compare with `/api/admin/ai-usage`.
- **Rotate the key** if it may have leaked: create a new one, `fly secrets set`
  it, then delete the old one.

## Tests

`spec/aiusage.test.ts` (limits across restarts, six racing connections,
leases, token reservations), `spec/planner.test.ts` (preferences privacy,
hard constraints, preview and apply, stale and forged drafts, collaborator
rights, the daily limit refusing before the provider, the key never in any
output), `spec/copilot.test.ts`. All use a local stand-in for the provider;
no test calls a real model.

## Configuration: the same pattern as Google Maps

| | Locally | On Fly |
|---|---|---|
| How values load | `.env` (gitignored), read by `pnpm start`/`pnpm dev` via Node's `--env-file-if-exists=.env` | Fly secrets, given to the process as environment variables |
| Where the key is read | `process.env.OPENAI_API_KEY` in `src/ai.ts` only | the same |
| In git? | no: `.env` and `.env.*` are gitignored; `.env.example` has empty placeholders | no |
| In the image? | no: the Dockerfile copies only `package.json`, the lockfile, `README.md`, `src/`, `public/`, `docs/`, and `.dockerignore` excludes `.env*` | no |
| In the browser? | no: there's no build step or env injection in `public/`, and `/api/config`'s keys are pinned by a test | no |

The only key the browser receives is `GOOGLE_MAPS_BROWSER_KEY`, on purpose (a
Maps JavaScript key is public by design and protected by its website
restriction; see `docs/google-maps-keys.md`).
