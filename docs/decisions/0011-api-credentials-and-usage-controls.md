# 11. Protect credentials and bound API consumption

Recorded: 2026-11-07 (retrospective). Status: accepted; runtime secret storage and application controls are implemented. Exact live provider-console settings were not inspected for this record.

Browser/server Google key separation is recorded on 2026-10-11, persistent AI usage controls on 2026-10-19, and upstream planning cancellation on 2026-10-29. These are separate implementation stages, rather than one change introduced on the date of this record.

The author confirmed the choice of Fly secrets and additional API restrictions, including usage and request limits. The implementation details below were checked against the frozen repository; numeric defaults are distinguished from live configuration.

## Context and the author's reasons

Wayline depends on external services for maps, places, routes and model-assisted planning. Once I connected those services, I also had to take responsibility for their credentials and consumption. A working API integration was only one part of making the product usable beyond my own development session. Exposing a credential, repeatedly triggering a costly operation or allowing one person to consume the shared allowance would all affect the project's operation.

My choice was to store deployment credentials in Fly secrets and also restrict how the APIs could be used. I wanted protection around both the credential and the calls made with it: keeping the key safely configured does not, by itself, control how often a public application can trigger paid work. Request frequency and usage limits were therefore part of this decision from the operational side of the product.

### Runtime storage and the browser boundary

I chose Fly secrets for deployment configuration. Fly encrypts secrets in a vault and supplies them to the running application as environment variables. This keeps deployment credentials outside the source code and image and means the deployed service can obtain them independently of my laptop. Local development uses a gitignored `.env`, while `.env.example` contains placeholders. The storage mechanism follows [Fly's secrets documentation](https://docs.fly.io/apps/secrets).

The OpenAI key and Google server key are read on the server. Their values are not part of the browser's runtime configuration. Google Maps JavaScript has a different requirement: its browser key is deliberately supplied to the visitor so that the map can load. I therefore separated the browser and server keys. The browser key's policy is to allow Wayline's website origins and Maps JavaScript only; the server key's policy allows the Places, Routes and Geocoding services it needs. Separating keys and limiting their permitted applications/APIs follows [Google's key-security guidance](https://developers.google.com/maps/api-security-best-practices).

The repository does not configure a source-IP restriction for the server key. Its documented Fly setup has no stable outbound IP, so copying the browser key's website restriction or assuming an IP allowlist would misdescribe this deployment. Key separation and its implementation history are recorded in [a32c15b](https://github.com/comp4020-agentic-coding-studio/comp4020-final-lyclccylcq/commit/a32c15b76dda04bee215e8d42459f2f926a42d40) and [Google key setup](../google-maps-keys.md).

### Application limits on model calls

For this project's small-group deployment, I chose one shared AI allowance across the application. The implementation admits a call only after checking its daily request count, token allowance and concurrent calls. The configurable defaults are:

| Control | Repository default | Scope |
|---|---|---|
| Daily model calls | 100 | Application-wide, per UTC day; admitted failures count too |
| Concurrent model calls | 3 | Application-wide |
| Daily token admission threshold | 400,000 | Completed input/output usage plus reservations for running calls |
| Maximum output per call | 3,000 tokens | The day planner requests 2,500 within this ceiling |
| Call timeout | 45 seconds | Per model call |
| Automatic retries | 0 | SDK retries are disabled; another user attempt consumes another admission |

These numbers come from code defaults and are not a claim about the current values stored on Fly. The user identifier is recorded with usage but does not create a separate quota for each person.

The allowance is stored in SQLite on the retained volume. Checking the allowance and reserving a call happen in one transaction, so two requests cannot both take the final slot. Restarting the process against the same database does not reset the daily count. A rejected admission does not contact the provider. Completed calls replace their output-token reservation with the input/output counts returned by the provider; expired leases release abandoned concurrency slots. Cancelling a running day optimisation also reaches the upstream request. These mechanisms are recorded in [b20fc88](https://github.com/comp4020-agentic-coding-studio/comp4020-final-lyclccylcq/commit/b20fc8895863ef981768b88a3609030ff23ea226), [8d2aec6](https://github.com/comp4020-agentic-coding-studio/comp4020-final-lyclccylcq/commit/8d2aec6d856cba90f3d7c25de3a83a71440b77b7), [aiusage.ts](../../src/aiusage.ts) and [ai.ts](../../src/ai.ts).

### Public request limits and provider restrictions

Public discovery endpoints have a separate per-IP fixed-window limiter. The place/discovery group allows 60 counter units per minute and the route group 30. A rich search consumes two place counter units. These are application admission counters: one admitted HTTP operation can still trigger several provider requests. The counters are held in process memory and reset on restart, unlike the persistent AI daily allowance ([discovery.ts](../../src/discovery.ts), [ratelimit.ts](../../src/ratelimit.ts)).

Provider-side restrictions form another boundary, including permitted APIs, service quotas and request-rate limits. For Google Maps, service quotas constrain consumption; a billing budget alert only notifies and does not automatically stop spending. The quota's unit must also match the relevant service's billing behaviour ([Google cost controls](https://developers.google.com/maps/billing-and-pricing/manage-costs)). OpenAI distinguishes spend alerts from an explicitly enforced organisation/project hard spend limit; enforcement can have a delay ([OpenAI spend controls](https://developers.openai.com/api/docs/guides/spend-limits)). The author's choice includes API usage and access restrictions, but this documentation review does not establish the exact console thresholds or whether a particular provider hard-spend mode is enabled.

## Options and decision

- Putting a server credential in source code, an image or public configuration would expose it beyond the running backend. Deployment credentials are supplied through Fly secrets instead.
- Using only secret storage would still leave consumption through legitimate application requests uncontrolled. I also chose bounded model calls, public endpoint throttling and provider restrictions.
- Reusing one Google key for browser and server work would mix different exposure and restriction requirements. Separate keys keep those responsibilities distinct.
- A shared AI allowance fits the present small-group, single-machine deployment. It gives up per-user fairness and would need revision as the service grows.

## Consequences and costs

Limits can deny a useful request: one person's repeated attempts can exhaust the shared daily allowance, and people on the same public IP can share a short-term throttle. The interface must explain unavailability while keeping ordinary itinerary work usable. A second machine with a separate database would have separate AI counters; the present design assumes the single retained database described in [ADR 0003](0003-sse-snapshots-and-versioned-edits.md).

The token threshold is an admission safeguard, rather than an exact token or monetary hard ceiling. It reserves maximum output before the input usage is known; completed or concurrent work can therefore take recorded totals above the threshold, and unavailable provider usage cannot be fully reconciled. Any cost figure also depends on configured prices and remains an estimate. Provider billing and explicit provider controls remain separate.

Fly secrets also remain readable by the running application and by someone able to deploy code that reads them. Application limits govern traffic through Wayline; a stolen key used directly would bypass those checks. The chosen restrictions reduce exposure and consumption risk without claiming complete protection.

## Evidence and record notes

Existing tests cover allowance overrides, persistence after reopening the database, failed-call counting, competing reservations and expired leases ([aiusage.test.ts](../../spec/aiusage.test.ts)). Browser-configuration checks protect the server-key boundary ([restart.test.ts](../../spec/restart.test.ts)); log-redaction checks are in [logging.test.ts](../../spec/logging.test.ts). These are application checks, not evidence that a live provider dashboard has a particular setting.

[AI implementation notes](../ai.md) and [Google key setup](../google-maps-keys.md) contain operational details. [ADR 0007](0007-bounded-planning-assistant.md) explains the assistant's product role. This record explains credential and consumption choices; it does not change credentials, quotas or application behaviour.
