import { h } from "/ui.js";

// Photos of the curated destinations, from Wikimedia Commons, resized to 800px
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
};

export const photoFor = (key) => PHOTOS[key] ?? null;

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
