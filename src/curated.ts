// Wayline's curated sample itineraries (V1). Written by hand for the
// project, not by users and not taken from Google. Every stop is a real
// place with approximate coordinates, enough to place it on a map and rank
// by distance. No Google place ids are written here: each stop carries a
// search query, and when a server key is configured the app looks the place
// up and stores the id Google returns (see itineraries.ts).
//
// Bump CURATED_VERSION when this content changes so existing databases pick
// it up; place ids already verified for an unchanged query are kept.

export const CURATED_VERSION = 1;

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

export const DESTINATIONS = [
  { id: "canberra", name: "Canberra", region: "Australian Capital Territory, Australia", lat: -35.2809, lng: 149.13 },
  { id: "sydney", name: "Sydney", region: "New South Wales, Australia", lat: -33.8688, lng: 151.2093 },
  { id: "tokyo", name: "Tokyo", region: "Japan", lat: 35.6762, lng: 139.6503 },
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
];
