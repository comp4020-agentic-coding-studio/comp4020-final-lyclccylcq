# 8. Separate shared planning rights from trip management rights

Recorded: 2026-11-07 (retrospective). Status: accepted; the chosen direction is implemented.

Restrictive collaborator rules implemented on 2026-10-18; revised planning rights implemented on 2026-11-06.

The personal rationale was supplied by the author during the Final documentation review. Code dates below identify implementation stages.

## Context and the author's reasons

### My initial permission model was borrowed too casually

I initially paid much less attention to identity and permissions than to the planning experience. I treated the trip rather like an alternative GitHub repository: the owner had broad control, while invited contributors would have stricter limits. That seemed a straightforward way to manage access, and the early model restricted collaborators largely to the stops they had added.

The project also needed a way to identify who had acted and to decide who could join. Invite links were made time-limited, opening one began a request, and the owner approved an identified account. Server-side checks and session-attributed logs gave these boundaries an implementation ([1f973dd](https://github.com/comp4020-agentic-coding-studio/comp4020-final-lyclccylcq/commit/1f973dda60f0d606893cb61ef8866be0b47bad77)).

At this stage, a recognisable larger version of Wayline had formed. However, I had not yet fully examined whether my repository-like permission assumption suited live travel planning. That became an important correction later. This record records both the initial assumption and its revision.

### Real planning exposed the limit of my repository analogy

The other important late correction came from designing a real route with a classmate. The invited person could add their own destinations, but could not change much of the existing itinerary. We found that this seriously limited the point of collaborating: too many ordinary planning actions had to be passed back to the owner.

That made me reconsider the GitHub analogy I had started with. In the repository contribution workflow I had in mind, an owner could manage and review contributions separately. Waiting for that review could be part of the process. In a live planning conversation, waiting for the owner to carry out most of the decisions interrupted the activity itself. The distinction that mattered to me was between managing engineering contributions and giving people the ability to work on the same plan in real time.

I therefore widened collaborators' planning rights substantially. They can change any stop, adjust the starting point and transport, and apply planning fixes and suggestions. A small group of management actions remains with the owner: the trip's settings, membership, publishing and deletion. Private access and version checks still apply; allowing people to plan together does not require dropping those protections.

This revised the assumption behind the earlier role model. I now separate the authority to manage a trip from the ability to plan it with other people. The implementation and its rules/tests changed together in [9c63890](https://github.com/comp4020-agentic-coding-studio/comp4020-final-lyclccylcq/commit/9c63890d03fb62abda5af5a3e8538d9f3e0579b8). This record records both stages, including the classmate planning experience that changed my judgement.

## Options and decision

- The initial repository-like assumption concentrated control in the owner and limited contributors. At the Crit 10 stage, a collaborator could largely change only the stops they had added.
- The author's live route-planning experience with a classmate showed that ordinary decisions repeatedly had to return to the owner.
- The chosen revision gives members the planning actions needed to co-edit the itinerary, while leaving ownership and management actions with the owner.
- The GitHub comparison describes the author's initial mental model. It is not a general specification of GitHub's roles or a claim that repositories cannot support other collaboration patterns.

## Consequences and costs

Members can edit, move, replace and remove any stop, set the start, select transport and apply planning suggestions. The owner controls trip settings, membership, publishing and deletion. Server-side access and stale-edit checks remain required. Broader planning rights mean two members may now change more of the same content, so conflict handling must continue to work between them.

Admission is a separate decision: a forwarded link still begins an approval request, and a named invitation still needs acceptance. Publishing, copying a template and issuing a read-only export do not grant edit membership. The current role matrix is maintained in [permissions.md](../../docs/permissions.md).

## Record notes

The first Wayline implementation had broader shared editing before the restrictive October role model. This record distinguishes that code history from the author's initial assumption. The classmate route-planning account is retrospective; the implementation revision is directly evidenced by [9c63890](https://github.com/comp4020-agentic-coding-studio/comp4020-final-lyclccylcq/commit/9c63890d03fb62abda5af5a3e8538d9f3e0579b8).
