# 7. Use a bounded planning assistant instead of whole-trip generation or open chat

Recorded: 2026-11-07 (retrospective). Status: accepted; the chosen direction is implemented.

Preferences and day planning recorded on 2026-10-19; button-led assistant implemented the same afternoon; later preference presentation and stale-result handling continued in November.

The personal rationale was supplied by the author during the Final documentation review. Code dates below identify implementation stages.

## Context and the author's reasons

### Deciding what the assistant should actually do

The role of AI was one of the project's central trade-offs. My first reaction was to let it generate an entire itinerary: the user would select very few destinations they were interested in, and the model would plan the rest. I considered that approach, but decided that it did not fit the reason I was building Wayline.

When I begin planning a trip, I normally already have the main places I want to visit. The difficult work is turning those main goals into a complete, workable itinerary. A fully generated trip would still need my review and changes. I was not going to follow a model's recommendations without checking them, so generating everything did not remove the part of the task I actually found difficult.

I chose three practical jobs for the assistant. First, assess the itinerary for timing and route conflicts. Second, help find food along the route according to the user's preferences, so that a restaurant chosen because of a social-media recommendation does not derail the whole day. Third, help with the situation where there is free time and the traveller would like to explore nearby.

These are the assistant's jobs, rather than a requirement to put an LLM behind every action. In the implementation, schedule arithmetic and many suggestions come from rules and Google data; model calls are used for bounded recommendations and day optimisation. The user still chooses and applies the changes. The initial planning implementation is recorded in [b20fc88](https://github.com/comp4020-agentic-coding-studio/comp4020-final-lyclccylcq/commit/b20fc8895863ef981768b88a3609030ff23ea226).

### Changing the assistant from a chatbot into a tool

The next decision was crucial to what I meant by using AI in a product. Claude's earlier implementation felt like a chatbot powered by an LLM. I still had to type a request to make it work, much as I would when using Claude itself. That did not fit the product I wanted.

I did not want a chat-based customer-service assistant beside the itinerary. I wanted an easy-to-use tool: a button should start a defined task, within limits I had chosen for the product. The traveller should not need to learn how to prompt another general-purpose model just to inspect a schedule or look for food.

I therefore changed the visible interaction to buttons and task-specific results. The planning assistant shows the day's state and offers actions such as optimisation, food suggestions and nearby exploration. Suggestions can be previewed and selected before being applied. This made my earlier decision about the assistant's role concrete in the interface ([f99cdf0](https://github.com/comp4020-agentic-coding-studio/comp4020-final-lyclccylcq/commit/f99cdf0fd8eab349be33927f029429835df09a6d)). Later, several fixes could be previewed together, and old suggestions were cleared when the shared day changed ([48c1215](https://github.com/comp4020-agentic-coding-studio/comp4020-final-lyclccylcq/commit/48c1215f7dc005ae3f7edc9249b0afcae5f8b0aa), [9c63890](https://github.com/comp4020-agentic-coding-studio/comp4020-final-lyclccylcq/commit/9c63890d03fb62abda5af5a3e8538d9f3e0579b8)).

### Restaurant constraints improved through use and crit feedback

Restaurant recommendation needed further work after actual use and feedback from classmates at a crit. Earlier versions did not give me enough control over preferences, and the treatment of search distance was too crude. During crit testing, a destination away from a commercial area or city centre could leave the assistant with no shops to recommend.

That was a practical limit of the feature, rather than a problem that more fluent model text would solve. I revised the search-distance handling and custom preference/tag choices so that recommendations could better reflect both the person and the part of the route being planned. The implementation history includes the planning assistant's route-based searches and the later clearer preference interface ([f99cdf0](https://github.com/comp4020-agentic-coding-studio/comp4020-final-lyclccylcq/commit/f99cdf0fd8eab349be33927f029429835df09a6d), [0b21109](https://github.com/comp4020-agentic-coding-studio/comp4020-final-lyclccylcq/commit/0b21109354401066a91db8898902ec79d0ce41fe)).

Other checks made the recommendations more realistic. Travel should respect the modes the person excluded, and a meal has to fit the restaurant's opening period for the whole visit, including a buffer before closing. Those corrections are visible in [a005e90](https://github.com/comp4020-agentic-coding-studio/comp4020-final-lyclccylcq/commit/a005e902ad410000e0aeb916edb93f1a325c866b) and [e2dae22](https://github.com/comp4020-agentic-coding-studio/comp4020-final-lyclccylcq/commit/e2dae226bf76ce2543417eeb5246db4fe08037a1). The aim was to help build a usable day, with the limits of the available data made clear.

## Options and decision

- Whole-trip generation was an idea considered by the author, not a feature that this record claims was shipped and then removed. It would still require review and would not begin from the traveller's already chosen main goals.
- A conversational assistant can accept broad questions, but makes the user formulate prompts. The author rejected that as the main product interaction.
- Defined actions for itinerary assessment/optimisation, food along the route and nearby free-time exploration are the chosen user-facing roles.
- Implementation responsibilities are divided: code performs time arithmetic and validation; Google supplies available place/route data; the model recommends within supplied choices; the user confirms changes.

## Consequences and costs

The bounded scope gives up general conversation as the main interface and does not promise to produce every part of a holiday. Preferences, local search availability and opening hours must be handled explicitly. A valid draft can become stale while collaborators edit, so preview, fingerprint checks and clearing old suggestions are required. Cancelling a running optimisation must reach the upstream request, with its budget slot released. The detailed service and budget mechanisms remain in [AI implementation notes](../../docs/ai.md). [ADR 0011](0011-api-credentials-and-usage-controls.md) records why credentials use Fly secrets and how application limits differ from provider restrictions and spend controls.

Restaurant feedback is the author's report of actual use and classmates' crit testing. The exact feedback session and a single commit for every search-distance adjustment have not been established. The record links relevant implementation stages without assigning an invented date or distance value.

## Record notes

The change to the OpenAI provider is documented in [b20fc88](https://github.com/comp4020-agentic-coding-studio/comp4020-final-lyclccylcq/commit/b20fc8895863ef981768b88a3609030ff23ea226). The author's explanation here establishes the intended role and interaction of the assistant; it does not establish a separate personal reason for choosing that provider.
