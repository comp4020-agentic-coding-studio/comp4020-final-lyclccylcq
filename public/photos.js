import { h } from "/ui.js";

// Photos of the curated destinations, from Wikimedia Commons, resized (800 or 1200px)
// and served from /img/covers/. Each is freely licensed and needs its credit;
// /credits lists them all. The gradient stays underneath as the fallback, so a
// photo that fails to load just disappears.
export const PHOTOS = {
  "tpl-canberra-national-institutions": {"src":"/img/covers/canberra-national-institutions.jpg","w":800,"h":533,"alt":"Parliament House, Canberra, at dusk","author":"Thennicke","license":"CC BY-SA 4.0","licenseUrl":"https://creativecommons.org/licenses/by-sa/4.0","page":"https://commons.wikimedia.org/wiki/File:Parliament_House_at_dusk,_Canberra_ACT.jpg"},
  "tpl-canberra-lookouts-gardens": {"src":"/img/covers/canberra-lookouts-gardens.jpg","w":800,"h":533,"alt":"Canberra seen from Mount Ainslie Lookout","author":"Orion Kahza","license":"CC0","licenseUrl":"https://creativecommons.org/publicdomain/zero/1.0/deed.en","page":"https://commons.wikimedia.org/wiki/File:Canberra_from_Mount_Ainslie_Lookout.jpg"},
  "tpl-canberra-arboretum-braddon": {"src":"/img/covers/canberra-arboretum-braddon.jpg","w":800,"h":600,"alt":"The National Arboretum Canberra, looking east from Dairy Farmers Hill","author":"Nbound","license":"CC0","licenseUrl":"https://creativecommons.org/publicdomain/zero/1.0/deed.en","page":"https://commons.wikimedia.org/wiki/File:National_Arboretum_Canberra;_view_east,_from_Dairy_Farmers_Hill.jpg"},
  "tpl-canberra-weekend": {"src":"/img/covers/canberra-weekend.jpg","w":800,"h":400,"alt":"The National Museum of Australia across Lake Burley Griffin","author":"Dietmar Rabich","license":"CC BY-SA 4.0","licenseUrl":"https://creativecommons.org/licenses/by-sa/4.0","page":"https://commons.wikimedia.org/wiki/File:Canberra_(AU),_National_Museum_of_Australia_--_2019_--_1709.jpg"},
  "tpl-sydney-harbour-highlights": {"src":"/img/covers/sydney-harbour-highlights.jpg","w":800,"h":450,"alt":"Sydney Opera House and Harbour Bridge","author":"DXR","license":"CC BY-SA 4.0","licenseUrl":"https://creativecommons.org/licenses/by-sa/4.0","page":"https://commons.wikimedia.org/wiki/File:Sydney_Opera_House_and_Harbour_Bridge,_southeast_view_20230224_1.jpg"},
  "tpl-sydney-bondi-coogee": {"src":"/img/covers/sydney-bondi-coogee.jpg","w":800,"h":533,"alt":"Bondi Beach, Sydney","author":"Dietmar Rabich","license":"CC BY-SA 4.0","licenseUrl":"https://creativecommons.org/licenses/by-sa/4.0","page":"https://commons.wikimedia.org/wiki/File:Sydney_(AU),_Bondi_Beach_--_2019_--_2354.jpg"},
  "tpl-sydney-manly-ferry": {"src":"/img/covers/sydney-manly-ferry.jpg","w":800,"h":599,"alt":"Manly ferry wharf","author":"Abesty","license":"CC BY-SA 3.0","licenseUrl":"https://creativecommons.org/licenses/by-sa/3.0","page":"https://commons.wikimedia.org/wiki/File:Manly_ferry_wharf_side_view.JPG"},
  "tpl-sydney-haymarket-food": {"src":"/img/covers/sydney-haymarket-food.jpg","w":800,"h":600,"alt":"The Queen Victoria Building, Sydney","author":"Dietmar Rabich","license":"CC BY-SA 4.0","licenseUrl":"https://creativecommons.org/licenses/by-sa/4.0","page":"https://commons.wikimedia.org/wiki/File:Sydney_(AU),_Queen_Victoria_Building_--_2019_--_3580.jpg"},
  "tpl-sydney-blue-mountains": {"src":"/img/covers/sydney-blue-mountains.jpg","w":800,"h":533,"alt":"The Three Sisters, Blue Mountains","author":"Dietmar Rabich","license":"CC BY-SA 4.0","licenseUrl":"https://creativecommons.org/licenses/by-sa/4.0","page":"https://commons.wikimedia.org/wiki/File:Blue_Mountains_National_Park_(AU),_Three_Sisters_--_2019_--_1983.jpg"},
  "tpl-tokyo-asakusa-ueno": {"src":"/img/covers/tokyo-asakusa-ueno.jpg","w":800,"h":600,"alt":"Senso-ji temple, Asakusa","author":"Guilhem Vellut from Annecy, France","license":"CC BY 2.0","licenseUrl":"https://creativecommons.org/licenses/by/2.0","page":"https://commons.wikimedia.org/wiki/File:Senso-ji_Temple_@_Asakusa_(13824517393).jpg"},
  "tpl-tokyo-shibuya-shinjuku": {"src":"/img/covers/tokyo-shibuya-shinjuku.jpg","w":800,"h":533,"alt":"Shibuya Crossing at night","author":"Benh LIEU SONG (Flickr)","license":"CC BY-SA 2.0","licenseUrl":"https://creativecommons.org/licenses/by-sa/2.0","page":"https://commons.wikimedia.org/wiki/File:Tokyo_Shibuya_Scramble_Crossing_2018-10-09.jpg"},
  "tpl-tokyo-tsukiji-hamarikyu": {"src":"/img/covers/tokyo-tsukiji-hamarikyu.jpg","w":800,"h":600,"alt":"Seafood stalls at Tsukiji Outer Market","author":"Aw1805","license":"CC BY-SA 3.0","licenseUrl":"https://creativecommons.org/licenses/by-sa/3.0","page":"https://commons.wikimedia.org/wiki/File:Tsukiji_Outer_Market_2.jpg"},
  "tpl-tokyo-kamakura": {"src":"/img/covers/tokyo-kamakura.jpg","w":800,"h":533,"alt":"The Great Buddha of Kamakura","author":"Suicasmo","license":"CC BY-SA 4.0","licenseUrl":"https://creativecommons.org/licenses/by-sa/4.0","page":"https://commons.wikimedia.org/wiki/File:Kamakura_Daibutsu_20170210.jpg"},
  "dest-canberra": {"src":"/img/covers/dest-canberra.jpg","w":800,"h":450,"alt":"Old and new Parliament Houses across Lake Burley Griffin, Canberra","author":"Thennicke","license":"CC BY-SA 4.0","licenseUrl":"https://creativecommons.org/licenses/by-sa/4.0","page":"https://commons.wikimedia.org/wiki/File:Old_and_new_Parliament_Houses;_Canberra_Australia.jpg"},
  "dest-sydney": {"src":"/img/covers/dest-sydney.jpg","w":800,"h":316,"alt":"The Sydney skyline at dusk","author":"Diliff","license":"CC BY-SA 3.0","licenseUrl":"https://creativecommons.org/licenses/by-sa/3.0","page":"https://commons.wikimedia.org/wiki/File:Sydney_skyline_at_dusk_-_Dec_2008.jpg"},
  "dest-tokyo": {"src":"/img/covers/dest-tokyo.jpg","w":800,"h":450,"alt":"Minato City and Tokyo Tower","author":"David Kernan","license":"CC BY 4.0","licenseUrl":"https://creativecommons.org/licenses/by/4.0","page":"https://commons.wikimedia.org/wiki/File:Minato_City,_Tokyo,_Japan.jpg"},
  "dest-paris": {"src": "/img/covers/dest-paris.jpg", "w": 1200, "h": 771, "alt": "The Eiffel Tower seen from the Trocadéro, with the fountains and gardens in front on a clear summer day, Paris", "author": "NonOmnisMoriar", "license": "CC BY-SA 3.0", "licenseUrl": "https://creativecommons.org/licenses/by-sa/3.0", "page": "https://commons.wikimedia.org/wiki/File:Eiffel_tower_from_trocadero.jpg"},
  "dest-london": {"src": "/img/covers/dest-london.jpg", "w": 1200, "h": 472, "alt": "The Palace of Westminster and Elizabeth Tower (Big Ben) lit up at dusk, reflected in the River Thames, London", "author": "Diliff", "license": "CC BY-SA 2.5", "licenseUrl": "https://creativecommons.org/licenses/by-sa/2.5", "page": "https://commons.wikimedia.org/wiki/File:Palace_of_Westminster,_London_-_Feb_2007.jpg"},
  "dest-rome": {"src": "/img/covers/dest-rome.jpg", "w": 1200, "h": 704, "alt": "The Colosseum floodlit against a deep blue evening sky, Rome", "author": "Diliff", "license": "CC BY-SA 2.5", "licenseUrl": "https://creativecommons.org/licenses/by-sa/2.5", "page": "https://commons.wikimedia.org/wiki/File:Colosseum_in_Rome,_Italy_-_April_2007.jpg"},
  "dest-barcelona": {"src": "/img/covers/dest-barcelona.jpg", "w": 1200, "h": 806, "alt": "The spires of the Sagrada Família rising above Barcelona's rooftops, with hills behind", "author": "Bernard Gagnon", "license": "CC BY-SA 3.0", "licenseUrl": "https://creativecommons.org/licenses/by-sa/3.0", "page": "https://commons.wikimedia.org/wiki/File:Sagrada_Familia_01.jpg"},
  "dest-amsterdam": {"src": "/img/covers/dest-amsterdam.jpg", "w": 1200, "h": 900, "alt": "An arched brick bridge over the Reguliersgracht canal, with canal houses and bare winter trees, Amsterdam", "author": "Fons Heijnsbroek", "license": "CC0", "licenseUrl": "https://creativecommons.org/publicdomain/zero/1.0/deed.en", "page": "https://commons.wikimedia.org/wiki/File:Amsterdam_free_canal_photo_with_brick_old_bridge,_location_Reguliersgracht_01-2022,_Fons_Heijnbroek.jpg"},
  "dest-new-york": {"src": "/img/covers/dest-new-york.jpg", "w": 1200, "h": 480, "alt": "The Lower Manhattan skyline and One World Trade Center at blue hour, seen across the Hudson River from Jersey City", "author": "King of Hearts", "license": "CC BY-SA 3.0", "licenseUrl": "https://creativecommons.org/licenses/by-sa/3.0", "page": "https://commons.wikimedia.org/wiki/File:Lower_Manhattan_from_Jersey_City_November_2014_panorama_3.jpg"},
  "dest-san-francisco": {"src": "/img/covers/dest-san-francisco.jpg", "w": 1200, "h": 900, "alt": "The Golden Gate Bridge at sunset, its red tower in the foreground spanning the strait, San Francisco", "author": "Rich Niewiroski Jr.", "license": "CC BY 2.5", "licenseUrl": "https://creativecommons.org/licenses/by/2.5", "page": "https://commons.wikimedia.org/wiki/File:GoldenGateBridge-001.jpg"},
  "dest-los-angeles": {"src": "/img/covers/dest-los-angeles.jpg", "w": 1200, "h": 562, "alt": "Downtown Los Angeles skyscrapers with snow-capped Mount Baldy glowing pink behind at sunset", "author": "Alek Leckszas", "license": "CC BY-SA 4.0", "licenseUrl": "https://creativecommons.org/licenses/by-sa/4.0", "page": "https://commons.wikimedia.org/wiki/File:Los_Angeles_with_Mount_Baldy.jpg"},
  "dest-shanghai": {"src": "/img/covers/dest-shanghai.jpg", "w": 1200, "h": 600, "alt": "The Lujiazui skyline in Pudong at night, with the Oriental Pearl Tower and Shanghai Tower, seen across the Huangpu River from the Bund", "author": "King of Hearts", "license": "CC BY-SA 4.0", "licenseUrl": "https://creativecommons.org/licenses/by-sa/4.0", "page": "https://commons.wikimedia.org/wiki/File:Pudong_Shanghai_November_2017_HDR_panorama.jpg"},
  "dest-beijing": {"src": "/img/covers/dest-beijing.jpg", "w": 1200, "h": 799, "alt": "The round, triple-roofed Hall of Prayer for Good Harvests at the Temple of Heaven under a blue sky, Beijing", "author": "xiquinhosilva", "license": "CC BY 2.0", "licenseUrl": "https://creativecommons.org/licenses/by/2.0", "page": "https://commons.wikimedia.org/wiki/File:Temple_of_Heaven_-_Hall_of_Prayer_for_Good_Harvests_03.jpg"},
  "dest-seoul": {"src": "/img/covers/dest-seoul.jpg", "w": 1200, "h": 675, "alt": "Geunjeongjeon, the throne hall of Gyeongbokgung Palace, across its stone courtyard under a blue sky, Seoul", "author": "Basile Morin", "license": "CC BY-SA 4.0", "licenseUrl": "https://creativecommons.org/licenses/by-sa/4.0", "page": "https://commons.wikimedia.org/wiki/File:Front_view_of_the_Imperial_Throne_Hall_Geunjeongjeon_at_Gyeongbokgung_Palace_with_blue_sky_in_Seoul.jpg"},
  "dest-busan": {"src": "/img/covers/dest-busan.jpg", "w": 1200, "h": 750, "alt": "Brightly painted houses stacked up the hillside of Gamcheon Culture Village at sunset, Busan", "author": "Basile Morin", "license": "CC BY-SA 4.0", "licenseUrl": "https://creativecommons.org/licenses/by-sa/4.0", "page": "https://commons.wikimedia.org/wiki/File:Colorful_houses_in_Gamcheon_Culture_Village_at_sunset_in_Busan_South_Korea.jpg"},
  "dest-kyoto": {"src": "/img/covers/dest-kyoto.jpg", "w": 1200, "h": 900, "alt": "Kinkaku-ji, the gold-leafed Golden Pavilion, beside its pond and surrounded by pines, Kyoto", "author": "Jaycangel", "license": "CC BY-SA 3.0", "licenseUrl": "https://creativecommons.org/licenses/by-sa/3.0", "page": "https://commons.wikimedia.org/wiki/File:Kinkaku-ji_the_Golden_Temple_in_Kyoto_overlooking_the_lake_-_high_rez.JPG"},
  "dest-melbourne": {"src": "/img/covers/dest-melbourne.jpg", "w": 1200, "h": 661, "alt": "The Melbourne CBD skyline above the Yarra River and its tree-lined Northbank promenade", "author": "Dietmar Rabich", "license": "CC BY-SA 4.0", "licenseUrl": "https://creativecommons.org/licenses/by-sa/4.0", "page": "https://commons.wikimedia.org/wiki/File:Melbourne_(AU),_Northbank_--_2019_--_1422-7.jpg"},
};

// Itineraries without a photo of their own show their city's (same file, same
// credit), so a card or a copied trip never loses its picture.
export const SHARED_COVERS = {
  "tpl-melbourne-laneways-gardens": "dest-melbourne",
  "tpl-kyoto-shrines-gion": "dest-kyoto",
  "tpl-seoul-palaces-markets": "dest-seoul",
  "tpl-busan-beaches-villages": "dest-busan",
  "tpl-shanghai-bund-gardens": "dest-shanghai",
  "tpl-beijing-imperial-hutongs": "dest-beijing",
  "tpl-paris-classic-weekend": "dest-paris",
  "tpl-london-royal-riverside": "dest-london",
  "tpl-rome-ancient-vatican": "dest-rome",
  "tpl-barcelona-gaudi-gothic": "dest-barcelona",
  "tpl-amsterdam-canals-museums": "dest-amsterdam",
  "tpl-new-york-manhattan": "dest-new-york",
  "tpl-san-francisco-bay": "dest-san-francisco",
  "tpl-los-angeles-views-coast": "dest-los-angeles",
};

export const photoFor = (key) => PHOTOS[key] ?? PHOTOS[SHARED_COVERS[key]] ?? null;

// decorative: the surrounding text already names the place, so alt is empty
export function coverImg(photo, { eager = false, decorative = false } = {}) {
  if (!photo) return null;
  return h("img", {
    class: "cover-img",
    src: photo.src,
    alt: decorative ? "" : photo.alt,
    width: photo.w,
    height: photo.h,
    loading: eager ? "eager" : "lazy",
    decoding: "async",
    onerror: (e) => e.currentTarget.remove(),
  });
}

export function photoCredit(photo, { short = false } = {}) {
  if (!photo) return null;
  return h(
    "span",
    { class: "cover-credit" },
    "Photo: ",
    h("a", { href: photo.page, target: "_blank", rel: "noopener" }, photo.author ?? "Wikimedia Commons"),
    ", ",
    h("a", { href: photo.licenseUrl, target: "_blank", rel: "noopener license" }, photo.license),
    short ? null : " (resized), via Wikimedia Commons",
  );
}
