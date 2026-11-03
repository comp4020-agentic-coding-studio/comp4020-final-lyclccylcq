# Permissions, invitations, publishing and reviews

Everything here is enforced on the server. The UI only hides controls that
would be refused. The rules live in one place, `src/permissions.ts`; the trip
store (`src/trips.ts`) and the publications store (`src/publications.ts`)
call it, and every identity comes from the session cookie, never from a
request body (`userId`, `ownerId`, `role` or a review author sent by a client
are ignored).

## Roles on a trip

| | Owner | Collaborator | Anyone else |
|---|---|---|---|
| View the trip, open its live stream | ✓ | ✓ | 404 |
| Add stops | ✓ | ✓ | 404 |
| Edit, move, re-place or remove a stop they added | ✓ | ✓ | 404 |
| Edit, move, re-place or remove someone else's stop | ✓ | 403 | 404 |
| Set or change the starting point | ✓ | 403 | 404 |
| Calculate a route between stops | ✓ | ✓ | 404 |
| Choose a transport mode, apply a copilot fix | ✓ | 403 | 404 |
| Rename, change dates or meal times | ✓ | 403 | 404 |
| Invite (link or nickname), see and decide join requests | ✓ | 403 | 404 |
| Remove a collaborator | ✓ | only themself (Leave) | 404 |
| Delete the trip | ✓ | 403 | 404 |
| Publish, republish, unpublish | ✓ | 403 | 404 |

401 means not signed in, 403 means a member without the right (the message
says who can), and 404 means not a member, so a trip id reveals nothing.
Removing a collaborator, or deleting the trip, sends `revoked` on their open
streams and closes them at once (`hub.publish`).

The collaborator rule is the conservative one from the October 2026 brief:
collaborators add, and can change only what they added (`activities.created_by`).
Before that, any member could change any stop. The version check and the
"load theirs / save mine" conflict flow still apply, mostly between the owner
and the stop's author now.

## Invite links

- `POST /api/trips/:id/invite` (owner) makes a 256-bit random token. Only its
  SHA-256 hash is stored, in `trip_invite_links`, with `created_at`,
  `expires_at = created_at + 24 h` (the server's clock), `created_by` and
  `revoked_at`. The token is shown once. Making a new link revokes the old
  one; it never extends it. `DELETE` revokes; `GET` returns the current
  link's times (never the token).
- Opening `/join/<token>` (`GET /api/invites/:token`) shows only the owner's
  name, the trip's title and destination, the expiry, and this person's state:
  `can_request`, `pending`, `rejected`, `expired` or `member`. No dates, stops
  or members.
- **A link never adds anyone.** `POST /api/invites/:token/request` (signed in,
  link live) creates a `trip_join_requests` row, `pending`. It's tied to the
  account that asked: one pending request per person per trip (partial unique
  index); asking again returns the same request; members get 409; an expired
  link gets 410. Someone forwarded the link must ask for themself.
- The owner sees requests in the share dialog and on My Trips (a live badge;
  the owner's own stream is told when one arrives) and approves or rejects
  each one (`POST /api/trips/:id/requests/:rid/approve|reject`). Approving adds
  the collaborator and closes the request in one `mutate()`, so open editors
  see the new member. A request can't be decided twice (409), and nobody can
  decide their own. A request made before the link expired can still be
  decided after.
- Rejection grants nothing. A rejected person can ask again only through a
  link that's still valid; that's a new request.
- Inviting by nickname (`trip_invitations`) is unchanged: the owner chose that
  account, and the invitee accepts in My Trips.

**Legacy links.** Links made before October 2026 (`trips.invite_hash`) never
expired and let people in without approval. On startup they're cleared, so
none can stay permanent; owners make a new, expiring link when they need one.

## Publishing

- `PUT /api/trips/:id/publication` (owner, with a description) copies the trip
  as it is now into `trip_publications` + `publication_stops`: title,
  description, destination, time zone, days, cover photo key, author, and each
  stop's day, order, time, length, kind, meal and place. **Notes, members,
  links and requests are never copied.** A trip with no stop besides the
  starting point can't be published (400, `code: "empty"`).
- The publication is a snapshot. Editing the trip doesn't change it; the
  trip's snapshot carries `publication.outdated` and the owner chooses
  "Update published version", which replaces the stops but keeps the same
  `pub-…` id, first-published time and reviews.
- `DELETE` unpublishes: it disappears from discovery, `GET` answers 404 to
  everyone but its author, and new forks are refused. Reviews and existing
  forks stay.
- **Who can find it** (November 2026, `trip_publications.visibility`): a
  new publication is `link` (link only): readable by anyone who has its
  address, `/journeys/pub-…` (the id is a random UUID, so knowing it is
  the permission), and listed nowhere. The owner can choose `listed`, which
  also puts it under "Shared by travellers". Republishing keeps the choice
  unless the owner changes it. Publications made before this were listed
  and stay listed. Either way a publication grants no access to the trip:
  reading it never lets anyone edit, and it's separate from invite links.
- `/journeys/pub-…` is the shareable journey page (`public/journey-page.js`):
  read-only, for anyone signed in or not, built only from the snapshot
  (cover, title, destination, length, the author's display name, the
  description, an overview of the stops and the days). No username, notes,
  members or travel times (a snapshot keeps none). Its author sees a line
  saying how it's shared and a link to manage it on their profile.
- Listed publications are returned by `GET /api/publications` and shown on the
  homepage as "Shared by travellers", labelled with the author, separately
  from "Curated by Wayline" itineraries (which are unchanged). A publication's
  page is `/itineraries/pub-…`, read-only for everyone: there's no route that
  edits a publication other than its owner republishing their own trip.
- Google coordinates in a publication follow the same 30-day rule as trips;
  a custom pinned spot is the author's own choice and doesn't expire.

## Exporting (print / PDF)

- `/trips/:id/print` is a printable copy of the working trip, for its
  members, whether or not it's published. It's linked as "Export" in the
  editor's bar and beside each trip on `/profile`.
- It reads `GET /api/trips/:id`, so the usual roles apply: members (owner or
  collaborator) see it, everyone else gets the same 404 as a missing trip.
  Nothing new is stored, shared or logged; it isn't a link to give out.
- Unlike a publication it includes notes and the members' names, because
  only members can open it. Travel between stops appears only where a route
  was already looked up (Google's duration and distance, marked when stale);
  printing never calls Google.

## Profiles

`/profile` (`public/profile.js`) is the signed-in person's own page, read
and written only through `/api/me/profile` and `/api/me/publications`, so
the session decides whose it is. It shows what the account holds: display
name, `@username`, an optional bio (up to 280 characters) and when they
joined. Accounts have no email address, so none is shown or asked for, and
there are no avatar uploads: avatars are initials. `PATCH /api/me/profile`
changes the display name (the sign-up rules and uniqueness, a 409 naming the
field on a clash) and the bio; the username never changes. There is no
public profile page.

Its journeys are the same records as My Trips, in three tabs: trips they own
(marked private or published), trips shared with them, and their
publications, where they copy a link, update it to the current plan, switch
between listed and link only, unpublish or publish again. Unpublishing never
touches the trip.

## Forking ("Use This Template")

`POST /api/itineraries/pub-…/copy` (signed in; published only) creates a new
trip with a new id, owned by the person forking, private, with the
publication's stops on the chosen dates. It copies the snapshot, not the
author's working trip. It never copies members, invitations, links, requests,
reviews or publishing state. `trips.forked_from_publication_id`,
`forked_from_title`, `forked_from_author` and `forked_at` record where it came
from; the editor and My Trips show "Based on … by …". The fork and the
original are independent from then on, in both directions, and a fork keeps
working after the original is unpublished. A fork can be published as its own
publication, with its own reviews.

Copying one of Wayline's curated itineraries works as before (`createFromTemplate`).

## Reviews

`PUT /api/itineraries/pub-…/reviews` with `{ rating: 1–5 (integer), comment? }`
(signed in, published only). One review per person per publication (unique
index): a second PUT edits the first. Authors can't review their own trip
(403). `DELETE …/reviews/:id` deletes your own; anyone else's is a 403. The
average and count are computed on the server (`avg(rating)`, rounded to one
decimal). Reviews belong to the publication and are never copied into forks.

## Logging

Every action above writes one structured log line (`docs/logging.md`):
`INVITATION_CREATED`, `INVITATION_OPENED`, `INVITATION_EXPIRED`,
`INVITATION_REVOKED`, `COLLAB_REQUEST_CREATED`, `COLLAB_REQUEST_REPEATED`,
`COLLAB_REQUEST_APPROVED` (+ `COLLABORATOR_ADDED`), `COLLAB_REQUEST_REJECTED`,
`COLLABORATOR_REMOVED`, `COLLAB_TRIP_LEFT`, `TRIP_PUBLISHED`,
`TRIP_REPUBLISHED`, `TRIP_UNPUBLISHED`, `TRIP_FORKED`, `REVIEW_CREATED`,
`REVIEW_UPDATED`, `REVIEW_DELETED`, and refusals as
`UNAUTHORIZED_MODIFICATION_ATTEMPT` / `ACCESS_DENIED`. Invite tokens are masked
in logged paths and never written.

## Tests

`spec/permissions.test.ts` covers the invite lifecycle (including the 24-hour
expiry on a controlled clock and the legacy-link migration), approval,
forwarding, the role matrix, stream revocation, publishing, snapshots, forks,
unpublishing and reviews. `spec/browser.test.ts` runs the join, approve,
collaborate flow through the UI in two Chrome sessions.
