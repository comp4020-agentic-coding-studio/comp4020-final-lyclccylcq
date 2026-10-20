# Homepage media: sources and licences

Every photo and video clip on the homepage is a freely licensed Wikimedia
Commons file, resized (and, for video, shortened and muted) and served from
the app itself. Nothing is hotlinked. Each item's credit is in code next to
the file (`public/photos.js`, `public/journey.js`, `public/media.js`) and shown on `/credits`; the
journey window credits its visible photograph and the photo stream shows each photo's.
`spec/photos.test.ts` checks every item has a free licence, an author where
the licence needs one, a Commons page, and that the files exist and are
served.

Rules for adding media:

- Commons only, under CC0, public domain, CC BY or CC BY-SA. Record source
  page, author, licence and licence URL in the data file.
- No tourism advertisements, no brand-dominated frames, no recognisable
  faces as the subject, no title cards or watermarks.
- Photos: 1200 px wide JPEG, landscape, ≤ ~220 KB, into `public/img/covers/`.
- Clips: ~6 s, 1280×720, no audio track, H.264 MP4 (High, `+faststart`)
  and VP9 WebM, each with a JPEG poster (its first frame), into
  `public/video/`. Keep each file under ~900 KB. Prefer 1080p-or-better,
  stable (tripod, gimbal, drone or time-lapse), daylight sources with a
  recognisable landmark and no cut inside the segment. The server answers byte-range requests for `/video/` (Safari needs
  them).

## Automatic journey window

The homepage now shows one window cycling through Switzerland, London,
Sydney, Maldives and Shanghai. These are real photographs animated as a
symbolic journey, not train footage or a real railway route. Sydney and
Maldives replace the lower-quality Paris and Kyoto prototype images.

The complete sources, authors, licences and adaptations are recorded in
[`public/img/train/CREDITS.md`](../public/img/train/CREDITS.md); the runtime
metadata lives in `public/journey.js`, and `/credits` lists all five.
Photos are local WebP files, each under 760 KB; the scenery, rails and
passing spruce together are under 4 MB. Each landscape stays whole,
never repeated or split into independently moving strips.

Playback uses one animation clock, holds each scene for 8.4 seconds and
transitions for 1.8 seconds, looping after Shanghai. It leaves ordinary
page scrolling alone. Pause/Play stops and resumes the scenery; choosing
a destination restarts its hold. Playback stops off screen and in hidden
tabs. Reduced motion and Save-Data show a still view with manual choices.
Only the current and next photos load during playback; still mode loads
only the selected scene. An unavailable photo leaves the previous view
and its matching credit visible. Route changes destroy the observers and
animation loop. `spec/pixel-train.test.ts` covers this final homepage
behaviour, replacing the superseded scroll-prototype checks.

## Former hero video clips (`HERO_CLIPS`, `public/media.js`)

These clips remain self-hosted and credited, but the homepage no longer
loads or plays them. The following records their sources and preparation.

All 1280×720, 6 s, silent, in rotation order. The segment is which part of
the source was used. Sydney is first: its poster is the still that shows
before video starts, and the only picture with reduced motion or Save-Data.

| Place | What it shows | Author | Licence | Source res. | Segment | Source |
|---|---|---|---|---|---|---|
| Sydney | Aerial drone orbit of the Sydney Opera House | Tim Astor | CC BY 3.0 | 1080p | 2–8 s | [Commons](https://commons.wikimedia.org/wiki/File:Sydney_Opera_House_drone.webm) |
| London | Golden-hour drone drift from Tower Bridge towards the Shard, City Hall and HMS Belfast | the Dronalist | CC BY 3.0 (see below) | 3840×2160 | 101.5–107.5 s | [Commons](https://commons.wikimedia.org/wiki/File:Aerial_footage_of_London,_United_Kingdom_featuring_London_Tower,_Downtown_London,_London_Bridge,_River_Thames.webm) |
| Venice | From a boat on the Grand Canal past Santa Maria della Salute, a gondola and a water taxi | Triplec85 | CC BY-SA 4.0 | 3840×2160 | 61.5–67.5 s | [Commons](https://commons.wikimedia.org/wiki/File:2018-09-25_Santa_Maria_della_Salute_(Venice)_Grand_Canal.webm) |
| New York | Time-lapse over Manhattan rooftops toward the skyline at sunset | David Schwab | CC BY 3.0 | — | 10–16 s | [Commons](https://commons.wikimedia.org/wiki/File:Time-lapse_of_New_York_City_skyline_July_2023.webm) |
| Landwasser Viaduct, Switzerland | A red Rhaetian Railway train crossing the viaduct near Filisur (tripod) | FkMohr (recorded by Supakon Mohr) | CC BY-SA 3.0 DE | 1920×1080 | 2–8 s | [Commons](https://commons.wikimedia.org/wiki/File:1137-Landwasser.webm) |
| Paris | Time-lapse of the Eiffel Tower under moving clouds at dusk | Yann Caradec | CC BY-SA 2.0 | — | 4–10 s | [Commons](https://commons.wikimedia.org/wiki/File:Timelapse_Tour_Eiffel_%C3%A0_Paris.webm) |
| Shanghai | Time-lapse of the Lujiazui skyline from the Bund | Yigang Yu | CC0 | — | 17–23 s | [Commons](https://commons.wikimedia.org/wiki/File:Shanghai_Bund,_Lujiazui_Skyline_Timelapse.webm) |

Attribution: every CC BY / CC BY-SA clip needs the author, the licence and a
link to it, shown with the clip (the hero's credit line) and on `/credits`.
Share-alike applies to adaptations; the shortened, resized clips are
published under the same licence.

London: the licence comes from a CC BY YouTube upload, and Commons'
licence review of the file was still pending (category "License review
needed (video)") when it was added on 19 October 2026. Check the file page
before release; if the review fails, remove the London entry from
`HERO_CLIPS` and its three files.

The Paris clip is at dusk. Commons treats the Eiffel Tower's *night
illumination* as a separate copyrighted work in France (a night photo was
rejected for that reason), so its frames were checked: the tower is unlit
throughout, and the only people are passing silhouettes. Keep it that way if
the segment is ever re-cut. Venice's segment was chosen to keep the filming
boat's roof out of frame. The Landwasser train's "Rhätische Bahn" lettering
is the operator's name, not advertising.

Replaced on 19 October 2026 for low visual quality: the Seoul (63 Building,
hazy), Tokyo (towers in haze) and Kyoto (Kamo River, dim) clips, removed with
their files. Seoul, Tokyo and Kyoto keep their destination photos.

Rejected while choosing the replacements (licence fine, footage not): two
handheld Grand Canal clips with no landmark; a near-monochrome Venice lagoon
clip; 720p-only Rialto (tilt-shift) and Tower Bridge time-lapses; hazy or
car-dominated Amsterdam street and aircraft footage; Dubrovnik through a
plane window or a dusty lens; a dark, cut-heavy Swiss mountain time-lapse; a
backlit Hong Kong Star Ferry clip with a brand-name sign on the skyline; fast
FPV fisheye flights over Lake Como and the Swiss Alps; and an overcast,
crowded Colosseum clip.

There's no Rome clip: the only suitable Commons file found was handheld,
crowded and full of hotel signage. Rome has a photo instead.

## Destination photos (`dest-*`, `public/photos.js`)

Added in the October 2026 homepage redesign (the Canberra, Sydney and Tokyo
photos and the itinerary covers are older and listed in `public/photos.js`).

| Key | Author | Licence | Source |
|---|---|---|---|
| dest-paris | NonOmnisMoriar | CC BY-SA 3.0 | [Commons](https://commons.wikimedia.org/wiki/File:Eiffel_tower_from_trocadero.jpg) |
| dest-london | Diliff | CC BY-SA 2.5 | [Commons](https://commons.wikimedia.org/wiki/File:Palace_of_Westminster,_London_-_Feb_2007.jpg) |
| dest-rome | Diliff | CC BY-SA 2.5 | [Commons](https://commons.wikimedia.org/wiki/File:Colosseum_in_Rome,_Italy_-_April_2007.jpg) |
| dest-barcelona | Bernard Gagnon | CC BY-SA 3.0 | [Commons](https://commons.wikimedia.org/wiki/File:Sagrada_Familia_01.jpg) |
| dest-amsterdam | Fons Heijnsbroek | CC0 | [Commons](https://commons.wikimedia.org/wiki/File:Amsterdam_free_canal_photo_with_brick_old_bridge,_location_Reguliersgracht_01-2022,_Fons_Heijnbroek.jpg) |
| dest-new-york | King of Hearts | CC BY-SA 3.0 | [Commons](https://commons.wikimedia.org/wiki/File:Lower_Manhattan_from_Jersey_City_November_2014_panorama_3.jpg) |
| dest-san-francisco | Rich Niewiroski Jr. | CC BY 2.5 | [Commons](https://commons.wikimedia.org/wiki/File:GoldenGateBridge-001.jpg) |
| dest-los-angeles | Alek Leckszas | CC BY-SA 4.0 | [Commons](https://commons.wikimedia.org/wiki/File:Los_Angeles_with_Mount_Baldy.jpg) |
| dest-shanghai | King of Hearts | CC BY-SA 4.0 | [Commons](https://commons.wikimedia.org/wiki/File:Pudong_Shanghai_November_2017_HDR_panorama.jpg) |
| dest-beijing | xiquinhosilva | CC BY 2.0 | [Commons](https://commons.wikimedia.org/wiki/File:Temple_of_Heaven_-_Hall_of_Prayer_for_Good_Harvests_03.jpg) |
| dest-seoul | Basile Morin | CC BY-SA 4.0 | [Commons](https://commons.wikimedia.org/wiki/File:Front_view_of_the_Imperial_Throne_Hall_Geunjeongjeon_at_Gyeongbokgung_Palace_with_blue_sky_in_Seoul.jpg) |
| dest-busan | Basile Morin | CC BY-SA 4.0 | [Commons](https://commons.wikimedia.org/wiki/File:Colorful_houses_in_Gamcheon_Culture_Village_at_sunset_in_Busan_South_Korea.jpg) |
| dest-kyoto | Jaycangel | CC BY-SA 3.0 | [Commons](https://commons.wikimedia.org/wiki/File:Kinkaku-ji_the_Golden_Temple_in_Kyoto_overlooking_the_lake_-_high_rez.JPG) |
| dest-melbourne | Dietmar Rabich | CC BY-SA 4.0 | [Commons](https://commons.wikimedia.org/wiki/File:Melbourne_(AU),_Northbank_--_2019_--_1422-7.jpg) |

The 14 two-day itineraries added with these cities have no photo of their
own yet: `SHARED_COVERS` in `public/photos.js` points each at its city's
photo, so cards and copied trips show it with the same credit. Giving one its
own cover means adding a `tpl-<slug>` entry to `PHOTOS` (it takes precedence).

Rejected during the first selection (licence fine, content not): an
Amsterdam canal dominated by parked vans with company lettering, a Shanghai
night skyline dominated by lit advertising screens, a night photo of the
Eiffel Tower (illumination copyright), a Rome Pantheon clip (crowds,
signage), generic Seoul b-roll, and low-resolution Tokyo and Paris clips.

## How the homepage uses them

- **Hero** (`videoHero`): shows the first clip's poster (Sydney) at once
  (`fetchpriority="high"`); one `<video>` plays at a time, the next is
  created only when needed, then crossfaded. Video starts after an idle
  callback, pauses when the hero leaves the screen, and never plays with
  `prefers-reduced-motion: reduce` or Save-Data / 2G (the poster stays). A
  refused `play()` or a load error leaves the current picture up. Muted,
  `playsinline`, no controls, hidden from screen readers; the heading and
  buttons are ordinary text.
- **Photo stream** (`photoStream`): destination photos and itinerary covers,
  each a link to its city (opens it in "Ideas for …", no location stored) or
  itinerary. Lazy-loaded images; the slow drift runs only on wide,
  hover-capable screens without reduced motion and pauses on hover and focus;
  elsewhere it's a plain horizontal scroller.
