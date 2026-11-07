// Simplified Chinese for Wayline's curated content (November 2026), written
// by hand from the English in curated.ts and saying no more than it does.
// The database and every matching key (ids, search queries, AREAS,
// countries, FOOD_STYLE_OF) stay English; itineraries.ts lays these over
// what the API returns when the request's language is "zh".
// Stops are keyed by their English title, notes by their English text.
// spec/curated-zh.test.ts checks every destination, slug, stop and note
// has an entry here.

export type DestinationZh = { name: string; region: string; blurb: string };
export type ItineraryZh = { title: string; destination: string; description: string; stops: Record<string, string>; notes?: Record<string, string> };

export const DESTINATIONS_ZH: Record<string, DestinationZh> = {
  canberra: { name: "堪培拉", region: "澳大利亚首都领地，澳大利亚", blurb: "湖畔美术馆、国家级机构和丛林观景台。" },
  sydney: { name: "悉尼", region: "新南威尔士州，澳大利亚", blurb: "海港、海滩和蓝山。" },
  melbourne: { name: "墨尔本", region: "维多利亚州，澳大利亚", blurb: "小巷咖啡、美术馆和亚拉河。" },
  tokyo: { name: "东京", region: "日本", blurb: "寺庙与高塔，市场与霓虹。" },
  kyoto: { name: "京都", region: "日本关西", blurb: "神社、竹林和古老的祇园。" },
  seoul: { name: "首尔", region: "韩国", blurb: "宫殿、韩屋巷弄和夜市。" },
  busan: { name: "釜山", region: "韩国", blurb: "海滩、山坡村落和海鲜。" },
  shanghai: { name: "上海", region: "中国", blurb: "外滩、古典园林和天际线。" },
  beijing: { name: "北京", region: "中国", blurb: "皇家宫殿、胡同和长城。" },
  paris: { name: "巴黎", region: "法兰西岛大区，法国", blurb: "博物馆、塞纳河和咖啡馆露台。" },
  london: { name: "伦敦", region: "英格兰，英国", blurb: "皇家地标、市集和泰晤士河。" },
  rome: { name: "罗马", region: "拉齐奥大区，意大利", blurb: "古代遗迹、广场和梵蒂冈。" },
  barcelona: { name: "巴塞罗那", region: "加泰罗尼亚，西班牙", blurb: "高迪、哥特区和地中海。" },
  amsterdam: { name: "阿姆斯特丹", region: "北荷兰省，荷兰", blurb: "运河、博物馆和约旦区。" },
  "new-york": { name: "纽约", region: "纽约州，美国", blurb: "中央公园、美术馆和天际线景观。" },
  "san-francisco": { name: "旧金山", region: "加利福尼亚州，美国", blurb: "金门大桥、山丘和海湾。" },
  "los-angeles": { name: "洛杉矶", region: "加利福尼亚州，美国", blurb: "格里菲斯的景色、博物馆和海岸。" },
  "lake-brienz": { name: "布里恩茨湖", region: "伯尔尼高地，瑞士", blurb: "湖畔村庄、瀑布和头顶的阿尔卑斯山。" },
  male: { name: "马累", region: "卡夫环礁，马尔代夫", blurb: "首都的市场和清真寺，以及胡鲁马累的海滩。" },
};

export const ITINERARIES_ZH: Record<string, ItineraryZh> = {
  // --- Canberra ---
  "canberra-national-institutions": {
    title: "堪培拉国家级机构之旅",
    destination: "堪培拉",
    description: "在议会三角区度过一整天：国会大厦、澳大利亚国家美术馆，在金斯顿湖滨吃午饭，下午参观澳大利亚战争纪念馆。",
    stops: {
      "Parliament House": "国会大厦",
      "National Gallery of Australia": "澳大利亚国家美术馆",
      "Lunch on the Kingston Foreshore": "金斯顿湖滨午餐",
      "Australian War Memorial": "澳大利亚战争纪念馆",
    },
    notes: {
      "A ceremony is held near closing time most days; check the Memorial's website for times.": "大多数日子闭馆前后会举行仪式，具体时间请查看纪念馆官网。",
    },
  },
  "canberra-lookouts-gardens": {
    title: "观景台与植物园",
    destination: "堪培拉",
    description: "一个与本土植物和开阔景色相伴的上午：先逛澳大利亚国家植物园，再登上黑山和安斯利山，从高处看这座城市的规划布局。",
    stops: {
      "Australian National Botanic Gardens": "澳大利亚国家植物园",
      "Black Mountain Tower": "黑山塔",
      "Mount Ainslie Lookout": "安斯利山观景台",
    },
  },
  "canberra-arboretum-braddon": {
    title: "国家树木园与布拉登之夜",
    destination: "堪培拉",
    description: "下午漫步国家树木园的林间，晚上到布拉登的朗斯代尔街吃晚饭。",
    stops: {
      "National Arboretum Canberra": "堪培拉国家树木园",
      "Dinner on Lonsdale Street": "朗斯代尔街晚餐",
    },
  },
  "canberra-weekend": {
    title: "堪培拉周末",
    destination: "堪培拉",
    description: "轻松的两天：周六看博物馆和科学馆，周日逛市集、参观战争纪念馆，在安斯利山看日落。",
    stops: {
      "National Museum of Australia": "澳大利亚国家博物馆",
      Questacon: "国家科学技术中心（Questacon）",
      "Dinner in Braddon": "布拉登晚餐",
      "Old Bus Depot Markets": "旧巴士站市集",
      "Australian War Memorial": "澳大利亚战争纪念馆",
      "Mount Ainslie Lookout": "安斯利山观景台",
    },
    notes: {
      "Runs on Sunday mornings.": "每周日上午开市。",
    },
  },

  // --- Sydney ---
  "sydney-harbour-highlights": {
    title: "悉尼海港精华",
    destination: "悉尼",
    description: "经典的海港步行一日游：皇家植物园、悉尼歌剧院，在岩石区吃午饭，步行穿过海港大桥，再到巴兰加鲁自然保护区。",
    stops: {
      "Royal Botanic Garden Sydney": "悉尼皇家植物园",
      "Sydney Opera House": "悉尼歌剧院",
      "Lunch in The Rocks": "岩石区午餐",
      "Sydney Harbour Bridge walk": "步行悉尼海港大桥",
      "Barangaroo Reserve": "巴兰加鲁自然保护区",
    },
    notes: {
      "Guided tours run through the day; booking ahead is recommended.": "全天都有导览团，建议提前预订。",
    },
  },
  "sydney-bondi-coogee": {
    title: "邦迪至库吉海岸步道",
    destination: "悉尼",
    description: "悉尼最有名的海岸步道，从一片海滩走到另一片海滩，途中有时间游泳，最后在库吉吃午饭。",
    stops: {
      "Bondi Beach": "邦迪海滩",
      "Bronte Beach": "勃朗特海滩",
      "Clovelly Beach": "克洛夫利海滩",
      "Coogee Beach": "库吉海滩",
    },
  },
  "sydney-manly-ferry": {
    title: "乘渡轮去曼利",
    destination: "悉尼",
    description: "乘渡轮横渡海港，上午在曼利的海滩和避风的雪莉海滩小湾度过。",
    stops: {
      "Circular Quay": "环形码头",
      "Manly Wharf": "曼利码头",
      "Manly Beach": "曼利海滩",
      "Shelly Beach": "雪莉海滩",
    },
    notes: {
      "Ferries to Manly leave from Circular Quay; check Transport for NSW for timetables.": "前往曼利的渡轮从环形码头出发，时刻表请查看新州交通局（Transport for NSW）。",
    },
  },
  "sydney-haymarket-food": {
    title: "干草市场美食与市集",
    destination: "悉尼",
    description: "从维多利亚女王大厦一路走到唐人街和帕迪斯市场，最后在达令港的水边收尾。",
    stops: {
      "Queen Victoria Building": "维多利亚女王大厦",
      "Lunch in Chinatown": "唐人街午餐",
      "Paddy's Markets Haymarket": "干草市场帕迪斯市场",
      "Darling Harbour": "达令港",
    },
  },
  "sydney-blue-mountains": {
    title: "蓝山周末",
    destination: "蓝山（从悉尼出发）",
    description: "在悉尼以西的蓝山待两天：第一天看三姐妹峰、景观世界和卢拉，第二天去温特沃斯瀑布和戈维茨跳台。",
    stops: {
      "Echo Point Lookout": "回声角观景台",
      "Scenic World": "景观世界",
      "Leura Mall": "卢拉商业街",
      "Wentworth Falls": "温特沃斯瀑布",
      "Govetts Leap Lookout": "戈维茨跳台观景台",
    },
  },

  // --- Tokyo ---
  "tokyo-asakusa-ueno": {
    title: "浅草、上野与谷中",
    destination: "东京",
    description: "一天走遍老东京：上午浅草寺，接着上野公园和阿美横町，再逛谷中的小巷，傍晚登东京晴空塔。",
    stops: {
      "Senso-ji": "浅草寺",
      "Ueno Park": "上野公园",
      "Lunch at Ameyoko": "阿美横町午餐",
      "Yanaka Ginza": "谷中银座",
      "Tokyo Skytree": "东京晴空塔",
    },
  },
  "tokyo-shibuya-shinjuku": {
    title: "原宿、涩谷与新宿",
    destination: "东京",
    description: "从头到尾走一遍东京西部：明治神宫的森林、竹下通、涩谷十字路口、新宿御苑，晚上在回忆横丁的小巷里吃晚饭。",
    stops: {
      "Meiji Jingu": "明治神宫",
      "Takeshita Street": "竹下通",
      "Shibuya Crossing": "涩谷十字路口",
      "Shinjuku Gyoen": "新宿御苑",
      "Dinner at Omoide Yokocho": "回忆横丁晚餐",
    },
  },
  "tokyo-tsukiji-hamarikyu": {
    title: "筑地早餐与滨离宫",
    destination: "东京",
    description: "一早到筑地场外市场吃早餐，然后在滨离宫的潮汐庭园里散步。",
    stops: {
      "Tsukiji Outer Market": "筑地场外市场",
      "Hamarikyu Gardens": "滨离宫恩赐庭园",
    },
  },
  "tokyo-kamakura": {
    title: "镰仓一日游",
    destination: "镰仓（从东京出发）",
    description: "寺庙、大佛和大海，就在东京以南一小时车程。",
    stops: {
      "Tsurugaoka Hachimangu": "鹤冈八幡宫",
      "Lunch on Komachi-dori": "小町通午餐",
      "Kotoku-in (Great Buddha)": "高德院（镰仓大佛）",
      "Hase-dera": "长谷寺",
      "Yuigahama Beach": "由比滨海滩",
    },
  },

  // --- Melbourne ---
  "melbourne-laneways-gardens": {
    title: "墨尔本小巷与花园",
    destination: "墨尔本",
    description: "在市中心及周边待两天：小巷咖啡、联邦广场和维多利亚国家美术馆、皇家植物园、维多利亚女王市场，晚上去南岸。",
    stops: {
      "Coffee in Degraves Street": "德格雷夫斯街咖啡",
      "Federation Square": "联邦广场",
      "National Gallery of Victoria": "维多利亚国家美术馆",
      "Lunch on Southbank": "南岸午餐",
      "Royal Botanic Gardens": "皇家植物园",
      "Dinner in Chinatown": "唐人街晚餐",
      "Queen Victoria Market": "维多利亚女王市场",
      "State Library Victoria": "维多利亚州立图书馆",
      "Lunch in Fitzroy": "菲茨罗伊午餐",
      "St Kilda Pier": "圣基尔达码头",
      "Dinner in St Kilda": "圣基尔达晚餐",
    },
  },

  // --- Kyoto ---
  "kyoto-shrines-gion": {
    title: "京都：神社、竹林与祇园",
    destination: "京都",
    description: "开门时分去看伏见稻荷大社的鸟居，再游清水寺和寺下的老街；第二天往西去岚山竹林和金阁寺，最后在祇园收尾。",
    stops: {
      "Fushimi Inari Taisha": "伏见稻荷大社",
      "Lunch near Kiyomizu": "清水寺附近午餐",
      "Kiyomizu-dera": "清水寺",
      "Sannenzaka & Ninenzaka": "三年坂与二年坂",
      "Yasaka Shrine": "八坂神社",
      "Dinner in Pontocho": "先斗町晚餐",
      "Arashiyama Bamboo Grove": "岚山竹林",
      "Tenryu-ji": "天龙寺",
      "Lunch in Arashiyama": "岚山午餐",
      "Kinkaku-ji": "金阁寺",
      "Nishiki Market": "锦市场",
      "Evening walk in Gion": "祇园夜间漫步",
    },
  },

  // --- Seoul ---
  "seoul-palaces-markets": {
    title: "首尔：宫殿、韩屋与夜市",
    destination: "首尔",
    description: "景福宫和北村的韩屋巷弄、仁寺洞和广藏市场，然后是N首尔塔、明洞，晚上在清溪川边散步。",
    stops: {
      "Gyeongbokgung Palace": "景福宫",
      "Bukchon Hanok Village": "北村韩屋村",
      "Lunch in Insadong": "仁寺洞午餐",
      "Changdeokgung & Secret Garden": "昌德宫与秘苑",
      "Dinner at Gwangjang Market": "广藏市场晚餐",
      "Namsan & N Seoul Tower": "南山与N首尔塔",
      "Lunch in Myeongdong": "明洞午餐",
      "Deoksugung Palace": "德寿宫",
      "Cheonggyecheon Stream": "清溪川",
      "Dinner in Ikseon-dong": "益善洞晚餐",
    },
  },

  // --- Busan ---
  "busan-beaches-villages": {
    title: "釜山：海滩与山坡村落",
    destination: "釜山",
    description: "海崖上的海东龙宫寺和海云台海滩，然后是甘川文化村的彩绘小巷，再到札嘎其市场吃新鲜海鲜。",
    stops: {
      "Haedong Yonggungsa Temple": "海东龙宫寺",
      "Lunch in Haeundae": "海云台午餐",
      "Haeundae Beach": "海云台海滩",
      "Dongbaekseom Island": "冬柏岛",
      "Dinner in Gwangalli": "广安里晚餐",
      "Gamcheon Culture Village": "甘川文化村",
      "Lunch at Jagalchi Market": "札嘎其市场午餐",
      "BIFF Square & Gukje Market": "BIFF广场与国际市场",
      "Busan Tower, Yongdusan Park": "龙头山公园釜山塔",
    },
  },

  // --- Shanghai ---
  "shanghai-bund-gardens": {
    title: "上海：外滩、园林与天际线",
    destination: "上海",
    description: "清晨的外滩、豫园和老城厢，然后漫步原法租界的梧桐街道和田子坊，黄昏时看陆家嘴的天际线。",
    stops: {
      "The Bund": "外滩",
      "Yu Garden": "豫园",
      "Lunch in the old city": "老城厢午餐",
      "Shanghai Museum": "上海博物馆",
      "Nanjing Road": "南京路",
      "Dinner and the Bund at night": "晚餐与外滩夜景",
      "Former French Concession walk": "原法租界漫步",
      Tianzifang: "田子坊",
      "Lunch in Xintiandi": "新天地午餐",
      "Lujiazui and the Shanghai Tower": "陆家嘴与上海中心大厦",
      "Dinner in Lujiazui": "陆家嘴晚餐",
    },
  },

  // --- Beijing ---
  "beijing-imperial-hutongs": {
    title: "北京：皇城、胡同与长城",
    destination: "北京",
    description: "天安门、故宫和景山上俯瞰故宫的景色，后海一带的胡同；第二天去慕田峪长城和天坛。",
    stops: {
      "Tiananmen Square": "天安门广场",
      "The Forbidden City": "故宫",
      "Lunch near Jingshan": "景山附近午餐",
      "Jingshan Park": "景山公园",
      "Hutongs around Houhai": "后海胡同",
      "Dinner on Nanluoguxiang": "南锣鼓巷晚餐",
      "Great Wall at Mutianyu": "慕田峪长城",
      "Lunch at Mutianyu": "慕田峪午餐",
      "Temple of Heaven": "天坛",
      "Peking duck dinner": "北京烤鸭晚餐",
    },
    notes: {
      "About 90 minutes from central Beijing; leave early.": "距北京市中心约90分钟车程，请早点出发。",
    },
  },

  // --- Paris ---
  "paris-classic-weekend": {
    title: "巴黎：经典周末",
    destination: "巴黎",
    description: "卢浮宫和杜乐丽花园、巴黎圣母院和拉丁区；第二天上午去蒙马特，再看奥赛博物馆，黄昏时登埃菲尔铁塔。",
    stops: {
      "Musée du Louvre": "卢浮宫",
      "Lunch near the Palais-Royal": "皇家宫殿附近午餐",
      "Jardin des Tuileries": "杜乐丽花园",
      "Notre-Dame & Île de la Cité": "巴黎圣母院与西岱岛",
      "Dinner in the Latin Quarter": "拉丁区晚餐",
      "Sacré-Cœur & Montmartre": "圣心大教堂与蒙马特",
      "Lunch in Montmartre": "蒙马特午餐",
      "Musée d'Orsay": "奥赛博物馆",
      "Eiffel Tower": "埃菲尔铁塔",
      "Dinner near the Champ de Mars": "战神广场附近晚餐",
    },
  },

  // --- London ---
  "london-royal-riverside": {
    title: "伦敦：皇家地标与泰晤士河畔",
    destination: "伦敦",
    description: "威斯敏斯特和白金汉宫，穿过圣詹姆斯公园走到国家美术馆；第二天去大英博物馆、博罗市场、泰特现代美术馆和伦敦塔。",
    stops: {
      "Westminster Abbey": "威斯敏斯特教堂",
      "Houses of Parliament & Big Ben": "国会大厦与大本钟",
      "Lunch near Whitehall": "白厅附近午餐",
      "Buckingham Palace & St James's Park": "白金汉宫与圣詹姆斯公园",
      "National Gallery": "国家美术馆",
      "Dinner in Covent Garden": "考文特花园晚餐",
      "British Museum": "大英博物馆",
      "Lunch at Borough Market": "博罗市场午餐",
      "Tate Modern": "泰特现代美术馆",
      "Tower of London & Tower Bridge": "伦敦塔与塔桥",
      "Dinner by the river": "河畔晚餐",
    },
  },

  // --- Rome ---
  "rome-ancient-vatican": {
    title: "罗马：古城与梵蒂冈",
    destination: "罗马",
    description: "罗马斗兽场和古罗马广场、万神殿和纳沃纳广场；第二天参观梵蒂冈博物馆和圣彼得大教堂，最后到特雷维喷泉和西班牙台阶。",
    stops: {
      Colosseum: "罗马斗兽场",
      "Roman Forum & Palatine Hill": "古罗马广场与帕拉蒂尼山",
      "Lunch in Monti": "蒙蒂区午餐",
      Pantheon: "万神殿",
      "Piazza Navona": "纳沃纳广场",
      "Dinner in Trastevere": "特拉斯提弗列晚餐",
      "Vatican Museums & Sistine Chapel": "梵蒂冈博物馆与西斯廷礼拜堂",
      "St Peter's Basilica": "圣彼得大教堂",
      "Lunch in Prati": "普拉蒂区午餐",
      "Trevi Fountain": "特雷维喷泉",
      "Spanish Steps": "西班牙台阶",
      "Dinner near Campo de' Fiori": "鲜花广场附近晚餐",
    },
  },

  // --- Barcelona ---
  "barcelona-gaudi-gothic": {
    title: "巴塞罗那：高迪、哥特区与海",
    destination: "巴塞罗那",
    description: "圣家堂和奎尔公园；第二天游哥特区、波盖利亚市场和毕加索博物馆，最后在巴塞罗内塔海滩收尾。",
    stops: {
      "Sagrada Família": "圣家堂",
      "Lunch in Gràcia": "格拉西亚区午餐",
      "Park Güell": "奎尔公园",
      "Casa Batlló on Passeig de Gràcia": "格拉西亚大道上的巴特罗之家",
      "Dinner in the Eixample": "扩展区晚餐",
      "La Boqueria": "波盖利亚市场",
      "Gothic Quarter & the Cathedral": "哥特区与大教堂",
      "Picasso Museum": "毕加索博物馆",
      "Lunch in El Born": "博恩区午餐",
      "Barceloneta Beach": "巴塞罗内塔海滩",
      "Seafood dinner in Barceloneta": "巴塞罗内塔海鲜晚餐",
    },
    notes: {
      "Barcelona dines late; 20:30 is early.": "巴塞罗那人晚饭吃得晚，20:30 都算早的。",
    },
  },

  // --- Amsterdam ---
  "amsterdam-canals-museums": {
    title: "阿姆斯特丹：运河与博物馆",
    destination: "阿姆斯特丹",
    description: "博物馆广场上的荷兰国立博物馆和梵高博物馆、冯德尔公园；第二天去安妮之家、约旦区的运河，再乘船游运河带。",
    stops: {
      Rijksmuseum: "荷兰国立博物馆",
      "Lunch on Museumplein": "博物馆广场午餐",
      "Van Gogh Museum": "梵高博物馆",
      Vondelpark: "冯德尔公园",
      "Dinner in De Pijp": "德派普区晚餐",
      "Anne Frank House": "安妮之家",
      "The Jordaan & Nine Streets": "约旦区与九小街",
      "Lunch in the Jordaan": "约旦区午餐",
      "Canal cruise": "运河游船",
      "Dam Square & the Royal Palace": "水坝广场与王宫",
      "Dinner by the canals": "运河边晚餐",
    },
    notes: {
      "Tickets sell out; book ahead.": "门票常常售罄，请提前预订。",
    },
  },

  // --- New York ---
  "new-york-manhattan": {
    title: "纽约：曼哈顿精华",
    destination: "纽约",
    description: "中央公园和大都会艺术博物馆、时代广场，在洛克菲勒中心顶层观景台看风景；第二天走高线公园、切尔西市场，日落时分走布鲁克林大桥。",
    stops: {
      "Central Park": "中央公园",
      "The Metropolitan Museum of Art": "大都会艺术博物馆",
      "Lunch on the Upper East Side": "上东区午餐",
      "Fifth Avenue & St Patrick's": "第五大道与圣帕特里克大教堂",
      "Top of the Rock": "洛克菲勒中心顶层观景台",
      "Times Square & dinner": "时代广场与晚餐",
      "The High Line": "高线公园",
      "Lunch at Chelsea Market": "切尔西市场午餐",
      "Greenwich Village & Washington Square": "格林尼治村与华盛顿广场",
      "9/11 Memorial": "9/11 纪念馆",
      "Brooklyn Bridge": "布鲁克林大桥",
      "Dinner in DUMBO": "DUMBO 晚餐",
    },
  },

  // --- San Francisco ---
  "san-francisco-bay": {
    title: "旧金山：海湾与山丘",
    destination: "旧金山",
    description: "渡轮大厦、乘缆车翻过山丘，再到渔人码头；第二天去金门大桥、艺术宫和唐人街。",
    stops: {
      "Ferry Building Marketplace": "渡轮大厦市场",
      "Cable car to Nob Hill": "乘缆车上诺布山",
      "Lombard Street": "九曲花街（伦巴底街）",
      "Lunch at Fisherman's Wharf": "渔人码头午餐",
      "Pier 39": "39号码头",
      "Coit Tower": "科伊特塔",
      "Dinner in North Beach": "北滩晚餐",
      "Golden Gate Bridge": "金门大桥",
      "Palace of Fine Arts": "艺术宫",
      "Lunch in the Marina": "滨海区午餐",
      "Golden Gate Park": "金门公园",
      "Dinner in Chinatown": "唐人街晚餐",
    },
  },

  // --- Los Angeles ---
  "los-angeles-views-coast": {
    title: "洛杉矶：景色、艺术与海岸",
    destination: "洛杉矶",
    description: "格里菲斯天文台和好莱坞，市中心的布罗德博物馆和中央市场；第二天去盖蒂中心，日落时分到圣莫尼卡码头。",
    stops: {
      "Griffith Observatory": "格里菲斯天文台",
      "Lunch in Los Feliz": "洛斯费利兹午餐",
      "Hollywood Walk of Fame": "好莱坞星光大道",
      "The Broad": "布罗德博物馆",
      "Dinner downtown": "市中心晚餐",
      "Grand Central Market": "中央市场",
      "Getty Center": "盖蒂中心",
      "Lunch at the Getty": "盖蒂中心午餐",
      "Venice Beach Boardwalk": "威尼斯海滩木栈道",
      "Santa Monica Pier at sunset": "日落时的圣莫尼卡码头",
      "Dinner in Santa Monica": "圣莫尼卡晚餐",
    },
  },
  // --- Lake Brienz ---
  "lake-brienz-giessbach": {
    title: "布里恩茨湖：伊瑟尔特瓦尔德、吉斯巴赫瀑布与布里恩茨",
    destination: "布里恩茨湖",
    description: "从因特拉肯出发环布里恩茨湖一日：少女峰下的霍赫马特草坪、南岸伊瑟尔特瓦尔德的栈桥、层层跌落的吉斯巴赫瀑布，在布里恩茨吃午饭、看木雕，再到奥伯里德的湖岸。",
    stops: {
      "Höhematte, Interlaken": "霍赫马特草坪（因特拉肯）",
      Iseltwald: "伊瑟尔特瓦尔德",
      "Giessbach Falls": "吉斯巴赫瀑布",
      "Lunch in Brienz": "在布里恩茨吃午饭",
      "Brienz village & woodcarving": "布里恩茨村与木雕",
      "Oberried lakeshore": "奥伯里德湖岸",
    },
    notes: {
      "The village is free to walk; the famous jetty has a turnstile and a small fee.": "村子可以免费游览；那座著名的栈桥设有闸机，需付少量费用。",
      "The path passes behind the falls. The Giessbach funicular and the lake boats don't run in winter.": "步道从瀑布后方穿过。吉斯巴赫缆索铁路和湖上游船冬季停运。",
      "Brienz is known for woodcarving; its school was founded in 1862. The Rothorn steam railway starts here in summer only.": "布里恩茨以木雕闻名，当地的木雕学校创立于 1862 年。罗特峰蒸汽齿轨铁路从这里出发，仅夏季运行。",
      "The view in Wayline's journey window: Lake Brienz from Oberried.": "Wayline 旅程窗口里的那幅景色：从奥伯里德望向布里恩茨湖。",
    },
  },
  // --- Malé & Hulhumalé ---
  "male-hulhumale-local": {
    title: "马累与胡鲁马累：本地岛屿一日",
    destination: "马累",
    description: "首都的鱼市和农产品市场、珊瑚石砌成的古星期五清真寺、苏丹公园和国家博物馆，再经锡纳马累大桥到胡鲁马累的海滩和海滨。两座都是有居民的岛屿：请穿着得体，岛上不供应酒精。",
    stops: {
      "Malé Fish Market": "马累鱼市",
      "Malé Local Market": "马累本地市场",
      "Old Friday Mosque (Hukuru Miskiy)": "古星期五清真寺（Hukuru Miskiy）",
      "Sultan Park & National Museum": "苏丹公园与国家博物馆",
      "Lunch in Malé": "在马累吃午饭",
      "Artificial Beach": "人造海滩",
      "Hulhumalé Beach": "胡鲁马累海滩",
      "Dinner on Nirolhu Magu": "在 Nirolhu Magu 吃晚饭",
    },
    notes: {
      "An active mosque: visitors see it from outside and its old graveyard, dressed modestly, away from prayer times.": "这是仍在使用的清真寺：游客可在外部及古墓园参观，请穿着得体，并避开礼拜时间。",
      "A local beach: modest swimwear. Swimsuits are for the designated tourist beach.": "这是本地海滩，请穿着保守的泳装；比基尼等泳装只适用于指定的游客海滩。",
    },
  },
};
