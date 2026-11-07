# 6. Make the map and shared itinerary the core planning workspace

Recorded: 2026-11-07 (retrospective). Status: accepted; the chosen direction is implemented.

Core workspace implemented from 2026-10-09; map-view collaboration developed on 2026-10-12 and personal map anchoring on 2026-10-16.

The personal rationale was supplied by the author during the Final documentation review. Code dates below identify implementation stages.

## Context and the author's reasons

### The map had to be a core part of the product

From 9 October onwards, the first core decision was the map. One of the problems I had identified was that fragmented information from social media often gave me very little sense of location. I could decide that I wanted to visit two places and still have poor control over the distance between them. The transport problem would only become clear when I tried to connect the choices into an actual day. Collecting attractive destinations was much easier than understanding whether they belonged in the same itinerary.

For that reason, a visible map was essential. I wanted to see where places were, how far apart they were, and what moving between them would involve while making the plan. For an unfamiliar visitor, the map also has value before a route has been decided: it is a way to explore what is around a destination.

My comparison came from my own habits. In China I was used to local-lifestyle services such as Meituan combining discovery and local information. In the Australian planning situation I was dealing with, I did not have an equivalent single service that I used in the same way. A map remained one of the most useful ways for me to explore locally. This is the practical reason I put Google Maps at the centre of Wayline. The discovery homepage and planning-from-the-map work followed that choice ([4e0b815](https://github.com/comp4020-agentic-coding-studio/comp4020-final-lyclccylcq/commit/4e0b8157a57560564bb7c6168ab5682b1767dda2), [7799fab](https://github.com/comp4020-agentic-coding-studio/comp4020-final-lyclccylcq/commit/7799fabe9bcefd318af9ce95a4833fdd8776f7aa)).

### A shared itinerary had to reduce the delay between people

The second core decision was the shared itinerary. This is where the project's real-time interaction matters most. When planning with my friend, I found that information did not move between us immediately. We could spend time collecting material separately, then discover duplication and conflicting choices when we finally tried to plan together. Similar social-media recommendations made that duplication especially easy: both people could return with many of the same suggestions without knowing what the other had already selected.

I therefore wanted an online space in which we could design the itinerary together. The useful result of real-time interaction would be seeing a choice while it was being made and responding to its effect on the same plan. A change to a place, a time or a route should become shared context for the next decision.

The implementation uses one server-held itinerary, with saved changes sent to open editors through SSE. Version checks make an outdated edit a visible conflict instead of silently losing somebody else's change. [ADR 0003](0003-sse-snapshots-and-versioned-edits.md) records the transport and concurrency alternatives. My product-level reason for accepting that approach was to keep our decisions connected to one shared plan ([6305228](https://github.com/comp4020-agentic-coding-studio/comp4020-final-lyclccylcq/commit/63052286cdbde3c5d6c61aa8378bb08cf0824a11), [b4bb133](https://github.com/comp4020-agentic-coding-studio/comp4020-final-lyclccylcq/commit/b4bb133f016db3af103e4d7d398ddcef774f4ec6)).

### Sharing a map view came from using the app together

Sharing the map view was a more specific decision that came out of testing and using the project. When we talked about a particular place, the other person often had to search for it before the discussion could continue. Even though we were discussing the same itinerary, we were not necessarily looking at the same information.

Being able to find the place the other person was viewing reduced that interruption. I wanted a clear indication of where they were looking and a quick way to move there. I meant their view of the map, rather than their device's GPS position. I also did not want one person's browsing to keep taking control of everyone else's screen.

This led to separate state for the saved itinerary, temporary collaborator views, and my own selected point. After jumping to a teammate's view, I still needed a way back to my point. The transient view markers and My spot/Return to my spot followed these different needs ([3f27110](https://github.com/comp4020-agentic-coding-studio/comp4020-final-lyclccylcq/commit/3f27110edff0a6fa0d3fada34ab7578daf0f45b8), [1f3d00e](https://github.com/comp4020-agentic-coding-studio/comp4020-final-lyclccylcq/commit/1f3d00e8942dd72cd64f4033d7bef45130a27f8d)).

## Options and decision

- A list or collection of social-media recommendations leaves spatial relationships and coordination work to the travellers.
- A map used only after the itinerary is finished cannot support the decisions about distance while the itinerary is being formed.
- A shared map-and-timeline workspace lets people explore, discuss and arrange the same plan. This is the chosen direction.
- Shared viewing is optional context for discussion; it does not force every participant to use one camera position.

## Consequences and costs

The workspace requires reliable location and route information, clear confirmation before a browsing action becomes a shared edit, and distinct handling of persistent itinerary data and temporary views. Synchronising the plan also creates conflict cases. The transport and version choices are recorded in [ADR 0003](0003-sse-snapshots-and-versioned-edits.md). The original planning problem explains the decision; it is not a measurement of how much time all future users will save.

## Record notes

The author's account was supplied during the Final documentation review. Personal motives are retrospective. The implementation dates establish when code changes entered Git, rather than the exact moment each idea was first considered.
