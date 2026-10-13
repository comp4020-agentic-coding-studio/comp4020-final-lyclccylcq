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
   Billed at $0.05 per GB relayed out to clients (no charge for STUN or
   direct calls); TURN is free only alongside the SFU, which Wayline doesn't
   use. Opus voice is roughly 40–60 kbit/s each way, so a relayed hour is
   about 20–30 MB per direction: on the order of $0.003 per relayed
   call-hour. Most calls connect directly and cost nothing.
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
  replay of old offers or candidates), and the caller restarts ICE. If media
  doesn't recover within 15 s, the call ends with "Call again".
- ICE servers come from `POST /call/ice`: Cloudflare credentials (TTL 3 h),
  coturn HMAC credentials, optional STUN-only URLs, or nothing (direct
  connections only).

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
  other's frequency, mute silences it, playback-blocked and mic-denied
  paths, ICE-restart recovery and give-up, phone layout, and that editing
  continues during a call.

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
