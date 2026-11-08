# Wayline

> People choose where they want to go. Wayline helps them design their trip together.

A shared travel-planning workspace: a map, a day's timeline and friends working on the same plan.

[Open Wayline](https://comp4020-final-lyclccylcq.fly.dev/)

[![Watch the 4-minute film: a Sydney weekend, planned together](docs/readme-video-cover.jpg)](https://lyclccylcq.github.io/wayline-film/)

## A quick start

1. Browse the map or ready-made trips. Sign up to create your own; English and Chinese are available.
2. In **My Trips**, choose **New trip**, or use **Plan this trip** / **Use This Template** on an existing itinerary. Set dates and a starting point.
3. Select a place, then **Add to Itinerary**. Adjust the timeline; changes save automatically. Phone views are **Map**, **Plan** and **Assistant**.
4. **Share** invites friends by registered nickname or approval-based link. Use separate accounts and browser sessions. **Call** supports two people with microphone permission.
5. In **Assistant**, select repairs, preview their combined effect and apply them together.
6. **Export** saves a PNG or PDF for your phone. The owner uses **Publish Trip** to share a snapshot; this does not invite editors.

## What good means to me

My three standards for a good product are practical value, fitness for purpose and ease of use. I also want a product with its own character.

For Wayline, good means friends can collaborate on the platform to complete an accurate shared plan easily and smoothly.

**Practical value.** I wanted a tool I would keep using after the course. After collecting social-media recommendations and checking maps, we still have to connect everything ourselves. Wayline puts places, travel and time in one plan; food suggestions follow the route, nearby picks can fill free time, and export gives me an image to keep in my phone's album.

**Fitness for purpose.** Planning together means everyone can change the same itinerary and respond while others edit, without passing ordinary decisions back to the owner. Travel data must respect our choices: [an unavailable route stays unknown](https://github.com/comp4020-agentic-coding-studio/comp4020-final-lyclccylcq/blob/main/CLAUDE.md#truthful-transportation). A plan that quietly replaces transit with driving would only look workable.

**Ease of use.** My fitness-logging AI agent app taught me that a defined task should not need repeated conversation. Buttons and combined repair previews reduce the exchanges; mobile tabs keep the map, plan and assistant readable. The next action should be clear without a manual.

![The public homepage with its train-window scenery and destination entry](docs/readme-home-desktop.png)

*Explore a destination beneath the journey window.*

## Planning together

Changes reach other editors within about a second. Outdated edits become visible conflicts. Collaborators can plan any stop; owners manage membership, settings, publishing and deletion. Each person's map view stays their own.

![Desktop editor showing a Sydney map beside the day's timed stops](docs/readme-editor-desktop.png)

*Numbered places, timed stops and travel choices, at 1920×1080.*

![Phone editor showing the same Sydney day with Map, Plan and Assistant tabs](docs/readme-editor-phone.png)

*The same day across three tabs, at 390×844.*

## Sharing belongs to the tool

Publishing lets others read or reuse a snapshot. Ratings and reviews can remain as itinerary feedback. I want a travel workspace, rather than another Instagram; follows and social feeds are outside that purpose.

## Where the ideas came from

AI-made window-view clips inspired the homepage; metro maps inspired its route language. [Credits](https://comp4020-final-lyclccylcq.fly.dev/credits) identify the assets. My AI coach informed the interaction.

Reading [Sloan's *An app can be a home-cooked meal*](https://www.robinsloan.com/notes/home-cooked-app/) during final reflection helped explain why serving particular people matters. His fixed-family setting differs from changing travel groups; Wayline retains accounts and invitations.

[Amershi et al.'s *Guidelines for Human-AI Interaction*](https://www.microsoft.com/en-us/research/publication/guidelines-for-human-ai-interaction/) help me judge whether AI is understandable and easy to invoke, dismiss and correct. Buttons and previews support that.

## What I can check

[Rules](https://github.com/comp4020-agentic-coding-studio/comp4020-final-lyclccylcq/blob/main/CLAUDE.md) and [tests](https://github.com/comp4020-agentic-coding-studio/comp4020-final-lyclccylcq/tree/main/spec) check private access, persistence, stale edits, schedule calculations and live delivery. People judge the interface and calls through use, including whether the next action is clear at desktop and phone sizes.

Planning with a classmate exposed restrictive permissions, so I [widened them](https://github.com/comp4020-agentic-coding-studio/comp4020-final-lyclccylcq/blob/main/docs/decisions/0008-planning-rights-and-management.md). [PROCESS](https://github.com/comp4020-agentic-coding-studio/comp4020-final-lyclccylcq/blob/main/PROCESS.md) records the decisions; [validation notes](https://github.com/comp4020-agentic-coding-studio/comp4020-final-lyclccylcq/blob/main/docs/final-validation-notes.md) distinguish automated and manual checks.
