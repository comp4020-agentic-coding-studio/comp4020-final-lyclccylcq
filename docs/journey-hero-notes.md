# Homepage journey integration — 21 October 2026

The scroll-driven window prototype is now the homepage hero. Its five
scenes play automatically: Switzerland, London, Sydney, Maldives, Shanghai,
then Switzerland again. Each holds for 8.4 seconds and transitions for
1.8 seconds. Ordinary page scrolling is independent of playback.

Sydney and Maldives replace the lower-quality Paris and Kyoto scenes.
The existing local WebP assets are retained; sources, adaptations and
licences are recorded in `public/img/train/CREDITS.md` and on `/credits`.
The original preview address renders the same homepage.

Recovery completed the remaining integration and fixed:

- floating-point rounding that could put an explicitly selected destination
  back in the preceding transition;
- wide-screen cropping of Shanghai's tower top;
- phone framing for Maldives and a gradient painting over its destination
  controls; all five destination buttons fit at 390 px;
- late image callbacks after navigation, failed-image fallback with matching
  attribution, and retry on an explicit destination choice;
- paused manual selections now display their chosen photo immediately;
- pause/resume and reduced-motion changes. The preference is kept from its
  change event rather than read from the media query every animation frame.

## Actual verification

An isolated local server and fresh database were used, with optional Google,
AI and TURN credentials disabled. No production data or secrets were changed.

- TypeScript: `node node_modules/typescript/bin/tsc --noEmit` — passed.
- Existing suite excluding the journey file: 25 files, 248 tests — passed.
- `spec/pixel-train.test.ts`: 15 tests — passed, including the entire loop,
  pause/resume, rapid selection, reduced motion and live preference changes,
  off-screen stopping, navigation cleanup, offline fallback and manual
  retry, destination links, credits, image geometry and image sizes.
- Real Chrome layout checks and inspected screenshots at 1920×1080 and
  390×844, including Sydney and Maldives — passed.
- `node scripts/check-evidence.ts` — all three reflection files present;
  all 11 PROCESS commit citations resolve.
- `git diff --check` — passed.

The first journey run reproduced the selection-boundary and landmark-crop
failures before their fixes. External Google, AI and cross-network voice
services were outside this homepage verification. This entry records
local checks before release; Git and Fly release history record the
authorised commit, push and deployment.

## Release checks on Linux

The first release CI run caught a macOS-only screenshot directory and the
pre-existing five-second total deadline on each multi-account invitation
journey. Screenshots now use the operating system's temporary directory.
The two invitation journeys have a thirty-second total deadline; their
individual UI waits and all assertions are unchanged. The two affected
browser test files passed all 40 tests locally after these fixes.

# Train-window refinement — 23 October 2026

Three problems were reported: the thin walnut rails read as a picture
frame; four of the five boundaries were crossfades (two photos dissolving)
and only two were tunnels; and only Switzerland felt like a moving view,
because it alone had something (a spruce) passing close by while the other
photos just panned slowly.

- Window: the rails were replaced by a narrow strip of carriage wall, a
  shaded reveal stepping into it, a dark gasket, a rounded glass opening,
  the opening's shadow on the glass and a faint drifting reflection that
  grows when it's dark outside. No interior, seats or pillars.
- Transitions: every boundary is the same tunnel (dark for under half a
  second), its portal faced to suit the place ahead. Destination buttons
  run it too; a pick during a tunnel retargets it until the next scene is
  visible, after which it waits; only the latest waiting pick is kept.
- Motion: each scene has trackside things drawn in code at one train speed
  (near things cross a window width in about 0.7 s; middle-distance things
  a third as fast; the photo barely moves): masts and wires, spruces and
  bushes (Switzerland); Hungerford Bridge's girders and the footbridge
  pylons (London); a sandstone wall, railing, poles and shrubs (Sydney);
  palms and pilings (Maldives, symbolic); the Bund's balustrade and lamps
  (Shanghai). Spacing is seeded-random within each kind's range. Photos
  are never split, so no landmark is torn.

Checked: `spec/pixel-train.test.ts` (17 tests, including deliberate
breakage of the tunnel and spacing rules), screenshots at 1920×1080,
1440×900, 1366×768, 768×1024 and 390×844, and a 34-second real-speed
recording (Shanghai, its tunnel to Switzerland, Switzerland, London).

# Restraint pass — 23 October 2026

The drawn trackside looked like stickers on the photographs, so it's gone:
`public/journey-track.js` and the `pass-spruce` cut-out were deleted, and
nothing is composited over the photos. Each scene moves only by a gentle
drift within its photo (about 1–2% of the window a second), never past its
edges. Every boundary is still the same short tunnel.

The dark band under the hero came from the hero's own background
(`#2a231d`-ish carriage wall) showing through a sill 1.5 times the side
margin, plus the reveal's dark gradient. The hero's background is now the
page's (`--hm-bg`), the margin round the glass is the same on all four
sides (8–14 px), and the glass has only a hairline warm edge: no reveal,
gasket or heavy shadow.
