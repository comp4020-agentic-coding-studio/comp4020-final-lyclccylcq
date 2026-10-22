# Journey window photographs

The homepage and its preview at `/experiments/pixel-train` show five
freely licensed Wikimedia Commons photographs through one window. Every
image is self-hosted, cropped, resized and encoded as WebP by
`scripts/train-photo/build.py`. `public/journey.js` records each source;
the current photograph is credited on the window, and all five appear
on `/credits`.

| Used as | File on Commons | Author | Licence |
|---|---|---|---|
| Switzerland (`switzerland`) | [Panorama of Brienzersee](https://commons.wikimedia.org/wiki/File:Panorama_of_Brienzersee.jpg) | Nicojonesgodel | [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/) |
| London (`london`) | [Thames Panorama, London - May 2009](https://commons.wikimedia.org/wiki/File:Thames_Panorama,_London_-_May_2009.jpg) | Diliff | [CC BY-SA 3.0](https://creativecommons.org/licenses/by-sa/3.0/) |
| Sydney (`sydney`) | [Sydney (AU), View from Yurong -- 2019 -- 3096-101](https://commons.wikimedia.org/wiki/File:Sydney_(AU),_View_from_Yurong_--_2019_--_3096-101.jpg) | Dietmar Rabich | [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/) |
| Maldives (`maldives`) | [Diamonds Thudufushi Beach and Water Villas, May 2017 -08](https://commons.wikimedia.org/wiki/File:Diamonds_Thudufushi_Beach_and_Water_Villas,_May_2017_-08.jpg) | Martin Falbisoner | [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/) |
| Shanghai (`shanghai`) | [Pudong Shanghai November 2017 HDR panorama](https://commons.wikimedia.org/wiki/File:Pudong_Shanghai_November_2017_HDR_panorama.jpg) | King of Hearts | [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/) |

Adapted images retain their source's ShareAlike licence. The photos have
a shared gentle colour grade; Shanghai retains its night colours. London,
Sydney and Maldives are cropped vertically; nothing is split into layers
or tiled, so landmarks are never duplicated or torn by separate motion.
Nothing is drawn or composited over the photographs. The window's edge is
CSS, and there are no other images, no third-party media and no image
generation. The walnut rails (`frame-h`, `frame-v`), the passing spruce
(`pass-spruce`, cut from the Swiss photo) and the trackside drawn in code
were removed on 23 October 2026 because they didn't match the
photographs.

Sydney and Maldives replace the lower-quality Paris and Kyoto scenes.
This is a symbolic journey through real photographs, not footage from
a continuous train route.
