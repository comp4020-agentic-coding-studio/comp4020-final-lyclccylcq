# Process overview — Final

## Why I changed the subject

My choices start from real situations. Virtual Gym came from training alone in the quiet gym beneath my residence. I wanted the atmosphere of exercising alongside others, but frequent interaction made little sense while actually training. An equipment-occupancy page seemed less useful than asking someone in person. I therefore decided to leave the gym theme and look for another project.

I next considered a cooperative RPG, but it would need enough players with the right professions, plus artwork I could not easily produce. That made it difficult to build and test at a small scale, so I gave up that idea too.

The turning point came when a friend from China visiting Australia asked for itinerary recommendations. That gave me a problem I actually wanted to solve. I changed to Wayline on 9 October ([6305228](https://github.com/comp4020-agentic-coding-studio/comp4020-final-lyclccylcq/commit/63052286cdbde3c5d6c61aa8378bb08cf0824a11); [full pivot reasoning](docs/decisions/0005-project-theme-and-pivot.md)).

Social media gave us places we wanted to visit, with little sense of their distances. Collecting information separately also produced duplicate and conflicting choices. I needed a map and one itinerary we could change together. Later, sharing a teammate's map view helped us discuss a place without searching for it again, while keeping control of our own screens ([3f27110](https://github.com/comp4020-agentic-coding-studio/comp4020-final-lyclccylcq/commit/3f27110edff0a6fa0d3fada34ab7578daf0f45b8); [map decisions](docs/decisions/0006-map-and-shared-planning.md)).

## Working out what belonged in the product

My first thought was to let AI generate the whole trip. But when I plan, I already have places I want to visit. I need help making them into a workable day, and would have to review a generated trip anyway. I chose schedule review, food along the route and nearby exploration. Claude's first interaction still felt like a chatbot. Experience improving the AI coach in my fitness-logging app had taught me that if one action can do the job, I do not want repeated conversation. I changed it to task buttons, then to selecting several repairs and applying them together ([f99cdf0](https://github.com/comp4020-agentic-coding-studio/comp4020-final-lyclccylcq/commit/f99cdf0fd8eab349be33927f029429835df09a6d), [48c1215](https://github.com/comp4020-agentic-coding-studio/comp4020-final-lyclccylcq/commit/48c1215f7dc005ae3f7edc9249b0afcae5f8b0aa); [assistant decisions](docs/decisions/0007-bounded-planning-assistant.md)).

Actual use changed other assumptions. Crit feedback exposed empty restaurant results away from commercial areas; I revised search distances and preferences. Planning with a classmate exposed my casually borrowed GitHub permission model: too much ordinary editing had to go through the owner. I widened planning rights while retaining ownership of management actions ([9c63890](https://github.com/comp4020-agentic-coding-studio/comp4020-final-lyclccylcq/commit/9c63890d03fb62abda5af5a3e8538d9f3e0579b8); [permission revision](docs/decisions/0008-planning-rights-and-management.md)).

Real-service checks also exposed a route fallback that silently replaced unavailable transit with driving. The fix removed it: a recommendation could otherwise ignore the traveller's choices ([a005e90](https://github.com/comp4020-agentic-coding-studio/comp4020-final-lyclccylcq/commit/a005e902ad410000e0aeb916edb93f1a325c866b)). Meal suggestions also had to fit the full visit inside opening hours ([e2dae22](https://github.com/comp4020-agentic-coding-studio/comp4020-final-lyclccylcq/commit/e2dae226bf76ce2543417eeb5246db4fe08037a1)). I kept schedule arithmetic in code and used Google for places and routes; a model's fluent answer could not replace those checks.

Voice was an extra convenience. Testing showed the cost of connection recovery and TURN fallback, so I kept calls at two people even though planning supports more. I accepted that mismatch instead of extending the risk into group calls ([voice trade-offs](docs/decisions/0004-webrtc-voice-calls.md)).

## Taking ownership of the result

At first I left the visual design largely to Claude. A separate model review called it generic, and I agreed that a project I wanted to use afterwards deserved more thought. Repeated additions also made me concerned about code redundancy. Once the agent could add functionality quickly, I worried more about whether the next change would be manageable. The 29 October refactor extracted logging, planning and sharing responsibilities before further iteration ([dfce3ef](https://github.com/comp4020-agentic-coding-studio/comp4020-final-lyclccylcq/commit/dfce3ef853434c8d07d79f855dc1daba4a51d119)).

The homepage developed from video experiments into a train-window journey, with a metro-map visual language. I rejected artificial foreground effects after seeing them beside photographs. Later work unified the screens, added Chinese/English switching and corrected layouts exposed by crit feedback. I left out dark mode because I did not think its cost and disruption to the design suited this travel website ([visual decisions](docs/decisions/0009-visual-identity-and-maintainability.md)). Near the end I also realised the plan needed an output: an image I could keep in my phone's album while travelling ([export decision](docs/decisions/0010-portable-itinerary-output.md)).

## Why I kept the stack

The pivot retained plain Node, SQLite and browser modules. They fitted one small Fly Machine and its persistent volume, without a frontend build or ORM. The cost was managing routing, DOM lifetimes and module structure ourselves ([stack alternatives](docs/decisions/0001-plain-node-and-sqlite.md)).

Writes already used HTTP, so SSE supplied server-to-browser updates without another two-way channel. Whole snapshots made reconnect recovery simpler than merging patches. Transactions save before broadcasting; versions reject stale edits and client IDs prevent duplicate additions. This suits small itineraries, but the in-memory hub and separate local database would need redesign for several machines ([SSE alternatives](docs/decisions/0003-sse-snapshots-and-versioned-edits.md)). I kept credentials in Fly secrets and bounded API consumption as well as protecting the keys ([API decision](docs/decisions/0011-api-credentials-and-usage-controls.md)).

## How I directed and checked the work

I supplied situations, boundaries and feedback; Claude implemented them. A successful build could not tell me whether I wanted a chatbot or whether the window looked convincing. I had to use the result. Working rules went into [CLAUDE.md](CLAUDE.md), with testable consequences in spec/.

One useful correction came from the Crit 9 audit. The normal editor supplied a starting-point version, but a request omitting it could overwrite the start. The fix required a valid version or explicit null. Its regression test failed against the old implementation, then checked malformed and missing versions without changing the original start. The same commit updated CLAUDE.md ([7278cfe](https://github.com/comp4020-agentic-coding-studio/comp4020-final-lyclccylcq/commit/7278cfee5dd14cadd063479a29bf3774b0465841)). That gave the next agent both a rule and a check.

Later checks held responses open to reproduce work arriving after navigation or cancellation, rather than only testing successful requests ([8d2aec6](https://github.com/comp4020-agentic-coding-studio/comp4020-final-lyclccylcq/commit/8d2aec6d856cba90f3d7c25de3a83a71440b77b7), [275dde8](https://github.com/comp4020-agentic-coding-studio/comp4020-final-lyclccylcq/commit/275dde8d53e4b9370d3420bdb72d7dd71320d55d)). I also changed the checking policy: relevant checks during iteration, the non-voice suite before commits, and voice-browser tests for voice changes because they interrupt my other work. Full CI remained ([574173d](https://github.com/comp4020-agentic-coding-studio/comp4020-final-lyclccylcq/commit/574173d39fac5b01d8555686741a4465d53e9223)).

## Looking back at these choices

Reading [Sloan](https://www.robinsloan.com/notes/home-cooked-app/) while preparing this account helped me explain why serving particular people matters; Wayline's changing travel groups still need invitations. [Amershi et al.](https://www.microsoft.com/en-us/research/publication/guidelines-for-human-ai-interaction/) help me examine whether the assistant is understandable and easy to invoke or correct. My own AI-coach work supplied the original experience.

The [functional baseline](https://github.com/comp4020-agentic-coding-studio/comp4020-final-lyclccylcq/commit/a5f74014b3165d85ae5c9ec55161eecb2fe49f86) passed 386 CI tests. [Validation notes](docs/final-validation-notes.md) separate automated, real-service and manual checks. [Engineering and workflow notes](docs/final-engineering-notes.md) retain the implementation details and failure cases; the linked ADRs retain my full decision accounts. This overview was edited with agent assistance from my explanations, reflections and Git history.
