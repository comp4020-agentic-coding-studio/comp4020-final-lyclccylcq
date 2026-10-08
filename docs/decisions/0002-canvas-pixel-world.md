# 2. One canvas for the pixel gym, HTML for the words

Date: 2026-10-04 · Status: accepted (for crit 8; revisit if the room grows)
· Superseded 2026-10-09: the Virtual Gym was replaced by Wayline, which has no
canvas world. Kept as the record of the gym.

## Context

The first version drew the gym as five CSS zones with round dots in them. Looking at
it, I decided that read as a workout tracker with a gym theme. The direction changed to a
large pixel-art gym, where choosing an exercise walks your character to the
machine and animates it. That needs a room larger than the screen, about seven
two-frame animations, people walking between machines, a camera that follows
you, and later many people moving at once (crit 9).

## Options

- **Keep DOM/CSS:** every machine and person is an element, and animation uses
  sprite sheets as CSS backgrounds. That needs image files, or sprites generated at
  runtime and turned into data URLs. Hundreds of absolutely positioned elements
  also make depth order and a moving camera fiddly.
- **A game engine** (Phaser, PixiJS): it handles sprites and cameras out of the
  box. But it's a runtime dependency many times the size of the app, for a room
  that is one static map and a few people.
- **One `<canvas>`, drawn by hand:** paint the floor, walls and furniture once to
  an offscreen canvas, then each frame draw the machines and people sorted by
  depth. Scale it by whole numbers with `image-rendering: pixelated`. Keep name
  tags, the clickable machine areas and the panel as HTML on top.

## Decision

One canvas with no library. The art is drawn from rectangles in `sprites.js` and
cached per pose, frame and shirt colour, so there are no asset files to make or
license. Walking uses breadth-first search over the tile grid, about twenty lines.
The camera is the browser's own scrolling, plus drag-to-pan for a mouse. Words
stay HTML, so they're crisp at any scale, readable by screen readers, and
checkable by `spec/`.

## Consequences

- The server stores meaning only (exercise, state, since when). `world.js` derives
  position, route and pose, so nothing visual needs migrating when the art
  changes.
- `setPeople()` already reconciles a list of people into walking entities, so a
  live feed at crit 9 only has to call it more often.
- Hand-drawn rectangle art limits detail. That's deliberate: two-frame poses that
  read at a glance matter more than polish.
- If the map ever needs several rooms or hundreds of people, revisit this.
