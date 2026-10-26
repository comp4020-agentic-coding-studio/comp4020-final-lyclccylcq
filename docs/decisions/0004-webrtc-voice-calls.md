# 4. Two-person voice calls: WebRTC media, signalling on the trip's SSE stream

Date: 2026-10-13 · Status: proposed (implemented and tested locally; not
deployed; TURN not provisioned; drafted by the agent for the author's review)

## Context

The author authorised (October 2026) an exception to the "no chat" rule: two
people on the same trip can talk in an audio-only call while both keep
editing the shared map and timeline. The call is a conversation between the
collaborators; it must never be recorded, transcribed or sent to the AI. It
must reuse Wayline's accounts, trip membership and real-time hub
(ADR 0003), keep the map and timeline central, and never touch the
itinerary's revision.

## Problem

A browser call needs three things: a way for the two browsers to find each
other and agree on a session (signalling), a media path that works through
home routers and mobile networks (ICE: direct, or relayed through TURN), and
authorisation so only members of the trip can ring each other or see the
messages. The app runs on one small Fly machine; real-time state is already
in memory there.

## Options considered

**Media**

1. *Native WebRTC, peer to peer (chosen).* Audio is encrypted by the
   browsers (DTLS-SRTP) and goes directly between them, or through a TURN
   relay that can't decrypt it. No media server to run, no audio through
   Fly.
2. *A selective forwarding unit (Cloudflare Realtime SFU, LiveKit, mediasoup).*
   Needed for group calls or recording; neither is wanted, and it adds a
   service and media through a third party on every call.
3. *Audio through Wayline's server.* Costs bandwidth on the small machine,
   and puts audio somewhere it could be recorded. Rejected.

**Signalling**

1. *Authenticated POSTs out, targeted events in on the existing trip SSE
   stream (chosen).* The stream already exists per tab, is authenticated by
   the session cookie, already models one tab per `session` id, and already
   closes for a removed member. Writes get the same JSON + same-origin
   protection as every other write.
2. *A WebSocket.* Lower latency for ICE trickling, but a second real-time
   channel to authenticate, keep alive through Fly's proxy and test, with no
   benefit at two participants and a handful of messages per call.
3. *A third-party signalling service.* Another account, and call metadata
   held elsewhere.

**Relay (TURN)**

1. *Cloudflare Realtime TURN (proposed).* Managed, anycast, UDP/TCP/TLS on
   443. The server keeps a TURN key id and API token and asks Cloudflare for
   short-lived credentials per call; the browser only ever gets those.
   Billed at $0.05 per GB sent from Cloudflare to clients, after a free
   allowance of 1,000 GB a month shared with the Realtime SFU (Cloudflare
   Realtime pricing page, last updated 2026-09-22, checked 2026-10-14);
   STUN and direct calls cost nothing. Opus voice is roughly 40–60 kbit/s
   each way, so a relayed call-hour is about 20–30 MB per direction, far
   inside the free allowance at this app's scale; past it, about $0.003 per
   relayed call-hour. Cloudflare documents no spending cap for TURN, so the
   controls are on Wayline's side: credentials only for signed-in trip
   members, `POST /call/ice` rate-limited per user, two participants per
   call, a 4 h call limit and a 5 h credential TTL, so credentials outlast
   any call (Cloudflare allows up to 48 h).
2. *Self-hosted coturn on a separate small VM (supported).* Same short-lived
   credentials via the `use-auth-secret` HMAC scheme (`WAYLINE_TURN_URLS`,
   `WAYLINE_TURN_SECRET`). Needs a public IP, UDP and TLS ports, a
   certificate and someone to patch it. It must not run on the existing
   Fly app machine.
3. *Free public relays.* No control or accountability, and their
   credentials are effectively public. Rejected; the code never embeds any.

## Decision

- Audio-only `RTCPeerConnection` between the two tabs in the call, with
  MDN's "perfect negotiation": the callee is polite, the caller impolite.
- Signalling in `src/calls.ts`: `POST /api/trips/:id/call` (invite),
  `/call/:callId/accept|decline|hangup|signal`, `POST /call/ice`. Events go
  out as `event: call` on the trip SSE stream, addressed to one user's tabs
  (invite/ended) or to the one tab holding the call (descriptions,
  candidates, mute). Each event carries a per-call increasing `seq`.
- State is a `Map` in memory: call id, trip, the two users, which tab
  answered, timers. It is never written to the database, never calls
  `mutate()`, never changes `rev`. SDP and candidates are relayed and
  forgotten.
- One call per person across all their tabs. A second `Call` while busy is
  a 409; two people pressing Call at once merge into one call (the second
  invitation is treated as accepting the first).
- Every action re-derives the user from the session and re-checks trip
  membership. Losing membership, signing out, hanging up, closing the editor
  or an unanswered invitation (30 s) ends the call and tells the peer.
- A tab whose stream drops keeps the call for a 20 s grace period. When its
  stream comes back with the same tab id it gets a `resume` event (never a
  replay of old offers or candidates), and the caller restarts ICE.
- Recovery: a `disconnected` connection gets 3 s to repair itself before
  anything is shown; then (or at once on `failed`) the caller restarts ICE
  and retries after 1.5 s, 3 s, 5 s and every 5 s, and immediately on
  `resume` or the browser's `online` event. Each attempt makes and sends its
  own restart offer, rolling back one whose answer never came. The callee,
  which never offers, sends a `restart` signal asking the caller for one.
  If media doesn't recover within 30 s, the call ends with "Call again".
- A first connection gets 15 s. A lost offer or answer leaves ICE at "new"
  or "checking", which never becomes `failed`, so after 15 s still
  "Connecting" the same recovery runs. While the first offer is unanswered
  the caller resends that offer rather than rolling it back (the callee may
  already have applied it and would refuse a different one). A call that
  never connected ends with "couldn't connect", not "lost".
- Events that reach the caller before the response to its own Call request
  (the answer, and after a merge the offer and candidates) are held and
  replayed once that response gives the call id.
- ICE servers come from `POST /call/ice`: Cloudflare credentials (TTL 5 h),
  coturn HMAC credentials (TTL 5 h), optional STUN-only URLs, or nothing (direct
  connections only).
- Only the caller sends offers. The callee's track goes out in its answer,
  and signals that reach a tab before its peer connection exists (it is
  still fetching ICE servers) are held and applied once it does.
- The call lives in a floating window that `public/voice.js` mounts once on
  `<body>`, with one persistent `<audio>` element, so the editor's
  re-renders can't touch the media. The remote stream is built from the
  received track (`event.streams` may be empty); every start goes through
  `play()`, a refusal shows "Turn on sound" (whose click calls `play()`
  directly), and playback is confirmed by the element's clock advancing.

## Rationale

The trip stream is the narrowest thing that already does authenticated,
per-tab, server-to-browser delivery; reusing it means voice inherits the
access rules that are already tested (outsiders get 404, removed members
are cut off) instead of re-implementing them. Peer-to-peer media keeps
audio off Wayline's server entirely, which is both the privacy promise and
the cost model. TURN is the only part that costs money, and only for calls
that can't connect directly.

## Consequences

- `realtime.ts` gained `sendTo`, `hasSession`, `isOnline` and join/leave
  hooks; `/api/config` gained `calls: { enabled, relay }` (pinned in
  `spec/restart.test.ts`).
- The privacy page describes what passes through the server (connection
  details, in memory) and through a relay (network address and encrypted
  audio).
- `spec/calls.test.ts` covers authorisation, routing, busy/simultaneous,
  multiple tabs, removal, sign-out, expiry, grace, rate limits and resume
  without replay. `spec/browser-call.test.ts` runs two Chrome instances
  with different fake-microphone tones and checks each side receives the
  other's frequency in the stream the call window plays, and separately
  that the `<audio>` element is playing it (unpaused, unmuted, clock
  advancing). Chrome runs with its normal autoplay rules. It also covers
  mute, a late callee's offer, simulated blocked playback recovered by a
  real click, mic-denied, ICE-restart recovery and give-up, edits, panels,
  minimize and the phone layout during a call, and that hang-up stops the
  microphone and empties the element. Headless Chrome can't measure what
  reaches a speaker, so whether a person hears speech is a manual check.

## Limitations

- **Single machine.** Call state and the hub are in memory; a second Fly
  machine would split them (ADR 0003). A restart ends every call
  ("server restarted").
- **Not production-ready across networks until TURN is provisioned and
  tested.** The automated tests run both browsers on one machine, where a
  direct (host-candidate) connection always works. They prove signalling,
  negotiation and media delivery, not NAT traversal. Without TURN, calls
  between restrictive networks (symmetric NAT, some mobile carriers,
  corporate Wi-Fi) will fail to connect and end with a clear message.
- Two participants only; no group calls, video, screen sharing or
  recording.
- Leaving with the tab closed relies on a best-effort `keepalive` hang-up
  and the 20 s grace period.
- Safari/iOS has not been tested.

## History

- 2026-10-13: proposed and implemented locally; TURN service not yet
  approved or provisioned; not deployed.
- 2026-10-13: deployed in commit 61fe60b (Fly release v25) without TURN or
  an AI key configured; production calls are limited to direct connections.
- 2026-10-14: TURN cost corrected against Cloudflare's current pricing page
  (an earlier draft said TURN was free only alongside the SFU; it now has a
  1,000 GB/month free allowance).
- 2026-10-15: a report of calls that connect but are silent. Not reproduced
  on one machine; three defects that lead to a connected-looking call with
  no sound or a stuck one were found and fixed: an offer that beat the
  callee's peer connection was dropped (stuck at "Connecting"); the callee
  could offer at the same time as the caller (stuck); and a refused
  `play()` was hidden by the element's `autoplay` attribute, and a stream
  that gained its track after assignment could sit "playing" at
  readyState 0, both silent with no message. The controls moved from the
  trip bar into a floating call window. Production then had no TURN
  secrets set (`/api/config` reported `relay: false`).
- 2026-10-15: TURN secrets set on Fly (release v28); the server's
  `/call/ice` returned Cloudflare relay credentials, and two local browsers
  forced to relay connected and heard each other's tone.
- 2026-10-15: calls across networks reconnected repeatedly and then ended.
  Reproduced with a few seconds of lost signalling: the one ICE restart
  offer, sent while the network was down, was lost and never retried, so the
  call gave up at 15 s although the network was back. Restarts are now
  retried (with an immediate retry on reconnect), the callee can ask for
  one, brief `disconnected` blips don't trigger anything, and the limit is
  30 s.
- 2026-10-26: a report of a call stuck at "Connecting" on one side.
  Not reproduced in that exact form (callee "Connected", caller
  "Connecting") on one machine. Two-browser runs with injected faults
  reproduced permanent hangs from two defects: events that beat the
  caller's own Call response were dropped (caller "Calling…", callee
  "Connecting…" for good; also when both called at once), and a first
  connection had no time limit, so a lost offer or answer, or the
  caller's signalling dropping at the moment of answer, left both sides
  "Connecting…" indefinitely. Both fixed (above), with regression tests that
  fail on the old code. Real Cloudflare TURN was checked the same day:
  credentials minted for both sides (STUN included), and relay on both,
  either or neither side connected. Still unverified: other devices,
  networks and browsers.
