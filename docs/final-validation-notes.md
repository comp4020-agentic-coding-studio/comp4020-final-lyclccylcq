# Final functional validation record

Recorded review: 7 November 2026, Australia/Sydney.

Functional baseline: [a5f74014b3165d85ae5c9ec55161eecb2fe49f86](https://github.com/comp4020-agentic-coding-studio/comp4020-final-lyclccylcq/commit/a5f74014b3165d85ae5c9ec55161eecb2fe49f86).

This record summarises the functional freeze review and the CI/deployment evidence already recorded for that version. It was compiled during documentation editing; the application suite and real-service calls were not rerun for that edit.

## Checks and scope

| Check | Recorded result | Scope |
|---|---|---|
| Full CI | 386/386 tests passed in 40 test files; check and deploy jobs succeeded | [Run 42339790425](https://github.com/comp4020-agentic-coding-studio/comp4020-final-lyclccylcq/actions/runs/42339790425) |
| Separate local functional review | Typecheck passed; 367/367 tests passed in 38 files, with no failed or skipped tests | Isolated application/database; the two exclusions below account for the difference from CI |
| Delivered public assets | 31/31 SHA-256 comparisons matched the frozen source | 29 public JS/CSS/SVG files and two new cover images; a content check of those assets |
| Journey-window destinations | All five destination entries reached non-empty itinerary details at both marking sizes | Switzerland, London, Sydney, Maldives and Shanghai; 1920×1080 and 390×844 |
| Late navigation responses | Eight controlled success/failure navigation scenarios and two late-map cleanup scenarios passed | Desktop and phone; [browser-navigation.test.ts](../spec/browser-navigation.test.ts), fixed in [275dde8](https://github.com/comp4020-agentic-coding-studio/comp4020-final-lyclccylcq/commit/275dde8d53e4b9370d3420bdb72d7dd71320d55d) |
| New curated itineraries | Upgrade checks preserved existing user data; preview, map, export and private copying paths passed | [curated-upgrade.test.ts](../spec/curated-upgrade.test.ts), [curated.test.ts](../spec/curated.test.ts), [browser-navigation.test.ts](../spec/browser-navigation.test.ts) |

The independent local review omitted `spec/browser-call.test.ts` (17 tests: no voice implementation change) and `spec/invariants.test.ts` (two course publishing checks, outside that functional review's scope). The full CI included both. The two totals describe overlapping scopes and must not be added together.

## Limits of the record

- The public-file comparison verifies those delivered assets; it is not a hash of the complete running backend.
- Controlled provider stand-ins exercise application rules and failure paths. They do not prove live Google/OpenAI availability. Earlier real-service examples are separately recorded in [Crit 10 notes](crit-10-notes.md).
- Current CI covered the voice tests; this independent freeze pass did not repeat them or conduct a two-device call across physical networks.
- New itinerary export pages were observed completing image generation. The new raw PNG downloads were not saved for pixel inspection in this pass; existing automated export checks and earlier image inspection are separate evidence. System print-to-PDF was not repeated.
- This pass did not repeat a full two-person live planning session or a live editor recovery across a production restart. Earlier synchronisation and network-drop observations remain in [Crit 9 notes](crit-9-notes.md).
- These checks do not establish long-term usability, larger-group behaviour or multi-machine scale. Documentation quality is assessed separately from functional results.
