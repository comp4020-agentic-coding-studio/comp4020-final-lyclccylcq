// Wayline's curated sample itineraries (V1). Written by hand for the
// project, not by users and not taken from Google. Every stop is a real
// place with approximate coordinates, enough to place it on a map and rank
// by distance. No Google place ids are written here: each stop carries a
// search query, and when a server key is configured the app looks the place
// up and stores the id Google returns (see itineraries.ts).
//
// Bump CURATED_VERSION when this content changes so existing databases pick
// it up; place ids already verified for an unchanged query are kept.

// 2: fourteen more cities across Europe, North America, East Asia and Oceania
export const CURATED_VERSION = 2;

export type Category = "half-day" | "one-day" | "weekend" | "food-culture" | "nature-outdoors" | "city-highlights";
export type StopKind = "attraction" | "food" | "shopping" | "accommodation" | "custom";

export type CuratedStop = {
  title: string;
  kind: StopKind;
  day?: number;
  start: string;
  minutes: number;
  lat: number;
  lng: number;
  query: string;
  note?: string;
};

export type CuratedItinerary = {
  slug: string;
  title: string;
  destination: string;
  timezone: string;
  description: string;
  categories: Category[];
  featured?: boolean;
  ref: [number, number];
  days: number;
  stops: CuratedStop[];
};

// The browsing regions on the homepage. A destination's `region` stays the
// display line it has always had (search and the demo places read it);
// `area` and `country` are what the homepage filters on.
export const AREAS = ["Europe", "North America", "East Asia", "Oceania"] as const;
export type Area = (typeof AREAS)[number];

export type Destination = { id: string; name: string; region: string; country: string; area: Area; lat: number; lng: number; blurb: string };

export const DESTINATIONS: Destination[] = [
  { id: "canberra", name: "Canberra", region: "Australian Capital Territory, Australia", country: "Australia", area: "Oceania", lat: -35.2809, lng: 149.13, blurb: "Lakeside galleries, national institutions and bush lookouts." },
  { id: "sydney", name: "Sydney", region: "New South Wales, Australia", country: "Australia", area: "Oceania", lat: -33.8688, lng: 151.2093, blurb: "The harbour, ocean beaches and the Blue Mountains." },
  { id: "melbourne", name: "Melbourne", region: "Victoria, Australia", country: "Australia", area: "Oceania", lat: -37.8136, lng: 144.9631, blurb: "Laneway coffee, galleries and the Yarra." },
  { id: "tokyo", name: "Tokyo", region: "Japan", country: "Japan", area: "East Asia", lat: 35.6762, lng: 139.6503, blurb: "Temples and towers, markets and neon." },
  { id: "kyoto", name: "Kyoto", region: "Kansai, Japan", country: "Japan", area: "East Asia", lat: 35.0116, lng: 135.7681, blurb: "Shrines, bamboo groves and old Gion." },
  { id: "seoul", name: "Seoul", region: "South Korea", country: "South Korea", area: "East Asia", lat: 37.5665, lng: 126.978, blurb: "Palaces, hanok lanes and night markets." },
  { id: "busan", name: "Busan", region: "South Korea", country: "South Korea", area: "East Asia", lat: 35.1796, lng: 129.0756, blurb: "Beaches, hillside villages and seafood." },
  { id: "shanghai", name: "Shanghai", region: "China", country: "China", area: "East Asia", lat: 31.2304, lng: 121.4737, blurb: "The Bund, old gardens and the skyline." },
  { id: "beijing", name: "Beijing", region: "China", country: "China", area: "East Asia", lat: 39.9042, lng: 116.4074, blurb: "Imperial palaces, hutongs and the Great Wall." },
  { id: "paris", name: "Paris", region: "Île-de-France, France", country: "France", area: "Europe", lat: 48.8566, lng: 2.3522, blurb: "Museums, the Seine and café terraces." },
  { id: "london", name: "London", region: "England, United Kingdom", country: "United Kingdom", area: "Europe", lat: 51.5072, lng: -0.1276, blurb: "Royal landmarks, markets and the Thames." },
  { id: "rome", name: "Rome", region: "Lazio, Italy", country: "Italy", area: "Europe", lat: 41.9028, lng: 12.4964, blurb: "Ancient ruins, piazzas and the Vatican." },
  { id: "barcelona", name: "Barcelona", region: "Catalonia, Spain", country: "Spain", area: "Europe", lat: 41.3874, lng: 2.1686, blurb: "Gaudí, the Gothic Quarter and the sea." },
  { id: "amsterdam", name: "Amsterdam", region: "North Holland, Netherlands", country: "Netherlands", area: "Europe", lat: 52.3676, lng: 4.9041, blurb: "Canals, museums and the Jordaan." },
  { id: "new-york", name: "New York", region: "New York, United States", country: "United States", area: "North America", lat: 40.7128, lng: -74.006, blurb: "Central Park, galleries and skyline views." },
  { id: "san-francisco", name: "San Francisco", region: "California, United States", country: "United States", area: "North America", lat: 37.7749, lng: -122.4194, blurb: "The Golden Gate, hills and the bay." },
  { id: "los-angeles", name: "Los Angeles", region: "California, United States", country: "United States", area: "North America", lat: 34.0522, lng: -118.2437, blurb: "Griffith views, museums and the coast." },
];

const S = (title: string, kind: StopKind, start: string, minutes: number, lat: number, lng: number, query: string, extra: Partial<CuratedStop> = {}): CuratedStop => ({
  title, kind, start, minutes, lat, lng, query, ...extra,
});

export const CURATED: CuratedItinerary[] = [
  // --- Canberra ---
  {
    slug: "canberra-national-institutions",
    title: "Canberra's National Institutions",
    destination: "Canberra",
    timezone: "Australia/Sydney",
    description: "A full day around the Parliamentary Triangle: Parliament House, the National Gallery, lunch on the Kingston foreshore, and the Australian War Memorial in the afternoon.",
    categories: ["one-day", "city-highlights"],
    featured: true,
    ref: [-35.2985, 149.1340],
    days: 1,
    stops: [
      S("Parliament House", "attraction", "09:30", 90, -35.3082, 149.1244, "Parliament House, Canberra ACT"),
      S("National Gallery of Australia", "attraction", "11:30", 90, -35.3003, 149.1365, "National Gallery of Australia, Parkes ACT"),
      S("Lunch on the Kingston Foreshore", "food", "13:30", 75, -35.3155, 149.1515, "Kingston Foreshore, Kingston ACT"),
      S("Australian War Memorial", "attraction", "15:00", 120, -35.281, 149.149, "Australian War Memorial, Campbell ACT", { note: "A ceremony is held near closing time most days; check the Memorial's website for times." }),
    ],
  },
  {
    slug: "canberra-lookouts-gardens",
    title: "Lookouts & Gardens",
    destination: "Canberra",
    timezone: "Australia/Sydney",
    description: "A morning of native plants and wide views: the National Botanic Gardens, then up Black Mountain and Mount Ainslie to see the city's design from above.",
    categories: ["half-day", "nature-outdoors"],
    ref: [-35.2760, 149.1200],
    days: 1,
    stops: [
      S("Australian National Botanic Gardens", "attraction", "08:30", 120, -35.2785, 149.109, "Australian National Botanic Gardens, Acton ACT"),
      S("Black Mountain Tower", "attraction", "11:00", 60, -35.2753, 149.0977, "Black Mountain Tower, Canberra"),
      S("Mount Ainslie Lookout", "attraction", "12:30", 45, -35.2706, 149.1567, "Mount Ainslie Lookout, Canberra"),
    ],
  },
  {
    slug: "canberra-arboretum-braddon",
    title: "Arboretum & Braddon Evening",
    destination: "Canberra",
    timezone: "Australia/Sydney",
    description: "An afternoon among the forests of the National Arboretum, then dinner on Lonsdale Street in Braddon.",
    categories: ["half-day", "food-culture"],
    ref: [-35.2800, 149.1000],
    days: 1,
    stops: [
      S("National Arboretum Canberra", "attraction", "14:00", 120, -35.288, 149.069, "National Arboretum Canberra"),
      S("Dinner on Lonsdale Street", "food", "17:00", 120, -35.2735, 149.1335, "Lonsdale Street, Braddon ACT"),
    ],
  },
  {
    slug: "canberra-weekend",
    title: "A Weekend in Canberra",
    destination: "Canberra",
    timezone: "Australia/Sydney",
    description: "Two relaxed days: museums and science on Saturday, a Sunday market, the War Memorial and sunset from Mount Ainslie.",
    categories: ["weekend", "city-highlights"],
    ref: [-35.2950, 149.1350],
    days: 2,
    stops: [
      S("National Museum of Australia", "attraction", "10:00", 120, -35.293, 149.121, "National Museum of Australia, Acton ACT"),
      S("Questacon", "attraction", "13:00", 120, -35.2985, 149.1313, "Questacon National Science and Technology Centre"),
      S("Dinner in Braddon", "food", "18:00", 90, -35.2735, 149.1335, "Lonsdale Street, Braddon ACT"),
      S("Old Bus Depot Markets", "shopping", "10:00", 90, -35.3173, 149.1462, "Old Bus Depot Markets, Kingston ACT", { day: 2, note: "Runs on Sunday mornings." }),
      S("Australian War Memorial", "attraction", "13:00", 150, -35.281, 149.149, "Australian War Memorial, Campbell ACT", { day: 2 }),
      S("Mount Ainslie Lookout", "attraction", "16:30", 45, -35.2706, 149.1567, "Mount Ainslie Lookout, Canberra", { day: 2 }),
    ],
  },

  // --- Sydney ---
  {
    slug: "sydney-harbour-highlights",
    title: "Sydney Harbour Highlights",
    destination: "Sydney",
    timezone: "Australia/Sydney",
    description: "The classic harbour day on foot: the Botanic Garden, the Opera House, lunch in The Rocks, a walk across the Harbour Bridge and Barangaroo Reserve.",
    categories: ["one-day", "city-highlights"],
    featured: true,
    ref: [-33.8590, 151.2110],
    days: 1,
    stops: [
      S("Royal Botanic Garden Sydney", "attraction", "09:00", 90, -33.8642, 151.2166, "Royal Botanic Garden Sydney"),
      S("Sydney Opera House", "attraction", "10:45", 60, -33.8568, 151.2153, "Sydney Opera House", { note: "Guided tours run through the day; booking ahead is recommended." }),
      S("Lunch in The Rocks", "food", "12:15", 75, -33.8599, 151.209, "The Rocks, Sydney NSW"),
      S("Sydney Harbour Bridge walk", "attraction", "14:00", 60, -33.8523, 151.2108, "Sydney Harbour Bridge"),
      S("Barangaroo Reserve", "attraction", "15:30", 60, -33.8569, 151.2025, "Barangaroo Reserve, Sydney"),
    ],
  },
  {
    slug: "sydney-bondi-coogee",
    title: "Bondi to Coogee Coastal Walk",
    destination: "Sydney",
    timezone: "Australia/Sydney",
    description: "Sydney's best-known coastal walk, beach to beach, with time for a swim and lunch at Coogee.",
    categories: ["half-day", "nature-outdoors"],
    featured: true,
    ref: [-33.9050, 151.2700],
    days: 1,
    stops: [
      S("Bondi Beach", "attraction", "08:00", 45, -33.8915, 151.2767, "Bondi Beach, NSW"),
      S("Bronte Beach", "attraction", "09:15", 30, -33.9036, 151.2681, "Bronte Beach, NSW"),
      S("Clovelly Beach", "attraction", "10:00", 30, -33.9134, 151.2675, "Clovelly Beach, NSW"),
      S("Coogee Beach", "food", "11:00", 60, -33.92, 151.2577, "Coogee Beach, NSW"),
    ],
  },
  {
    slug: "sydney-manly-ferry",
    title: "Ferry to Manly",
    destination: "Sydney",
    timezone: "Australia/Sydney",
    description: "Cross the harbour by ferry, then spend the morning on Manly's ocean beach and the sheltered cove at Shelly Beach.",
    categories: ["half-day", "nature-outdoors"],
    ref: [-33.8000, 151.2880],
    days: 1,
    stops: [
      S("Circular Quay", "attraction", "09:30", 15, -33.8613, 151.2108, "Circular Quay, Sydney", { note: "Ferries to Manly leave from Circular Quay; check Transport for NSW for timetables." }),
      S("Manly Wharf", "attraction", "10:15", 20, -33.8003, 151.2843, "Manly Wharf, Manly NSW"),
      S("Manly Beach", "attraction", "10:45", 90, -33.7969, 151.2878, "Manly Beach, NSW"),
      S("Shelly Beach", "attraction", "12:30", 60, -33.8, 151.2967, "Shelly Beach, Manly NSW"),
    ],
  },
  {
    slug: "sydney-haymarket-food",
    title: "Haymarket Food & Markets",
    destination: "Sydney",
    timezone: "Australia/Sydney",
    description: "From the Queen Victoria Building down to Chinatown and Paddy's Markets, finishing on the water at Darling Harbour.",
    categories: ["half-day", "food-culture"],
    ref: [-33.8770, 151.2040],
    days: 1,
    stops: [
      S("Queen Victoria Building", "shopping", "11:00", 45, -33.8718, 151.2067, "Queen Victoria Building, Sydney"),
      S("Lunch in Chinatown", "food", "12:00", 75, -33.8786, 151.204, "Dixon Street, Haymarket NSW"),
      S("Paddy's Markets Haymarket", "shopping", "13:30", 45, -33.8802, 151.2023, "Paddy's Markets Haymarket"),
      S("Darling Harbour", "attraction", "14:45", 75, -33.8749, 151.2009, "Darling Harbour, Sydney"),
    ],
  },
  {
    slug: "sydney-blue-mountains",
    title: "Blue Mountains Weekend",
    destination: "Blue Mountains (from Sydney)",
    timezone: "Australia/Sydney",
    description: "Two days in the Blue Mountains west of Sydney: the Three Sisters, Scenic World and Leura on day one; Wentworth Falls and Govetts Leap on day two.",
    categories: ["weekend", "nature-outdoors"],
    ref: [-33.7150, 150.3110],
    days: 2,
    stops: [
      S("Echo Point Lookout", "attraction", "10:30", 60, -33.732, 150.312, "Echo Point Lookout, Katoomba NSW"),
      S("Scenic World", "attraction", "12:00", 150, -33.728, 150.301, "Scenic World, Katoomba NSW"),
      S("Leura Mall", "food", "16:00", 90, -33.713, 150.331, "Leura Mall, Leura NSW"),
      S("Wentworth Falls", "attraction", "09:00", 150, -33.727, 150.376, "Wentworth Falls Lookout, NSW", { day: 2 }),
      S("Govetts Leap Lookout", "attraction", "13:00", 60, -33.629, 150.311, "Govetts Leap Lookout, Blackheath NSW", { day: 2 }),
    ],
  },

  // --- Tokyo ---
  {
    slug: "tokyo-asakusa-ueno",
    title: "Asakusa, Ueno & Yanaka",
    destination: "Tokyo",
    timezone: "Asia/Tokyo",
    description: "Old Tokyo in a day: Senso-ji in the morning, Ueno Park and Ameyoko, the backstreets of Yanaka, and Tokyo Skytree at dusk.",
    categories: ["one-day", "food-culture"],
    featured: true,
    ref: [35.7150, 139.7850],
    days: 1,
    stops: [
      S("Senso-ji", "attraction", "09:00", 75, 35.7148, 139.7967, "Senso-ji, Asakusa, Tokyo"),
      S("Ueno Park", "attraction", "11:00", 90, 35.7156, 139.7745, "Ueno Park, Tokyo"),
      S("Lunch at Ameyoko", "food", "12:45", 60, 35.71, 139.7745, "Ameyoko Shopping Street, Ueno"),
      S("Yanaka Ginza", "shopping", "14:30", 60, 35.7277, 139.766, "Yanaka Ginza, Tokyo"),
      S("Tokyo Skytree", "attraction", "17:00", 90, 35.7101, 139.8107, "Tokyo Skytree"),
    ],
  },
  {
    slug: "tokyo-shibuya-shinjuku",
    title: "Harajuku, Shibuya & Shinjuku",
    destination: "Tokyo",
    timezone: "Asia/Tokyo",
    description: "Western Tokyo end to end: Meiji Jingu's forest, Takeshita Street, Shibuya Crossing, Shinjuku Gyoen, and dinner in the lanes of Omoide Yokocho.",
    categories: ["one-day", "city-highlights"],
    ref: [35.6750, 139.7030],
    days: 1,
    stops: [
      S("Meiji Jingu", "attraction", "09:00", 75, 35.6764, 139.6993, "Meiji Jingu, Shibuya, Tokyo"),
      S("Takeshita Street", "shopping", "10:30", 60, 35.6717, 139.7032, "Takeshita Street, Harajuku"),
      S("Shibuya Crossing", "attraction", "12:00", 45, 35.6595, 139.7005, "Shibuya Scramble Crossing"),
      S("Shinjuku Gyoen", "attraction", "14:00", 90, 35.6852, 139.71, "Shinjuku Gyoen National Garden"),
      S("Dinner at Omoide Yokocho", "food", "18:00", 90, 35.693, 139.6995, "Omoide Yokocho, Shinjuku"),
    ],
  },
  {
    slug: "tokyo-tsukiji-hamarikyu",
    title: "Tsukiji Breakfast & Hamarikyu",
    destination: "Tokyo",
    timezone: "Asia/Tokyo",
    description: "An early start at the Tsukiji Outer Market for breakfast, then a stroll through the tidal garden at Hamarikyu.",
    categories: ["half-day", "food-culture"],
    ref: [35.6630, 139.7670],
    days: 1,
    stops: [
      S("Tsukiji Outer Market", "food", "08:00", 90, 35.6655, 139.7707, "Tsukiji Outer Market, Tokyo"),
      S("Hamarikyu Gardens", "attraction", "10:00", 90, 35.66, 139.7633, "Hama-rikyu Gardens, Tokyo"),
    ],
  },
  {
    slug: "tokyo-kamakura",
    title: "Kamakura Day Trip",
    destination: "Kamakura (from Tokyo)",
    timezone: "Asia/Tokyo",
    description: "Temples, the Great Buddha and the sea, an hour south of Tokyo.",
    categories: ["one-day", "nature-outdoors"],
    ref: [35.3192, 139.5467],
    days: 1,
    stops: [
      S("Tsurugaoka Hachimangu", "attraction", "10:00", 60, 35.3259, 139.5564, "Tsurugaoka Hachimangu, Kamakura"),
      S("Lunch on Komachi-dori", "food", "11:15", 60, 35.32, 139.5512, "Komachi-dori, Kamakura"),
      S("Kotoku-in (Great Buddha)", "attraction", "13:00", 45, 35.3167, 139.5357, "Kotoku-in, Kamakura"),
      S("Hase-dera", "attraction", "14:00", 75, 35.3127, 139.5333, "Hase-dera, Kamakura"),
      S("Yuigahama Beach", "attraction", "15:45", 60, 35.3105, 139.5435, "Yuigahama Beach, Kamakura"),
    ],
  },
  // --- Melbourne ---
  {
    slug: "melbourne-laneways-gardens",
    title: "Melbourne Laneways & Gardens",
    destination: "Melbourne",
    timezone: "Australia/Melbourne",
    description: "Two days in the city centre and around it: laneway coffee, Federation Square and the NGV, the Royal Botanic Gardens, Queen Victoria Market and an evening on Southbank.",
    categories: ["weekend", "city-highlights"],
    featured: true,
    ref: [-37.8136, 144.9631],
    days: 2,
    stops: [
      S("Coffee in Degraves Street", "food", "08:30", 45, -37.8171, 144.9655, "Degraves Street, Melbourne", { day: 1 }),
      S("Federation Square", "attraction", "09:30", 45, -37.818, 144.969, "Federation Square, Melbourne", { day: 1 }),
      S("National Gallery of Victoria", "attraction", "10:30", 120, -37.8226, 144.9689, "National Gallery of Victoria, St Kilda Road", { day: 1 }),
      S("Lunch on Southbank", "food", "12:45", 60, -37.8205, 144.9644, "Southbank Promenade, Melbourne", { day: 1 }),
      S("Royal Botanic Gardens", "attraction", "14:15", 105, -37.8304, 144.9796, "Royal Botanic Gardens Victoria, Melbourne", { day: 1 }),
      S("Dinner in Chinatown", "food", "18:30", 75, -37.8115, 144.9689, "Little Bourke Street Chinatown, Melbourne", { day: 1 }),
      S("Queen Victoria Market", "food", "09:00", 90, -37.8076, 144.9568, "Queen Victoria Market, Melbourne", { day: 2 }),
      S("State Library Victoria", "attraction", "11:00", 60, -37.8098, 144.9652, "State Library Victoria, Melbourne", { day: 2 }),
      S("Lunch in Fitzroy", "food", "12:30", 60, -37.7987, 144.9784, "Brunswick Street, Fitzroy, Melbourne", { day: 2 }),
      S("St Kilda Pier", "attraction", "15:00", 75, -37.8676, 144.9744, "St Kilda Pier, Melbourne", { day: 2 }),
      S("Dinner in St Kilda", "food", "18:00", 75, -37.8676, 144.9802, "Acland Street, St Kilda", { day: 2 }),
    ],
  },
  // --- Kyoto ---
  {
    slug: "kyoto-shrines-gion",
    title: "Kyoto: Shrines, Bamboo & Gion",
    destination: "Kyoto",
    timezone: "Asia/Tokyo",
    description: "Fushimi Inari's gates at opening time, Kiyomizu-dera and the old lanes below it, then a day out west at Arashiyama's bamboo grove and Kinkaku-ji, ending in Gion.",
    categories: ["weekend", "food-culture"],
    featured: true,
    ref: [35.0116, 135.7681],
    days: 2,
    stops: [
      S("Fushimi Inari Taisha", "attraction", "08:00", 120, 34.9671, 135.7727, "Fushimi Inari Taisha, Kyoto", { day: 1 }),
      S("Lunch near Kiyomizu", "food", "11:45", 60, 34.9965, 135.7807, "Gojozaka, Higashiyama, Kyoto", { day: 1 }),
      S("Kiyomizu-dera", "attraction", "13:00", 90, 34.9949, 135.785, "Kiyomizu-dera, Kyoto", { day: 1 }),
      S("Sannenzaka & Ninenzaka", "shopping", "14:45", 60, 34.9981, 135.7808, "Sannenzaka, Kyoto", { day: 1 }),
      S("Yasaka Shrine", "attraction", "16:00", 45, 35.0037, 135.7785, "Yasaka Shrine, Kyoto", { day: 1 }),
      S("Dinner in Pontocho", "food", "18:30", 90, 35.0059, 135.7708, "Pontocho Alley, Kyoto", { day: 1 }),
      S("Arashiyama Bamboo Grove", "attraction", "08:30", 60, 35.0170, 135.6713, "Arashiyama Bamboo Grove, Kyoto", { day: 2 }),
      S("Tenryu-ji", "attraction", "09:45", 75, 35.0157, 135.6738, "Tenryu-ji, Kyoto", { day: 2 }),
      S("Lunch in Arashiyama", "food", "11:30", 60, 35.0144, 135.6778, "Saga-Arashiyama, Kyoto", { day: 2 }),
      S("Kinkaku-ji", "attraction", "13:30", 75, 35.0394, 135.7292, "Kinkaku-ji, Kyoto", { day: 2 }),
      S("Nishiki Market", "food", "16:00", 60, 35.005, 135.7649, "Nishiki Market, Kyoto", { day: 2 }),
      S("Evening walk in Gion", "attraction", "18:00", 60, 35.0036, 135.7756, "Hanamikoji Street, Gion, Kyoto", { day: 2 }),
    ],
  },
  // --- Seoul ---
  {
    slug: "seoul-palaces-markets",
    title: "Seoul: Palaces, Hanok & Night Markets",
    destination: "Seoul",
    timezone: "Asia/Seoul",
    description: "Gyeongbokgung and Bukchon's hanok lanes, Insadong and Gwangjang Market, then N Seoul Tower, Myeongdong and an evening by the Cheonggyecheon stream.",
    categories: ["weekend", "city-highlights"],
    featured: true,
    ref: [37.5665, 126.978],
    days: 2,
    stops: [
      S("Gyeongbokgung Palace", "attraction", "09:00", 120, 37.5796, 126.977, "Gyeongbokgung Palace, Seoul", { day: 1 }),
      S("Bukchon Hanok Village", "attraction", "11:15", 75, 37.5826, 126.9831, "Bukchon Hanok Village, Seoul", { day: 1 }),
      S("Lunch in Insadong", "food", "12:45", 60, 37.5743, 126.9849, "Insadong-gil, Seoul", { day: 1 }),
      S("Changdeokgung & Secret Garden", "attraction", "14:15", 105, 37.5794, 126.991, "Changdeokgung Palace, Seoul", { day: 1 }),
      S("Dinner at Gwangjang Market", "food", "18:00", 75, 37.5701, 126.9996, "Gwangjang Market, Seoul", { day: 1 }),
      S("Namsan & N Seoul Tower", "attraction", "10:00", 120, 37.5512, 126.9882, "N Seoul Tower, Seoul", { day: 2 }),
      S("Lunch in Myeongdong", "food", "12:30", 60, 37.5636, 126.9826, "Myeongdong, Seoul", { day: 2 }),
      S("Deoksugung Palace", "attraction", "14:00", 75, 37.5658, 126.9751, "Deoksugung Palace, Seoul", { day: 2 }),
      S("Cheonggyecheon Stream", "attraction", "16:00", 60, 37.5694, 126.9787, "Cheonggyecheon Plaza, Seoul", { day: 2 }),
      S("Dinner in Ikseon-dong", "food", "18:00", 75, 37.5744, 126.9897, "Ikseon-dong Hanok Street, Seoul", { day: 2 }),
    ],
  },
  // --- Busan ---
  {
    slug: "busan-beaches-villages",
    title: "Busan: Beaches & Hillside Villages",
    destination: "Busan",
    timezone: "Asia/Seoul",
    description: "Haedong Yonggungsa on the sea cliffs and Haeundae Beach, then Gamcheon Culture Village's painted lanes and fresh seafood at Jagalchi Market.",
    categories: ["weekend", "nature-outdoors"],
    ref: [35.1796, 129.0756],
    days: 2,
    stops: [
      S("Haedong Yonggungsa Temple", "attraction", "09:00", 90, 35.1884, 129.2233, "Haedong Yonggungsa, Busan", { day: 1 }),
      S("Lunch in Haeundae", "food", "11:45", 60, 35.1631, 129.1635, "Haeundae Market, Busan", { day: 1 }),
      S("Haeundae Beach", "attraction", "13:00", 90, 35.1587, 129.1604, "Haeundae Beach, Busan", { day: 1 }),
      S("Dongbaekseom Island", "attraction", "14:45", 60, 35.1531, 129.1522, "Dongbaekseom, Busan", { day: 1 }),
      S("Dinner in Gwangalli", "food", "18:30", 75, 35.1532, 129.1186, "Gwangalli Beach, Busan", { day: 1 }),
      S("Gamcheon Culture Village", "attraction", "09:30", 120, 35.0975, 129.0106, "Gamcheon Culture Village, Busan", { day: 2 }),
      S("Lunch at Jagalchi Market", "food", "12:15", 75, 35.0966, 129.0306, "Jagalchi Fish Market, Busan", { day: 2 }),
      S("BIFF Square & Gukje Market", "shopping", "13:45", 75, 35.0985, 129.0279, "Gukje Market, Busan", { day: 2 }),
      S("Busan Tower, Yongdusan Park", "attraction", "15:15", 60, 35.1007, 129.0326, "Busan Tower, Yongdusan Park", { day: 2 }),
    ],
  },
  // --- Shanghai ---
  {
    slug: "shanghai-bund-gardens",
    title: "Shanghai: The Bund, Gardens & Skyline",
    destination: "Shanghai",
    timezone: "Asia/Shanghai",
    description: "The Bund at morning, Yu Garden and the old city, then the former French Concession's plane-tree streets, Tianzifang and the Lujiazui skyline at dusk.",
    categories: ["weekend", "city-highlights"],
    featured: true,
    ref: [31.2304, 121.4737],
    days: 2,
    stops: [
      S("The Bund", "attraction", "08:30", 75, 31.2402, 121.4903, "The Bund, Shanghai", { day: 1 }),
      S("Yu Garden", "attraction", "10:00", 90, 31.2272, 121.4921, "Yu Garden, Shanghai", { day: 1 }),
      S("Lunch in the old city", "food", "11:45", 60, 31.2261, 121.4911, "Yuyuan Bazaar, Shanghai", { day: 1 }),
      S("Shanghai Museum", "attraction", "13:30", 120, 31.2283, 121.4757, "Shanghai Museum, People's Square", { day: 1 }),
      S("Nanjing Road", "shopping", "16:00", 60, 31.2349, 121.4793, "Nanjing Road Pedestrian Street, Shanghai", { day: 1 }),
      S("Dinner and the Bund at night", "food", "18:30", 90, 31.2397, 121.4881, "East Nanjing Road, Shanghai", { day: 1 }),
      S("Former French Concession walk", "attraction", "09:30", 90, 31.2116, 121.4459, "Wukang Road, Shanghai", { day: 2 }),
      S("Tianzifang", "shopping", "11:15", 75, 31.2096, 121.4689, "Tianzifang, Shanghai", { day: 2 }),
      S("Lunch in Xintiandi", "food", "12:45", 60, 31.2196, 121.4747, "Xintiandi, Shanghai", { day: 2 }),
      S("Lujiazui and the Shanghai Tower", "attraction", "15:30", 120, 31.2335, 121.5055, "Shanghai Tower, Lujiazui", { day: 2 }),
      S("Dinner in Lujiazui", "food", "18:30", 75, 31.2397, 121.5003, "Lujiazui, Shanghai", { day: 2 }),
    ],
  },
  // --- Beijing ---
  {
    slug: "beijing-imperial-hutongs",
    title: "Beijing: Imperial City, Hutongs & the Great Wall",
    destination: "Beijing",
    timezone: "Asia/Shanghai",
    description: "Tiananmen, the Forbidden City and Jingshan's view over it, the hutongs around Houhai, then a day on the Great Wall at Mutianyu and the Temple of Heaven.",
    categories: ["weekend", "city-highlights"],
    ref: [39.9042, 116.4074],
    days: 2,
    stops: [
      S("Tiananmen Square", "attraction", "08:30", 45, 39.9055, 116.3976, "Tiananmen Square, Beijing", { day: 1 }),
      S("The Forbidden City", "attraction", "09:30", 180, 39.9163, 116.3972, "The Palace Museum, Beijing", { day: 1 }),
      S("Lunch near Jingshan", "food", "12:45", 60, 39.9261, 116.3975, "Jingshan Front Street, Beijing", { day: 1 }),
      S("Jingshan Park", "attraction", "14:00", 60, 39.9255, 116.3966, "Jingshan Park, Beijing", { day: 1 }),
      S("Hutongs around Houhai", "attraction", "15:30", 90, 39.9416, 116.3858, "Shichahai, Beijing", { day: 1 }),
      S("Dinner on Nanluoguxiang", "food", "18:00", 75, 39.9369, 116.4033, "Nanluoguxiang, Beijing", { day: 1 }),
      S("Great Wall at Mutianyu", "attraction", "09:00", 210, 40.4319, 116.5704, "Mutianyu Great Wall", { day: 2, note: "About 90 minutes from central Beijing; leave early." }),
      S("Lunch at Mutianyu", "food", "12:45", 60, 40.4263, 116.5667, "Mutianyu Village, Huairou, Beijing", { day: 2 }),
      S("Temple of Heaven", "attraction", "16:00", 90, 39.8822, 116.4066, "Temple of Heaven, Beijing", { day: 2 }),
      S("Peking duck dinner", "food", "18:30", 90, 39.8996, 116.4108, "Qianmen Street, Beijing", { day: 2 }),
    ],
  },
  // --- Paris ---
  {
    slug: "paris-classic-weekend",
    title: "Paris: The Classic Weekend",
    destination: "Paris",
    timezone: "Europe/Paris",
    description: "The Louvre and the Tuileries, Notre-Dame and the Latin Quarter, then Montmartre in the morning, the Musée d'Orsay, and the Eiffel Tower at dusk.",
    categories: ["weekend", "city-highlights"],
    featured: true,
    ref: [48.8566, 2.3522],
    days: 2,
    stops: [
      S("Musée du Louvre", "attraction", "09:00", 180, 48.8606, 2.3376, "Musée du Louvre, Paris", { day: 1 }),
      S("Lunch near the Palais-Royal", "food", "12:15", 60, 48.8638, 2.3372, "Palais-Royal, Paris", { day: 1 }),
      S("Jardin des Tuileries", "attraction", "13:30", 45, 48.8635, 2.3275, "Jardin des Tuileries, Paris", { day: 1 }),
      S("Notre-Dame & Île de la Cité", "attraction", "15:00", 75, 48.853, 2.3499, "Cathédrale Notre-Dame de Paris", { day: 1 }),
      S("Dinner in the Latin Quarter", "food", "18:30", 90, 48.8509, 2.3447, "Rue Mouffetard, Paris", { day: 1 }),
      S("Sacré-Cœur & Montmartre", "attraction", "09:00", 120, 48.8867, 2.3431, "Basilique du Sacré-Cœur, Montmartre", { day: 2 }),
      S("Lunch in Montmartre", "food", "11:30", 60, 48.8848, 2.3389, "Place du Tertre, Paris", { day: 2 }),
      S("Musée d'Orsay", "attraction", "13:30", 150, 48.86, 2.3266, "Musée d'Orsay, Paris", { day: 2 }),
      S("Eiffel Tower", "attraction", "17:00", 105, 48.8584, 2.2945, "Tour Eiffel, Paris", { day: 2 }),
      S("Dinner near the Champ de Mars", "food", "19:15", 90, 48.8556, 2.2986, "Rue Cler, Paris", { day: 2 }),
    ],
  },
  // --- London ---
  {
    slug: "london-royal-riverside",
    title: "London: Royal Landmarks & the Riverside",
    destination: "London",
    timezone: "Europe/London",
    description: "Westminster and Buckingham Palace, a walk through St James's Park to the National Gallery, then the British Museum, Borough Market, Tate Modern and the Tower of London.",
    categories: ["weekend", "city-highlights"],
    featured: true,
    ref: [51.5072, -0.1276],
    days: 2,
    stops: [
      S("Westminster Abbey", "attraction", "09:30", 90, 51.4994, -0.1273, "Westminster Abbey, London", { day: 1 }),
      S("Houses of Parliament & Big Ben", "attraction", "11:15", 30, 51.4995, -0.1248, "Palace of Westminster, London", { day: 1 }),
      S("Lunch near Whitehall", "food", "12:00", 60, 51.5033, -0.1276, "Whitehall, London", { day: 1 }),
      S("Buckingham Palace & St James's Park", "attraction", "13:30", 75, 51.5014, -0.1419, "Buckingham Palace, London", { day: 1 }),
      S("National Gallery", "attraction", "15:15", 105, 51.5089, -0.1283, "National Gallery, Trafalgar Square, London", { day: 1 }),
      S("Dinner in Covent Garden", "food", "18:30", 90, 51.5117, -0.124, "Covent Garden, London", { day: 1 }),
      S("British Museum", "attraction", "10:00", 150, 51.5194, -0.127, "British Museum, London", { day: 2 }),
      S("Lunch at Borough Market", "food", "13:00", 75, 51.5055, -0.091, "Borough Market, London", { day: 2 }),
      S("Tate Modern", "attraction", "14:30", 90, 51.5076, -0.0994, "Tate Modern, London", { day: 2 }),
      S("Tower of London & Tower Bridge", "attraction", "16:15", 105, 51.5081, -0.0759, "Tower of London", { day: 2 }),
      S("Dinner by the river", "food", "18:45", 75, 51.5045, -0.0865, "Shad Thames, London", { day: 2 }),
    ],
  },
  // --- Rome ---
  {
    slug: "rome-ancient-vatican",
    title: "Rome: The Ancient City & the Vatican",
    destination: "Rome",
    timezone: "Europe/Rome",
    description: "The Colosseum and the Roman Forum, the Pantheon and Piazza Navona, then the Vatican Museums and St Peter's, ending at the Trevi Fountain and the Spanish Steps.",
    categories: ["weekend", "city-highlights"],
    featured: true,
    ref: [41.9028, 12.4964],
    days: 2,
    stops: [
      S("Colosseum", "attraction", "08:30", 120, 41.8902, 12.4922, "Colosseum, Rome", { day: 1 }),
      S("Roman Forum & Palatine Hill", "attraction", "10:45", 120, 41.8925, 12.4853, "Roman Forum, Rome", { day: 1 }),
      S("Lunch in Monti", "food", "13:00", 60, 41.8952, 12.4925, "Rione Monti, Rome", { day: 1 }),
      S("Pantheon", "attraction", "14:45", 45, 41.8986, 12.4769, "Pantheon, Rome", { day: 1 }),
      S("Piazza Navona", "attraction", "15:45", 45, 41.8992, 12.4731, "Piazza Navona, Rome", { day: 1 }),
      S("Dinner in Trastevere", "food", "19:00", 90, 41.8897, 12.4697, "Trastevere, Rome", { day: 1 }),
      S("Vatican Museums & Sistine Chapel", "attraction", "08:30", 180, 41.9065, 12.4536, "Vatican Museums, Vatican City", { day: 2 }),
      S("St Peter's Basilica", "attraction", "11:45", 75, 41.9022, 12.4539, "St. Peter's Basilica, Vatican City", { day: 2 }),
      S("Lunch in Prati", "food", "13:15", 60, 41.9067, 12.4627, "Prati, Rome", { day: 2 }),
      S("Trevi Fountain", "attraction", "16:00", 30, 41.9009, 12.4833, "Trevi Fountain, Rome", { day: 2 }),
      S("Spanish Steps", "attraction", "16:45", 45, 41.906, 12.4828, "Spanish Steps, Rome", { day: 2 }),
      S("Dinner near Campo de' Fiori", "food", "19:00", 90, 41.8955, 12.4722, "Campo de' Fiori, Rome", { day: 2 }),
    ],
  },
  // --- Barcelona ---
  {
    slug: "barcelona-gaudi-gothic",
    title: "Barcelona: Gaudí, the Gothic Quarter & the Sea",
    destination: "Barcelona",
    timezone: "Europe/Madrid",
    description: "The Sagrada Família and Park Güell, then the Gothic Quarter, La Boqueria and the Picasso Museum, ending on Barceloneta beach.",
    categories: ["weekend", "food-culture"],
    ref: [41.3874, 2.1686],
    days: 2,
    stops: [
      S("Sagrada Família", "attraction", "09:00", 120, 41.4036, 2.1744, "Sagrada Família, Barcelona", { day: 1 }),
      S("Lunch in Gràcia", "food", "12:30", 60, 41.4027, 2.1564, "Gràcia, Barcelona", { day: 1 }),
      S("Park Güell", "attraction", "14:00", 90, 41.4145, 2.1527, "Park Güell, Barcelona", { day: 1 }),
      S("Casa Batlló on Passeig de Gràcia", "attraction", "16:30", 75, 41.3916, 2.165, "Casa Batlló, Barcelona", { day: 1 }),
      S("Dinner in the Eixample", "food", "20:30", 90, 41.3907, 2.162, "Eixample, Barcelona", { day: 1, note: "Barcelona dines late; 20:30 is early." }),
      S("La Boqueria", "food", "09:30", 60, 41.3817, 2.1716, "Mercat de la Boqueria, Barcelona", { day: 2 }),
      S("Gothic Quarter & the Cathedral", "attraction", "10:45", 90, 41.3839, 2.1763, "Barcelona Cathedral, Barri Gòtic", { day: 2 }),
      S("Picasso Museum", "attraction", "12:30", 90, 41.3852, 2.1808, "Museu Picasso, Barcelona", { day: 2 }),
      S("Lunch in El Born", "food", "14:15", 75, 41.3851, 2.1834, "El Born, Barcelona", { day: 2 }),
      S("Barceloneta Beach", "attraction", "16:30", 105, 41.3784, 2.1925, "Barceloneta Beach, Barcelona", { day: 2 }),
      S("Seafood dinner in Barceloneta", "food", "20:30", 90, 41.3797, 2.1893, "Barceloneta, Barcelona", { day: 2 }),
    ],
  },
  // --- Amsterdam ---
  {
    slug: "amsterdam-canals-museums",
    title: "Amsterdam: Canals & Museums",
    destination: "Amsterdam",
    timezone: "Europe/Amsterdam",
    description: "The Rijksmuseum and the Van Gogh Museum on Museumplein, Vondelpark, then the Anne Frank House, the Jordaan's canals and a boat on the canal ring.",
    categories: ["weekend", "city-highlights"],
    ref: [52.3676, 4.9041],
    days: 2,
    stops: [
      S("Rijksmuseum", "attraction", "09:00", 150, 52.36, 4.8852, "Rijksmuseum, Amsterdam", { day: 1 }),
      S("Lunch on Museumplein", "food", "11:45", 60, 52.3579, 4.8822, "Museumplein, Amsterdam", { day: 1 }),
      S("Van Gogh Museum", "attraction", "13:00", 120, 52.3584, 4.8811, "Van Gogh Museum, Amsterdam", { day: 1 }),
      S("Vondelpark", "attraction", "15:30", 60, 52.358, 4.8686, "Vondelpark, Amsterdam", { day: 1 }),
      S("Dinner in De Pijp", "food", "18:30", 90, 52.3547, 4.8936, "De Pijp, Amsterdam", { day: 1 }),
      S("Anne Frank House", "attraction", "09:30", 75, 52.3752, 4.884, "Anne Frank House, Amsterdam", { day: 2, note: "Tickets sell out; book ahead." }),
      S("The Jordaan & Nine Streets", "shopping", "11:00", 90, 52.3713, 4.8851, "De 9 Straatjes, Amsterdam", { day: 2 }),
      S("Lunch in the Jordaan", "food", "12:45", 60, 52.3747, 4.8807, "Jordaan, Amsterdam", { day: 2 }),
      S("Canal cruise", "attraction", "14:30", 75, 52.3779, 4.8963, "Canal cruise, Amsterdam Centraal", { day: 2 }),
      S("Dam Square & the Royal Palace", "attraction", "16:15", 60, 52.3731, 4.8926, "Royal Palace of Amsterdam, Dam Square", { day: 2 }),
      S("Dinner by the canals", "food", "18:30", 90, 52.3667, 4.8955, "Reguliersgracht, Amsterdam", { day: 2 }),
    ],
  },
  // --- New York ---
  {
    slug: "new-york-manhattan",
    title: "New York: Manhattan Highlights",
    destination: "New York",
    timezone: "America/New_York",
    description: "Central Park and the Met, Times Square and a view from the Top of the Rock, then the High Line, Chelsea Market and the Brooklyn Bridge at sunset.",
    categories: ["weekend", "city-highlights"],
    featured: true,
    ref: [40.7128, -74.006],
    days: 2,
    stops: [
      S("Central Park", "attraction", "09:00", 105, 40.7812, -73.9665, "Central Park, New York", { day: 1 }),
      S("The Metropolitan Museum of Art", "attraction", "11:00", 150, 40.7794, -73.9632, "The Metropolitan Museum of Art, New York", { day: 1 }),
      S("Lunch on the Upper East Side", "food", "13:45", 60, 40.7736, -73.9566, "Upper East Side, Manhattan", { day: 1 }),
      S("Fifth Avenue & St Patrick's", "attraction", "15:15", 60, 40.7585, -73.9762, "St. Patrick's Cathedral, New York", { day: 1 }),
      S("Top of the Rock", "attraction", "16:45", 75, 40.7593, -73.9794, "Top of the Rock, Rockefeller Center", { day: 1 }),
      S("Times Square & dinner", "food", "18:30", 90, 40.758, -73.9855, "Times Square, New York", { day: 1 }),
      S("The High Line", "attraction", "09:30", 75, 40.748, -74.0048, "The High Line, New York", { day: 2 }),
      S("Lunch at Chelsea Market", "food", "11:00", 60, 40.7424, -74.0061, "Chelsea Market, New York", { day: 2 }),
      S("Greenwich Village & Washington Square", "attraction", "12:30", 75, 40.7308, -73.9973, "Washington Square Park, New York", { day: 2 }),
      S("9/11 Memorial", "attraction", "14:15", 75, 40.7115, -74.0134, "9/11 Memorial & Museum, New York", { day: 2 }),
      S("Brooklyn Bridge", "attraction", "16:30", 60, 40.7061, -73.9969, "Brooklyn Bridge, New York", { day: 2 }),
      S("Dinner in DUMBO", "food", "18:15", 90, 40.7033, -73.9881, "DUMBO, Brooklyn", { day: 2 }),
    ],
  },
  // --- San Francisco ---
  {
    slug: "san-francisco-bay",
    title: "San Francisco: The Bay & the Hills",
    destination: "San Francisco",
    timezone: "America/Los_Angeles",
    description: "The Ferry Building, a cable car over the hills and Fisherman's Wharf, then the Golden Gate Bridge, the Palace of Fine Arts and Chinatown.",
    categories: ["weekend", "city-highlights"],
    ref: [37.7749, -122.4194],
    days: 2,
    stops: [
      S("Ferry Building Marketplace", "food", "09:00", 60, 37.7955, -122.3937, "Ferry Building Marketplace, San Francisco", { day: 1 }),
      S("Cable car to Nob Hill", "attraction", "10:15", 45, 37.7946, -122.4115, "Powell-Hyde Cable Car, San Francisco", { day: 1 }),
      S("Lombard Street", "attraction", "11:15", 30, 37.8021, -122.4187, "Lombard Street, San Francisco", { day: 1 }),
      S("Lunch at Fisherman's Wharf", "food", "12:15", 60, 37.808, -122.4177, "Fisherman's Wharf, San Francisco", { day: 1 }),
      S("Pier 39", "attraction", "13:30", 60, 37.8087, -122.4098, "Pier 39, San Francisco", { day: 1 }),
      S("Coit Tower", "attraction", "15:00", 60, 37.8024, -122.4058, "Coit Tower, San Francisco", { day: 1 }),
      S("Dinner in North Beach", "food", "18:30", 90, 37.8006, -122.4103, "North Beach, San Francisco", { day: 1 }),
      S("Golden Gate Bridge", "attraction", "09:30", 105, 37.8199, -122.4783, "Golden Gate Bridge Welcome Center", { day: 2 }),
      S("Palace of Fine Arts", "attraction", "11:45", 45, 37.8029, -122.4484, "Palace of Fine Arts, San Francisco", { day: 2 }),
      S("Lunch in the Marina", "food", "12:45", 60, 37.8002, -122.4378, "Chestnut Street, San Francisco", { day: 2 }),
      S("Golden Gate Park", "attraction", "14:30", 120, 37.7694, -122.4862, "Golden Gate Park, San Francisco", { day: 2 }),
      S("Dinner in Chinatown", "food", "18:00", 90, 37.7941, -122.4078, "Chinatown, San Francisco", { day: 2 }),
    ],
  },
  // --- Los Angeles ---
  {
    slug: "los-angeles-views-coast",
    title: "Los Angeles: Views, Art & the Coast",
    destination: "Los Angeles",
    timezone: "America/Los_Angeles",
    description: "Griffith Observatory and Hollywood, The Broad and Grand Central Market downtown, then the Getty Center and sunset at Santa Monica Pier.",
    categories: ["weekend", "city-highlights"],
    ref: [34.0522, -118.2437],
    days: 2,
    stops: [
      S("Griffith Observatory", "attraction", "10:00", 105, 34.1184, -118.3004, "Griffith Observatory, Los Angeles", { day: 1 }),
      S("Lunch in Los Feliz", "food", "12:15", 60, 34.1063, -118.2848, "Los Feliz Village, Los Angeles", { day: 1 }),
      S("Hollywood Walk of Fame", "attraction", "14:00", 75, 34.1016, -118.3267, "Hollywood Walk of Fame", { day: 1 }),
      S("The Broad", "attraction", "16:00", 90, 34.0545, -118.2506, "The Broad, Los Angeles", { day: 1 }),
      S("Dinner downtown", "food", "18:30", 90, 34.0472, -118.2527, "Downtown Los Angeles", { day: 1 }),
      S("Grand Central Market", "food", "09:00", 60, 34.0508, -118.2489, "Grand Central Market, Los Angeles", { day: 2 }),
      S("Getty Center", "attraction", "10:45", 150, 34.0780, -118.4741, "Getty Center, Los Angeles", { day: 2 }),
      S("Lunch at the Getty", "food", "13:30", 60, 34.0776, -118.4746, "Getty Center Restaurant", { day: 2 }),
      S("Venice Beach Boardwalk", "attraction", "15:30", 75, 33.985, -118.4695, "Venice Beach Boardwalk, Los Angeles", { day: 2 }),
      S("Santa Monica Pier at sunset", "attraction", "17:15", 60, 34.0094, -118.4973, "Santa Monica Pier", { day: 2 }),
      S("Dinner in Santa Monica", "food", "18:45", 90, 34.0157, -118.4966, "Third Street Promenade, Santa Monica", { day: 2 }),
    ],
  },
];
