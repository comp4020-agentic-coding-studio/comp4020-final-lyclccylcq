# Structured server logs

Wayline's server writes one JSON object per line: INFO to stdout, WARN and
ERROR to stderr. Fly collects both, so `flyctl logs` shows everything. There
are no log files, no external service and no extra dependency.

## Architecture

- **`src/log.ts`** is the only place a log line is built. It holds the
  request context (Node's built-in `AsyncLocalStorage`): a `requestId` and,
  once the session cookie has been resolved, the user. Every line written
  while a request runs carries both, including lines from deep inside the
  trip store or the hub.
- **`src/server.ts`** gives each request a `requestId` and resolves the user
  from the session (`setUser` after `auth.userForToken`, or after a
  successful sign-up or login). When the response finishes, it writes the
  request's single business event through `src/request-log.ts`, whose route
  table (`ROUTES`) maps method and path to an event name, and the route can
  add detail (`note`), such as which fields an edit touched. Requests not in the table (map views, place
  searches, call signalling) log only when they fail.
- **`src/realtime.ts`** (the SSE hub) logs connections, joins, leaves and
  broadcasts. A broadcast happens inside the request that made the change,
  so its line shares that request's `requestId` and user, and it is written
  just after that request's business event (cause, then effect).
- Logging can't break a request: `write()` swallows its own failures, and
  the logger is never called on hot paths such as map views or keep-alives.

## Fields

Every line has `timestamp` (ISO 8601), `level` (`INFO`/`WARN`/`ERROR`),
`event`, `userId`, `tripId`, `action`, `status` (`success`/`failure`/`denied`)
and `message`. A field that doesn't apply is `null`. Where relevant, lines
also carry:

| Field | Meaning |
|---|---|
| `username` | the account's username, for reading the log during a demo (derived from `userId` on the server) |
| `requestId` | `req_…`, the same for a request's event and the broadcast it caused |
| `connectionId` | `sse_…`, one per open live stream (one per editor tab) |
| `tabSession` | the editor tab's random session id (the same one the map-view and call features use) |
| `durationMs` | request time, or how long a stream was open |
| `errorCode` | `INVALID_INPUT`, `UNAUTHENTICATED`, `FORBIDDEN`, `NOT_FOUND`, `CONFLICT`, `RATE_LIMITED`, `UNAVAILABLE`, `UPSTREAM_ERROR`, `INTERNAL_ERROR`, … |
| `activityId`, `fields`, `rev`, `recipients` | which stop, which fields of an edit (names only), the trip revision broadcast, how many tabs received it |
| `httpStatus`, `method`, `path`, `attemptedEvent` | for refused or failed requests (invite tokens in paths are masked) |

## Events

| Category | Events |
|---|---|
| User / session | `USER_SIGNED_UP`, `USER_SESSION_CREATED` (login), `USER_SESSION_ENDED` (logout), `USER_CONNECTED` / `USER_DISCONNECTED` (first page opened / last page closed) |
| Trips | `TRIP_CREATED` (also from a curated itinerary), `TRIP_OPENED`, `TRIP_UPDATED`, `TRIP_DELETED` |
| Sharing | `INVITATION_CREATED` / `_OPENED` / `_EXPIRED` / `_REVOKED` (24-hour links), `COLLAB_REQUEST_CREATED` / `_REPEATED` / `_APPROVED` / `_REJECTED`, `COLLABORATOR_ADDED` / `_REMOVED`, `TRIP_MEMBER_INVITED`, `TRIP_INVITATION_CANCELLED` / `_DECLINED`, `COLLAB_TRIP_JOINED` (accepted a username invitation), `COLLAB_TRIP_LEFT` |
| Publishing | `TRIP_PUBLISHED`, `TRIP_REPUBLISHED`, `TRIP_UNPUBLISHED`, `TRIP_FORKED`, `REVIEW_CREATED`, `REVIEW_UPDATED`, `REVIEW_DELETED` (rules in `docs/permissions.md`) |
| Editing | `TRIP_DESTINATION_ADDED`, `TRIP_DESTINATION_ADD_REPLAYED` (retried add, nothing changed), `TRIP_DESTINATION_REMOVED`, `TRIP_DESTINATION_REORDERED`, `TRIP_DESTINATION_MODIFIED`, `TRIP_SCHEDULE_MODIFIED` (a time or length changed, or a copilot fix applied), `TRIP_START_CHANGED`, `TRIP_ROUTE_CALCULATED`, `TRIP_ROUTE_MODE_SELECTED` |
| Real-time | `REALTIME_CONNECTED` / `REALTIME_DISCONNECTED` (one per tab stream), `COLLAB_COLLABORATOR_JOINED` / `_LEFT` (a person's first tab opened / last tab closed on a trip), `COLLAB_UPDATE_BROADCAST`, `REALTIME_CONNECTION_FAILED` |
| Other | `COPILOT_ASKED`, `CALL_INVITED`, `CALL_ACCEPTED`, `CALL_ENDED` |
| Refusals and errors | `UNAUTHORIZED_MODIFICATION_ATTEMPT` (a write refused with 401/403, or by a non-member), `ACCESS_DENIED` (the same for a read), `INVALID_TRIP_OPERATION` (400/409 and other refusals), `FEATURE_UNAVAILABLE` (503: no Google or AI key), `API_OPERATION_FAILED`, `UNHANDLED_ERROR`, `GOOGLE_API_FAILED`, `COPILOT_PROVIDER_ERROR`, `CALL_TURN_UNAVAILABLE` |
| Server | `SERVER_STARTED` (which integrations are configured, never their values), `SERVER_STOPPING`, `CONFIG_WARNING` |

Deliberately not logged: map-view sharing (`POST /view`, up to every 400 ms),
keep-alives, place searches and autocomplete, call signalling (SDP/ICE), and a
broadcast to a trip nobody else has open.

## How users are identified

Wayline already has accounts. Each browser holds an HttpOnly session cookie;
the server stores only its hash and resolves it to a user on every request
(`auth.userForToken`). That resolved user is the only identity logs use. A
`userId` sent in a request body is ignored, and a test sends a forged one to
check this. A live stream is opened by an authenticated GET, so each SSE
connection is tied to that same user, and HTTP and SSE lines carry the same
`userId`. No new identity mechanism was needed.

Two Chrome profiles have separate cookie jars, so two people signed in as two
accounts appear as two different `userId`/`username` values. The same account
open in two tabs shows one user with two `connectionId`s.

## Privacy

Never logged: passwords, cookies, session or invite tokens, API keys, TURN
credentials, SDP/ICE, request bodies, activity titles and notes, map
coordinates. Edits log which *fields* changed, not their values. Error
messages go through `sanitize()`, which redacts key-, token- and bearer-shaped
strings and caps the length. Fields whose names look secret are dropped.
Stacks of unexpected errors stay on the server and are sanitised too.

## Reading the logs

Locally:

```sh
pnpm start                                      # JSON lines in the terminal
pnpm start 2>&1 | jq -c '{t: .timestamp[11:19], who: .username, event, tripId, status}'
```

On Fly (one machine, so this is the whole app):

```sh
flyctl logs -a comp4020-final-lyclccylcq
flyctl logs -a comp4020-final-lyclccylcq | grep TRIP_          # trip activity
flyctl logs -a comp4020-final-lyclccylcq | grep '"level":"WARN"'
```

Fly prefixes each line with its own timestamp and machine id, and the JSON
follows.

## For the Crit 10 demonstration

Sign in as two different accounts in two Chrome profiles, open the same trip,
and run `flyctl logs` beside them. A typical sequence reads:

```
USER_SESSION_CREATED        alice   login
TRIP_CREATED                alice   tripId=…
INVITATION_CREATED          alice   linkId=…, expiresAt=… (24 h)
INVITATION_OPENED           bob
COLLAB_REQUEST_CREATED      bob     requestId=…   (no access yet)
COLLAB_REQUEST_APPROVED     alice   targetUserId=bob
COLLABORATOR_ADDED          alice   targetUserId=bob
REALTIME_CONNECTED          bob     connectionId=sse_…b
COLLAB_COLLABORATOR_JOINED  bob
TRIP_DESTINATION_ADDED      bob     activityId=…
COLLAB_UPDATE_BROADCAST     bob     recipients=2  (same requestId; alice's tab gets it)
UNAUTHORIZED_MODIFICATION_ATTEMPT  bob  errorCode=FORBIDDEN "Only the trip's owner can delete it."
COLLAB_COLLABORATOR_LEFT    bob
```

`spec/logging.test.ts` checks this attribution, the field shape, the order of
event and broadcast, that map views stay out, and that no password, cookie or
note text appears.
