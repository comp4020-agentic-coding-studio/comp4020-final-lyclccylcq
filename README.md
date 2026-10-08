# Wayline

> People choose where they want to go. Wayline helps them figure out how to get there.

Wayline is a collaborative travel planner. A group shares one trip: an interactive map on one side, a day-by-day timeline on the other. Everyone picks places, arranges them into days, and sees each other's changes as they happen. Between consecutive stops Wayline looks up real travel times, and it points out when a plan doesn't add up.

## The problem

Planning a trip with other people usually means juggling a map app, a notes document, a group chat and a lot of screenshots. The hard part isn't finding places. It's fitting them together: whether the zoo and lunch fit in one morning once the ferry is counted, and whose copy of the plan is the current one.

## What good means here

A good Wayline keeps the decisions with the travellers and takes over the bookkeeping. Concretely, a good version:

- **lets you plan by touching the plan.** You search, add, drag, reorder and adjust times on the map and timeline, and each action shows straight away. Forms and chat aren't the main way in;
- **is one shared plan, not copies.** When a collaborator adds a stop or moves lunch, your open page shows it within about a second. The server holds the authoritative version, and an edit made against an outdated version is refused rather than silently overwriting someone;
- **is truthful about travel.** Transit lines, times and durations come from Google's Routes API, or the app says plainly that it doesn't know. It never estimates a route it didn't look up, and demo data is always labelled as demo;
- **checks the plan with arithmetic, and explains it with AI.** Overlaps and too-short gaps are computed deterministically. The AI copilot may explain a conflict and recommend among the exact fixes the app worked out, but it can't change anything: every change is previewed and only applied when someone accepts it;
- **keeps a private trip private.** Only the owner and the people they invite can see or edit it. Invite links are random, revocable and never shown again after creation.

The intended user is a small group (two to six people) planning a short trip together, who care more about a plan that actually works than about discovering new places.

## Which claims are checked

The `spec/` folder enforces the checkable parts: outsiders get nothing; retried adds don't duplicate; stale edits are refused with a 409; schedule maths and fixes are exact; a change reaches another session within a second (over the event stream and in two real browsers); data survives a restart; server keys never reach the browser; no route is invented without Google. Whether planning *feels* direct and calm is judged by people using it, not by tests.

## What it deliberately doesn't do

No booking, payments, reviews, social feeds, chat, or AI-generated itineraries. The copilot doesn't choose places, and multi-day route optimisation isn't attempted. Each of these would move decisions away from the travellers or pull the focus away from the shared plan.

## Configuration

Without keys, Wayline still runs. Trips, timelines, collaboration and rule-based checks all work, search uses a few labelled demo places, and the map is a labelled schematic. `.env.example` lists the keys for Google Maps Platform (Maps JavaScript, Places API (New), Routes API) and for the AI provider.

## Sources

_To be written by the author: the reading and products that informed this definition of good._
