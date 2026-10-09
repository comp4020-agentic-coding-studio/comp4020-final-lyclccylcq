# Wayline

> People choose where they want to go. Wayline helps them figure out how to get there.

Wayline is a collaborative travel planner. A group shares one trip: an interactive map beside a day-by-day timeline. Everyone picks places, arranges them into days and sees each other's changes as they happen. Between consecutive stops Wayline looks up real travel times and points out when a plan doesn't add up.

## From Virtual Gym to Wayline

This project began as Virtual Gym, a shared pixel-art gym where real workouts moved your character. Seeing others online changed little about anyone's experience, and its use alongside existing fitness apps was hard to justify, so in October 2026 the project pivoted to collaborative travel planning. The gym's development record stays in `PROCESS.md`, `reflections/` and `docs/decisions/`.

## Who it's for

Small groups, roughly two to six people, planning a short trip together, who care more about a plan that actually works than about discovering new places. Today that planning is spread across a map app, a shared document, a group chat and screenshots, and the hard part is fitting choices together: whether the zoo and lunch fit in one morning once the ferry is counted, and whose copy of the plan is current.

## How collaboration works

Everyone invited to a trip edits the same itinerary, which lives on the server. When someone adds a stop, moves lunch or changes a time, the change is saved and then pushed to every open editor, appearing within about a second. An edit made against an outdated version is refused instead of silently overwriting someone. Trips are private: only the owner and people they invite through a revocable link can see or change them.

## The planned role of AI

The AI copilot helps; it doesn't decide. Overlaps and too-short gaps are calculated by plain arithmetic, from travel times Google's Routes API actually returned. The AI's job is to explain a conflict and recommend among the exact fixes the app already worked out. It can't change the plan: every fix is previewed, and nothing is applied until someone accepts it. Without a configured AI key, the rule-based checks still work and the app says AI is unavailable.

## Why this interaction should be meaningful

In Virtual Gym, other people were visible but nothing they did touched your session. In Wayline, the hope is that interaction matters because the plan is genuinely shared: one person's change shapes everyone's day, and conflicts become decisions the group makes together. That is a design intention, still to be evaluated with real groups.

## What good means here

- planning happens by touching the map and timeline, not filling in forms;
- there is one shared plan, never diverging copies;
- travel information is truthful: real route data, or a plain "unknown", and demo data is always labelled;
- the AI explains and suggests; people decide;
- a private trip stays private.

## Which claims are checked

`spec/` enforces the checkable parts: outsiders get nothing; retried adds don't duplicate; stale edits are refused; schedule maths is exact; changes reach another session, and another real browser, within a second; data survives a restart; server keys never reach the browser; no route is invented. Whether planning feels direct and calm is judged by people using it.

## What it deliberately doesn't do

No booking, payments, reviews, feeds, chat, AI-generated itineraries or multi-day route optimisation. Each would move decisions away from the travellers or the focus away from the shared plan.

## Sources

_To be written by the author: the reading and products that informed this definition of good._
