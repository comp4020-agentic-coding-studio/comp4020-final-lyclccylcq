# 5. Pivot from Virtual Gym to collaborative travel planning

Recorded: 2026-11-07 (retrospective). Pivot implemented: 2026-10-09.
Status: accepted; implemented in Wayline.

## Context

My choices about subject matter and scope start from situations I have experienced. The original idea came from the small gym beneath my residence, which was often quiet. Most of the time I trained alone. That gave me freedom, but I missed the energy of exercising around other people. Virtual Gym was an attempt to recreate some of that atmosphere online: a shared pixel-art room in which real workouts moved a character ([`a6f7c78...abe24a5`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-lyclccylcq/compare/a6f7c78...abe24a5)). Online study rooms provided an analogy. Studying and exercising can both involve repetitive work sustained over a long period; I hoped a sense of collective effort could help someone keep going.

## Decision drivers

- Ground the project in a situation I have encountered and can describe concretely.
- Give simultaneous participation a useful role in the activity.
- Make the core experience possible to develop and test with a small number of people.
- Weigh the production effort, including participant recruitment and artwork, alongside the coding work.

## Options considered

### 1. Continue Virtual Gym as a companionship space

I recognised that the gym's practical value was limited and mainly concerned companionship. That became difficult to develop as I extended the design towards real-time interaction. The situation I wanted to support involved quiet company: someone could feel that others were exercising alongside them while concentrating on their own workout. It gave me little reason to expect frequent interaction. Designing more interaction risked interrupting the activity that the software was supposed to accompany. I therefore began questioning how the project could make real-time participation useful in that setting.

### 2. Turn Virtual Gym into an equipment-occupancy tool

One possibility was to turn it into a digital tool for an actual gym. A shared interface could show whether a machine was occupied, including the difference between equipment that was genuinely free and equipment whose user was only resting between sets. This connected an interaction to a recognisable practical question. However, in the small physical gym that had inspired the project, someone could simply ask whether the equipment was still being used. Repeatedly consulting an online page did not seem to improve that exchange enough to justify the extra step. I decided to look for another theme.

### 3. Build a cooperative RPG with fixed professions

At that point, the alternative I initially preferred was a cooperative RPG. Each player would choose only one profession, making cooperation depend on a division of roles between players. This offered a clearer reason for people to act together, but introduced a difficult participation requirement. If a necessary profession was absent, parts of the game could not proceed. The design would depend on both a minimum number of players and the right combination of roles. Even a small test would require recruiting enough people to make the intended experience possible.

The RPG also raised a separate production risk. I considered artwork central to the experience, and expected it to remain heavily dependent on manual skills even with agent-assisted coding. Relying entirely on AI-generated assets seemed to carry substantial cost and risk. Together, the need for a sufficient player population and the art workload made the idea difficult to develop and test at the scale available to me.

### 4. Build a collaborative travel planner

The turning point came from an unexpected request: a friend from China visiting Australia asked me for itinerary recommendations. This exposed how much work sits between recommending interesting places and constructing a coherent trip together. The planning problem was something I could encounter directly, discuss with another person and break into concrete decisions.

The workflow was fragmented. Social media offered ideas for destinations, but information was scattered between posts and often lacked an intuitive view of where places were in relation to one another. I first had to collect enough information, then locate places manually on a map and arrange them into a workable sequence. Transport, accommodation and meals added further planning tasks. A list of appealing destinations left much of the work of assembling the trip unresolved.

## Decision

I chose Wayline to bring places, routes and timing into one shared plan ([`6305228`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-lyclccylcq/commit/6305228); [`0953ec9`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-lyclccylcq/commit/0953ec9)). This scenario gave collaboration a practical purpose: people could choose and arrange places together, and one person's change could affect the feasibility of the whole day. It could also begin with one person and be tested with a second, without requiring a fixed set of game roles. The decisions about what to build now followed from the planning work itself: make spatial relationships visible, connect them to time, and keep participants working on the same itinerary.

## Consequences and trade-offs

- **Replace the domain and interface.** The gym and its pixel-room interactions gave way to a map, timeline and shared itinerary. That meant leaving behind work on equipment and workout lifecycles. Its development remains visible in Git and the [Crit 8 reflection](../../reflections/crit-8.md).
- **Retain useful engineering foundations.** The pivot retained the Node/SQLite approach rather than requiring a new stack. [ADR 0001](0001-plain-node-and-sqlite.md) records the original stack choice; [ADR 0003](0003-sse-snapshots-and-versioned-edits.md) records the later collaboration design.
- **Make shared decisions the centre of interaction.** A place or time changed by one person can affect everybody's plan. Keeping the itinerary consistent and making conflicting edits visible become necessary parts of the product.
- **Lower the participation threshold.** A person can start planning alone and invite another person. The core workflow can be exercised without recruiting a predetermined combination of game professions.
- **Accept a different implementation workload.** Travel planning requires interface design, map integration, reliable travel data, permissions and synchronisation. These obligations became part of Wayline's implementation workload.
- **Keep the value claim open to evaluation.** The conversation with my friend establishes the motivating situation. It does not establish that real groups find the finished application easier to use over time. That remains a question for evaluation.

## Record and evidence

This record was prepared retrospectively, with agent assistance, from the author's explanation during the Final documentation review. The personal context and considered alternatives come from that explanation. The linked Git history records the implemented gym and its replacement with Wayline.

The pivot was implemented in [`6305228`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-lyclccylcq/commit/6305228) and described in the contemporary PROCESS/README update [`0953ec9`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-lyclccylcq/commit/0953ec9). The [Crit 9 reflection](../../reflections/crit-9.md) records the shift towards a plan that people act on together. The current [PROCESS.md](../../PROCESS.md) places this decision alongside the later technical and workflow decisions.
