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
