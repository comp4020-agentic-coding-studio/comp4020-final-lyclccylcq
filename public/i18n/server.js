// Chinese for messages the server sends in English (errors, notices,
// review notes), translated in the browser by tServer() (public/i18n.js).
// Exact text first; PATTERNS cover messages with numbers or names in them.
export const ZH = {
  // --- general, requests, sessions
  "Not found.": "未找到。",
  "No such endpoint.": "没有这个接口。",
  "Something went wrong on our side.": "服务器出了点问题。",
  "Sign in to continue.": "请先登录。",
  "Send JSON (content-type: application/json).": "请以 JSON 格式发送（content-type: application/json）。",
  "Send a JSON object.": "请发送一个 JSON 对象。",
  "That request is too large.": "请求内容太大。",
  "Cross-site requests aren't allowed.": "不允许跨站请求。",
  "Too many requests. Wait a moment and try again.": "请求太频繁，请稍等片刻再试。",
  "Too many attempts. Try again in a few minutes.": "尝试次数过多，请几分钟后再试。",
  "Invalid session token.": "会话令牌无效。",
  "Nothing to change.": "没有需要修改的内容。",
  "Language must be en or zh.": "语言只能是 en 或 zh。",

  // --- accounts and profile
  "Wrong username or password.": "用户名或密码错误。",
  "Passwords need at least 8 characters.": "密码至少需要 8 个字符。",
  "Usernames use letters, numbers, dots, dashes and underscores.": "用户名只能包含字母、数字、点、连字符和下划线。",
  "That username is already taken.": "该用户名已被占用。",
  "That display name is already taken.": "该昵称已被占用。",
  "Display name is required.": "请填写昵称。",
  "Display name must be 1–40 characters.": "昵称须为 1–40 个字符。",
  "Display names can't contain control or invisible characters.": "昵称不能包含控制字符或不可见字符。",
  "Bio must be text.": "简介必须是文本。",
  "Bio must be 280 characters or fewer.": "简介不能超过 280 个字符。",
  "Bio can't contain control or invisible characters.": "简介不能包含控制字符或不可见字符。",
  "That account doesn't exist.": "该账户不存在。",
  "Enter a nickname of 1–40 characters.": "请输入 1–40 个字符的昵称。",
  "Type at least two characters.": "请至少输入两个字符。",
  "Search for at least two characters.": "请至少输入两个字符再搜索。",

  // --- permissions
  "Trip not found.": "未找到该行程。",
  "You don't have permission to do that.": "你没有执行此操作的权限。",
  "Only the trip's owner can delete it.": "只有行程所有者可以删除行程。",
  "Only the trip's owner can change the trip's name, dates or settings.": "只有行程所有者可以修改行程名称、日期或设置。",
  "Only the trip's owner can invite people.": "只有行程所有者可以邀请他人。",
  "Only the trip's owner can approve or reject requests to join.": "只有行程所有者可以批准或拒绝加入申请。",
  "Only the trip's owner can remove people.": "只有行程所有者可以移除成员。",
  "Only the trip's owner can publish it.": "只有行程所有者可以发布行程。",
  "Only the trip's owner can change or remove stops other people added.": "只有行程所有者可以修改或删除其他人添加的站点。",
  "Only the trip's owner can change the starting point.": "只有行程所有者可以更改出发点。",
  "Only the trip's owner can choose how to travel between stops.": "只有行程所有者可以选择站点之间的交通方式。",
  "Only the trip's owner can apply schedule fixes.": "只有行程所有者可以应用日程调整。",

  // --- trips, days, dates
  "Choose a start date (YYYY-MM-DD).": "请选择开始日期（YYYY-MM-DD）。",
  "Dates must be real dates (YYYY-MM-DD).": "日期必须是有效日期（YYYY-MM-DD）。",
  "The trip can't end before it starts.": "行程的结束日期不能早于开始日期。",
  "Trips can be up to 30 days long.": "行程最长 30 天。",
  "Choose a time zone.": "请选择时区。",
  "That time zone isn't recognised.": "无法识别该时区。",
  "That day isn't part of this trip.": "这一天不在本行程中。",
  "This trip has no days to start on.": "这个行程还没有可以出发的日期。",
  "Meal times must list every meal.": "用餐时间必须包含每一餐。",

  // --- stops and activities
  "Duration must be between 5 minutes and 24 hours.": "时长必须在 5 分钟到 24 小时之间。",
  "Start time must be between 00:00 and 23:59.": "开始时间必须在 00:00 到 23:59 之间。",
  "Meal must be one of: breakfast, brunch, lunch, afternoon_tea, dinner.": "餐次只能是 breakfast、brunch、lunch、afternoon_tea、dinner 之一。",
  "Activity type must be one of: attraction, food, shopping, accommodation, custom.": "活动类型只能是 attraction、food、shopping、accommodation、custom 之一。",
  "Invalid place.": "地点无效。",
  "Invalid place coordinates.": "地点坐标无效。",
  "That isn't a place id.": "这不是有效的地点 ID。",
  "Coordinates must be a latitude between -90 and 90 and a longitude between -180 and 180.": "坐标的纬度须在 -90 到 90 之间，经度须在 -180 到 180 之间。",
  "That activity no longer exists. Someone may have removed it.": "该站点已不存在，可能已被其他人删除。",
  "Someone else changed this activity while you were editing.": "你编辑期间，其他人修改了这个站点。",
  "Someone else changed this stop while you were choosing a new place.": "你选择新地点期间，其他人修改了这个站点。",
  "Say where to move it (index).": "请指明要移动到的位置（index）。",
  "Use 'Change start' for the starting point.": "出发点请使用“更改出发点”。",
  "The starting point stays first. Change it instead of moving it.": "出发点始终排在第一位。请更改它，而不是移动它。",
  "This stop has a time, so its place in the day follows its time. Change its time to move it.": "这个站点已设定时间，它在当天的位置由时间决定。要移动它，请修改时间。",
  "Choose the new place.": "请选择新地点。",
  "Choose where the trip starts.": "请选择行程的出发点。",
  "Someone else changed the starting point while you were choosing.": "你选择期间，其他人更改了出发点。",
  "Say which starting point you're changing: baseVersion is its version, or null if there's none yet.": "请指明要更改的出发点：baseVersion 为它的版本号，若还没有出发点则为 null。",

  // --- routes
  "Route calculation needs Google Maps configured on the server (GOOGLE_MAPS_SERVER_KEY). No route was estimated.": "计算路线需要服务器配置 Google Maps（GOOGLE_MAPS_SERVER_KEY）。没有估算任何路线。",
  "Both activities need a place to calculate a route.": "两个站点都需要有地点才能计算路线。",
  "Those activities aren't next to each other any more. The plan may have changed.": "这两个站点已不再相邻，行程可能已有变动。",
  "Only places verified with Google or picked on the map can be routed; demo and curated-only places can't.": "只有经 Google 验证或在地图上选取的地点才能计算路线；演示地点和仅精选行程中的地点不行。",
  "That route is no longer part of the plan.": "这段路线已不在行程中。",
  "There's no route for that mode.": "这种交通方式没有路线。",
  "Mode must be WALK, TRANSIT or DRIVE.": "交通方式只能是 WALK、TRANSIT 或 DRIVE。",
  "mode must be WALK, TRANSIT or DRIVE.": "mode 只能是 WALK、TRANSIT 或 DRIVE。",
  "departureTime must be an ISO date-time.": "departureTime 必须是 ISO 日期时间。",
  "The plan changed while the route was being calculated. Try again.": "计算路线期间行程有变动，请重试。",
  "Route lookup failed.": "路线查询失败。",
  "Google only provides transit schedules from 7 days ago to 100 days ahead, and this departure is outside that window.": "Google 只提供 7 天前到 100 天后的公共交通时刻，这次出发时间不在此范围内。",
  "Give the earlier stop a start time to look up transit departures.": "请为前一个站点设定开始时间，以便查询公共交通班次。",

  // --- Google
  "Google Maps isn't configured on this server (GOOGLE_MAPS_SERVER_KEY is missing).": "此服务器未配置 Google Maps（缺少 GOOGLE_MAPS_SERVER_KEY）。",
  "Google Maps took too long to answer. Try again.": "Google Maps 响应超时，请重试。",
  "Couldn't reach Google Maps. Check the connection and try again.": "无法连接 Google Maps，请检查网络后重试。",
  "Google rejected the server's Maps key. Check GOOGLE_MAPS_SERVER_KEY.": "Google 拒绝了服务器的 Maps 密钥，请检查 GOOGLE_MAPS_SERVER_KEY。",
  "Google Maps billing isn't enabled for this Google Cloud project.": "此 Google Cloud 项目尚未启用 Google Maps 结算。",
  "The server's Maps key has a website restriction, which blocks server requests. Give GOOGLE_MAPS_SERVER_KEY no application restriction, and keep website restrictions on the browser key.": "服务器的 Maps 密钥设置了网站限制，会拦截服务器请求。请取消 GOOGLE_MAPS_SERVER_KEY 的应用限制，网站限制只保留在浏览器密钥上。",
  "Google Maps usage limits have been reached. Try again later.": "已达到 Google Maps 用量上限，请稍后再试。",
  "Google Maps couldn't understand that request.": "Google Maps 无法理解这个请求。",
  "Google Maps couldn't complete this request. Try again in a moment.": "Google Maps 无法完成这个请求，请稍后再试。",
  "That isn't a photo reference.": "这不是有效的照片引用。",
  "Google returned no photo.": "Google 没有返回照片。",
  "Photos need Google Maps configured on the server.": "显示照片需要服务器配置 Google Maps。",
  "type must be one of: tourist_attraction, restaurant, cafe, museum, park, zoo, shopping_mall, lodging, store.": "type 只能是 tourist_attraction、restaurant、cafe、museum、park、zoo、shopping_mall、lodging、store 之一。",
  "Unnamed place": "未命名地点",
  "A Google user": "一位 Google 用户",
  "Unknown": "未知",
  "Your location": "你的位置",
  // place features (Google's yes/no attributes, labelled by Wayline)
  Breakfast: "早餐",
  Lunch: "午餐",
  Dinner: "晚餐",
  "Vegetarian options": "提供素食",
  Coffee: "咖啡",
  "Dine-in": "堂食",
  Takeaway: "外带",
  "Takes reservations": "可预订",
  "Outdoor seating": "户外座位",
  "Good for children": "适合儿童",
  "Good for groups": "适合团体",
  Free: "免费",

  // --- discovery, itineraries, publications, reviews
  "That itinerary doesn't exist.": "该行程模板不存在。",
  "Sign in to copy this itinerary into a trip.": "登录后即可将此行程复制到你的行程中。",
  "Sign in to use this template.": "登录后即可使用此模板。",
  "Choose a destination or at least one place.": "请选择一个目的地或至少一个地点。",
  "Choose at most eight places.": "最多选择 8 个地点。",
  "places must be a list.": "places 必须是列表。",
  "food must be a list.": "food 必须是列表。",
  "food must be some of: local, market, street, cafe, seafood.": "food 只能取 local、market、street、cafe、seafood 中的值。",
  "days must be 1, 2, 3 or 4.": "days 只能是 1、2、3 或 4。",
  "This trip isn't published.": "这个行程尚未发布。",
  "visibility must be listed or link.": "visibility 只能是 listed 或 link。",
  "Add at least one stop besides the starting point before publishing.": "发布前请在出发点之外至少添加一个站点。",
  "Sign in to review this trip.": "登录后即可评价这个行程。",
  "You can't review your own trip.": "你不能评价自己的行程。",
  "Rating must be a whole number from 1 to 5.": "评分必须是 1 到 5 的整数。",
  "That review doesn't exist.": "该评价不存在。",
  "You can only delete your own review.": "你只能删除自己的评价。",

  // --- members, invites, join requests
  "This invite link isn't valid. Ask the trip's owner for a new one.": "此邀请链接无效，请向行程所有者索取新链接。",
  "This invite link isn't valid any more. Ask the trip's owner for a new one.": "此邀请链接已失效，请向行程所有者索取新链接。",
  "This invite link has expired. Ask the trip's owner for a new one.": "此邀请链接已过期，请向行程所有者索取新链接。",
  "This link isn't valid any more.": "此链接已失效。",
  "You're already on this trip.": "你已经在这个行程中了。",
  "They're already on this trip.": "对方已经在这个行程中了。",
  "They've already been invited.": "已经邀请过对方了。",
  "That invitation doesn't exist.": "该邀请不存在。",
  "That invitation isn't pending any more.": "该邀请已不再处于待处理状态。",
  "This invitation has already been answered.": "这个邀请已经回复过了。",
  "The owner cancelled this invitation.": "所有者已取消这个邀请。",
  "That request doesn't exist.": "该申请不存在。",
  "That request was already decided.": "该申请已经处理过了。",
  "You can't decide your own request.": "你不能处理自己的申请。",
  "That person isn't on this trip.": "此人不在这个行程中。",
  "The owner can't be removed from their own trip.": "不能将所有者移出自己的行程。",

  // --- map views and voice calls
  "Open the trip first.": "请先打开这个行程。",
  "Invalid map view.": "地图视角无效。",
  "Missing tab id.": "缺少标签页 ID。",
  "That call has ended.": "通话已结束。",
  "Choose someone on this trip to call.": "请选择这个行程中的一位成员进行通话。",
  "You're already in a call (maybe in another tab).": "你已经在通话中（可能在另一个标签页）。",
  "They aren't on this trip right now.": "对方现在不在这个行程中。",
  "They're in another call.": "对方正在另一通通话中。",
  "Only the person being called can answer.": "只有被呼叫的人才能接听。",
  "This call was already answered.": "这通电话已经被接听了。",
  "There's no call to decline.": "没有可以拒绝的通话。",
  "This call is in another tab.": "这通电话在另一个标签页中。",
  "This call isn't connected in this tab.": "这通电话没有在当前标签页中接通。",
  "Too many call messages.": "通话消息太频繁。",
  "Invalid session description.": "会话描述无效。",
  "Invalid ICE candidate.": "ICE 候选无效。",
  "Invalid mute state.": "静音状态无效。",
  "Unknown call message.": "未知的通话消息。",
  Someone: "有人",

  // --- preferences
  "Allergies must be text.": "过敏信息必须是文本。",
  "Keep allergies under 200 characters.": "过敏信息请控制在 200 个字符以内。",
  "Allergies can't contain control characters.": "过敏信息不能包含控制字符。",
  "Longest walk must be 5–120 minutes, or none.": "最长步行时间须为 5–120 分钟，或不限。",
  "Leave at least one way of getting around.": "请至少保留一种交通方式。",
  "Food and allergies are personal; set them in your own preferences.": "饮食和过敏信息属于个人设置，请在你自己的偏好中设置。",
  "Set your travel preferences first.": "请先设置你的旅行偏好。",

  // --- AI copilot and planner
  "AI planning is temporarily unavailable because the usage limit has been reached. Everything else still works.": "AI 规划已达到用量上限，暂时不可用。其他功能照常可用。",
  "The AI is busy with other requests. Try again in a moment.": "AI 正在处理其他请求，请稍后再试。",
  "The AI copilot couldn't answer just now. The schedule check still works.": "AI 助手暂时无法回答。日程检查仍可正常使用。",
  "The AI copilot isn't available right now. The schedule check still works.": "AI 助手暂时不可用。日程检查仍可正常使用。",
  "The AI planner couldn't answer just now. The schedule check still works.": "AI 规划暂时无法回答。日程检查仍可正常使用。",
  "The AI planner isn't available right now. The schedule check still works.": "AI 规划暂时不可用。日程检查仍可正常使用。",
  "The AI service is busy. Try again in a minute.": "AI 服务繁忙，请一分钟后再试。",
  "The AI took too long to answer. Try again.": "AI 响应超时，请重试。",
  "Cancelled.": "已取消。",
  "The AI declined to answer that. Try rephrasing your question about this day.": "AI 拒绝回答这个问题。请换一种方式询问这一天的安排。",
  "The AI's answer couldn't be read. Try again.": "无法读取 AI 的回答，请重试。",
  "AI answers aren't available on this server. The schedule check works without it.": "此服务器未提供 AI 回答。日程检查无需 AI 也能使用。",
  "AI planning isn't available on this server. Planning by hand still works.": "此服务器未提供 AI 规划。你仍可手动规划。",
  "Keep the question under 500 characters.": "问题请控制在 500 个字符以内。",
  "Send the question as text.": "请以文本形式发送问题。",
  "AI planning works on days with up to 25 stops.": "AI 规划仅适用于不超过 25 个站点的日程。",
  "Add a stop or two first, so there's something to plan around.": "请先添加一两个站点，才有可以规划的内容。",
  "Place suggestions need Google Maps configured on the server.": "地点建议需要服务器配置 Google Maps。",
  "Nearby suggestions need Google Maps configured on the server.": "附近推荐需要服务器配置 Google Maps。",
  "This day has no places on the map yet, so there's nothing nearby to suggest.": "这一天在地图上还没有地点，所以没有可推荐的附近地点。",
  "Google found no new places near this day to suggest.": "Google 在这一天附近没有找到可推荐的新地点。",
  "This plan has expired. Make a new one.": "这个规划已过期，请重新生成。",
  "The day changed since this plan was made. Make a new plan for the updated day.": "生成规划后这一天有了变动，请为更新后的日程重新规划。",
  "The plan tried to move a stop with a set time. Make a new plan.": "该规划试图移动已设定时间的站点，请重新规划。",
  "A route in this plan isn't available any more. Make a new plan.": "该规划中的某段路线已不可用，请重新规划。",
  "A route in this plan is no longer part of the day. Make a new plan.": "该规划中的某段路线已不属于这一天，请重新规划。",
  "Choose at least one suggestion to apply.": "请至少选择一条建议来应用。",
  "That suggestion no longer applies. The plan has changed since it was made.": "这条建议已不适用，行程在它生成后有了变动。",
  "The plan changed since this suggestion was shown. Review the updated day before applying anything.": "这条建议显示后行程有了变动。请先查看更新后的日程再应用。",
  "The plan changed before the suggestion could be applied.": "建议应用之前，行程有了变动。",
  "Times you've already set stay as they are.": "你已设定的时间保持不变。",
  "Google can't confirm allergens or dietary suitability. Check with the restaurant before you go.": "Google 无法确认过敏原或是否符合饮食要求，前往前请向餐厅确认。",
  "Allergy and dietary information isn't verified by Google. Ask each restaurant directly.": "过敏和饮食信息未经 Google 核实，请直接向各餐厅确认。",
  "Google has no opening hours for this place. Check before you go.": "Google 没有这个地点的营业时间，前往前请先确认。",
  "Times allow the meal plus 30 minutes before closing. Closing time isn't a last-order time unless Google lists kitchen hours.": "安排的时间包含用餐时长，并在打烊前预留 30 分钟。除非 Google 列出后厨时间，否则打烊时间不等于最后点餐时间。",
  "Travel to and from each place is a straight-line walking estimate; calculate the route once it's in the plan.": "往返各地点的时间是按直线距离估算的步行时间；加入行程后请计算路线。",
  "Google found no restaurants near this part of the route.": "Google 在这段路线附近没有找到餐厅。",
  "Distances are straight-line estimates; calculate the route once it's in the plan.": "距离为直线估算；加入行程后请计算路线。",
  "Opening hours aren't checked here; open the place to see Google's hours.": "这里不检查营业时间；打开地点可查看 Google 提供的营业时间。",
  "Google found nothing new near your free time.": "Google 没有在你的空闲时段附近找到新地点。",
  "No meal looks missing on this day.": "这一天看起来不缺哪一餐。",
  "The stops around this meal have no places on the map.": "这一餐前后的站点在地图上没有地点。",
  "It's closed then.": "那时不营业。",
  "Google lists the kitchen as closed at that time.": "根据 Google，那时后厨不营业。",
  "Smallest detour": "绕路最少",
  "Highly rated": "评分很高",
  "Matches your cuisines": "符合你的口味",
  "Open then": "届时营业",
};

// --- helpers for the patterns (captured titles and names stay as they are)

// "1h 30m", "2h", "45 min" (minutesLabel in src/schedule.ts)
const DUR = "(\\d+h \\d+m|\\d+h|\\d+ min)";
const dur = (s) => {
  let m = /^(\d+)h (\d+)m$/.exec(s);
  if (m) return `${m[1]} 小时 ${m[2]} 分钟`;
  m = /^(\d+)h$/.exec(s);
  if (m) return `${m[1]} 小时`;
  m = /^(\d+) min$/.exec(s);
  return m ? `${m[1]} 分钟` : s;
};
const T = "(\\d{1,2}:\\d{2})";
const MODE = { walking: "步行", "public transport": "公共交通", driving: "驾车", walk: "步行", transit: "公共交通", drive: "驾车" };
const MODE_RE = "(walking|public transport|driving)";
const MEAL = {
  breakfast: "早餐",
  brunch: "早午餐",
  lunch: "午餐",
  "afternoon tea": "下午茶",
  afternoon_tea: "下午茶",
  dinner: "晚餐",
  Breakfast: "早餐",
  Brunch: "早午餐",
  Lunch: "午餐",
  "Afternoon tea": "下午茶",
  Dinner: "晚餐",
};
const MEAL_RE = "(breakfast|brunch|lunch|afternoon[ _]tea|dinner)";
const PACE = { relaxed: "轻松", balanced: "适中", intensive: "紧凑" };
const DIET = { vegetarian: "素食", vegan: "纯素", halal: "清真", kosher: "犹太洁食", "gluten free": "无麸质", "dairy free": "无乳制品" };
// field names passed to the server's validators
const FIELD = {
  Title: "标题",
  Notes: "备注",
  "Trip name": "行程名称",
  Destination: "目的地",
  Description: "简介",
  Review: "评价",
  Username: "用户名",
  "Place id": "地点 ID",
  origin: "起点",
  destination: "终点",
  Cuisines: "菜系",
  "Dietary needs": "饮食需求",
  "Restaurant price": "餐厅价位",
  Transport: "交通方式",
  "Modes to avoid": "避开的交通方式",
  Prefer: "偏好",
  Pace: "节奏",
  Interests: "兴趣",
  Budget: "预算",
  Meal: "餐次",
  Category: "类别",
  "Activity type": "活动类型",
};
// before Chinese text: an untranslated (ASCII) field name gets a space
const field = (f) => FIELD[f] ?? `${f} `;
const fieldAfter = (f) => FIELD[f] ?? ` ${f}`;
const list = (s) => s.split(", ").join("、");
const stop = (s) => (s === "a stop" ? "某个站点" : s);
// a part of a composite message, through the same dictionary
const part = (s) => {
  if (ZH[s] !== undefined) return ZH[s];
  for (const [re, zh] of PATTERNS) {
    const m = re.exec(s);
    if (m) return typeof zh === "function" ? zh(...m.slice(1)) : zh.replace(/\$(\d)/g, (_, i) => m[Number(i)] ?? "");
  }
  return s;
};
const HOURS_RE = "((?:It's closed|It opens|It closes|Google lists the kitchen).*?)";

export const PATTERNS = [
  // --- schedule issues and fixes (src/schedule.ts)
  [new RegExp(`^(.+) runs past midnight \\(until ${T} the next day\\)\\.$`), "$1 会持续到午夜之后（次日 $2 结束）。"],
  [
    new RegExp(`^There (?:is|are) ${DUR} between (.+) \\(ends ${T}\\) and (.+) \\(starts ${T}\\), but ${MODE_RE} takes ${DUR}\\. That's ${DUR} short\\.$`),
    (gap, a, t1, b, t2, mode, travel, short) => `${a}（${t1} 结束）和 ${b}（${t2} 开始）之间只有 ${dur(gap)}，但${MODE[mode]}需要 ${dur(travel)}，还差 ${dur(short)}。`,
  ],
  [
    new RegExp(`^(.+) ends at ${T}, ${DUR} after (.+) starts at ${T}\\.$`),
    (a, t1, over, b, t2) => `${a} 在 ${t1} 结束，比 ${b} 的开始时间 ${t2} 晚了 ${dur(over)}。`,
  ],
  [new RegExp(`^Switch to ${MODE_RE} \\(${DUR}\\), which fits the ${DUR} gap$`), (mode, t, gap) => `改为${MODE[mode]}（${dur(t)}），能放进 ${dur(gap)}的空档`],
  [new RegExp(`^Start (.+) at ${T} instead of ${T}$`), "把 $1 的开始时间从 $3 改为 $2"],
  [new RegExp(`^Push (.+) and the (\\d+) stops? after it ${DUR} later$`), (a, n, d) => `把 ${a} 及其后的 ${n} 个站点推迟 ${dur(d)}`],
  [new RegExp(`^Shorten (.+) to ${DUR} \\(from ${DUR}\\)$`), (a, to, from) => `把 ${a} 缩短为 ${dur(to)}（原为 ${dur(from)}）`],

  // --- day review notes (src/review.ts)
  [/^(Breakfast|Brunch|Lunch|Afternoon tea|Dinner) may be missing$/, (m) => `可能缺少${MEAL[m]}`],
  [/^(Breakfast|Brunch|Lunch|Afternoon tea|Dinner) before setting out may be missing$/, (m) => `出发前可能还没安排${MEAL[m]}`],
  [/^(Breakfast|Brunch|Lunch|Afternoon tea|Dinner) after (.+) may be missing$/, (m, a) => `${stop(a)} 之后可能还没安排${MEAL[m]}`],
  [/^(\d+) min walk from (.+?) to (.+)$/, (n, a, b) => `从 ${stop(a)} 到 ${stop(b)} 需步行 ${n} 分钟`],
  [/^No route found from (.+?) to (.+)$/, (a, b) => `没有找到从 ${stop(a)} 到 ${stop(b)} 的路线`],
  [new RegExp(`^(\\d+) h (?:(\\d+) min )?free after (.+) \\(${T}–${T}\\)$`), (h, m, a, t1, t2) => `${a} 之后有 ${h} 小时${m ? ` ${m} 分钟` : ""}空闲（${t1}–${t2}）`],
  [/^A full day: (\d+) stops and (\d+) h of visits$/, "行程很满：$1 个站点，约 $2 小时的游览"],
  [/^(\d+) stops? (?:has|have) no time yet$/, "$1 个站点还没有设定时间"],

  // --- planner notes, warnings and caveats (src/planner.ts, src/planning.ts)
  // a note followed by the diet warning, joined with a space
  [
    /^(.+?) (Google can't confirm allergens or dietary suitability\. Check with the restaurant before you go\.)$/,
    (a, b) => `${part(a)}${part(b)}`,
  ],
  [
    /^Never (.+) between stops\.$/,
    (modes) => `站点之间不要${modes.split(" or ").map((m) => ({ walk: "步行", "take public transport": "乘坐公共交通", drive: "驾车" })[m] ?? m).join("或")}。`,
  ],
  [/^Allergies \((.*)\): every food suggestion says to check with the restaurant\.$/, "过敏（$1）：每条餐饮建议都会提醒你向餐厅确认。"],
  [
    /^Dietary needs \((.+)\): every food suggestion says to check with the restaurant\.$/,
    (d) => `饮食需求（${d.split(", ").map((x) => DIET[x] ?? x).join("、")}）：每条餐饮建议都会提醒你向餐厅确认。`,
  ],
  [
    new RegExp(`^Google found no ${MODE_RE} route from (.+?) to (.+?)(?:, so this plan uses ${MODE_RE} there)?\\.$`),
    (want, a, b, to) => `Google 没有找到从 ${stop(a)} 到 ${stop(b)} 的${MODE[want]}路线${to ? `，因此这段改用${MODE[to]}` : ""}。`,
  ],
  [
    new RegExp(`^(.+) was left out: it isn't open long enough for ${MEAL_RE} at a time that fits your day\\.$`),
    (a, m) => `已略过 ${a}：在适合你日程的时间里，它的营业时间不够吃${MEAL[m]}。`,
  ],
  [new RegExp(`^(.+?) was left out: ${HOURS_RE}$`), (a, why) => `已略过 ${a}：${part(why)}`],
  [/^(\d+) nearby places? (?:was|were) left out: closed, or not open long enough for the meal, at the times that fit your day\.$/, "有 $1 个附近地点被略过：在适合你日程的时间里，它们不营业或营业时间不够用餐。"],
  [
    new RegExp(`^There's only (-?\\d+) min between (.+?) and (.+), not enough for a (\\d+)-minute ${MEAL_RE} and the walk there\\. Move a stop or shorten one to make room\\.$`),
    (n, a, b, d, m) => `${a} 和 ${b} 之间只有 ${n} 分钟，不够安排 ${d} 分钟的${MEAL[m]}和步行往返。请移动或缩短某个站点来腾出时间。`,
  ],
  [
    new RegExp(`^None of the nearby restaurants is open long enough for ${MEAL_RE} in the time your day leaves \\(${T}–${T}\\)\\. Try another meal time, or move a stop to make room\\.$`),
    (m, t1, t2) => `在你日程留出的时间（${t1}–${t2}）里，附近没有餐厅的营业时间足够吃${MEAL[m]}。请换个用餐时间，或移动某个站点腾出时间。`,
  ],
  [/^No free time of (\d+) min or more between timed stops for a (relaxed|balanced|intensive) pace\.$/, (n, p) => `按${PACE[p]}的节奏，已定时的站点之间没有 ${n} 分钟以上的空闲时间。`],
  [/^Calculated (\d+) travel times? with Google Maps\.$/, "已用 Google Maps 计算了 $1 段交通时间。"],
  [/^(\d+) travel times? couldn't be calculated\.$/, "有 $1 段交通时间无法计算。"],
  [
    new RegExp(`^Usual hours(?: \\(closes ${T}\\))?; Google hasn't confirmed them for this date\\.( It's a special day for this place\\.)?$`),
    (closes, special) => `通常营业时间${closes ? `（${closes} 打烊）` : ""}；Google 尚未确认这一天的营业时间。${special ? "这一天是该地点的特殊日期。" : ""}`,
  ],
  [new RegExp(`^Open that day until ${T}\\.$`), "当天营业到 $1。"],
  [new RegExp(`^Fits ${T}–${T}$`), "适合 $1–$2"],

  // --- opening hours (src/hours.ts), alone or after a place name when applying
  [new RegExp(`^It's closed between ${T} and ${T}\\.$`), "它在 $1 到 $2 之间不营业。"],
  [new RegExp(`^It opens at ${T}\\.$`), "它 $1 才开门。"],
  [
    new RegExp(`^It closes at ${T}\\. A (\\d+)-minute meal from ${T} would finish (after closing|less than (\\d+) minutes before closing)\\.$`),
    (closes, d, from, when, buffer) => `它 ${closes} 打烊。从 ${from} 开始的 ${d} 分钟用餐会${when === "after closing" ? "在打烊后才结束" : `在打烊前不到 ${buffer} 分钟才结束`}。`,
  ],
  [
    new RegExp(`^(.+?): ${HOURS_RE}(?: The latest start that fits is ${T}\\.)?$`),
    (name, why, latest) => `${name}：${part(why)}${latest ? `最晚可在 ${latest} 开始。` : ""}`,
  ],

  // --- Google (src/google.ts)
  [/^The (Routes API|Geocoding API|Places API \(New\)) isn't enabled for this Google Cloud project yet\.$/, "此 Google Cloud 项目尚未启用 $1。"],
  [/^The server key's restrictions don't allow the (.+)\. Check its API restrictions\.$/, "服务器密钥的限制不允许使用 $1，请检查它的 API 限制。"],
  [/^Google found no (walk|transit|drive) route between these places\.$/, (m) => `Google 没有找到这两个地点之间的${MODE[m]}路线。`],

  // --- validation with field names and values
  [/^(breakfast|brunch|lunch|afternoon tea|dinner): the usual time must sit inside its range\.$/, (m) => `${MEAL[m]}：常用时间必须在其时间范围之内。`],
  [/^(\d{4}-\d{2}-\d{2}) still has activities\. Move or remove them before taking that day out of the trip\.$/, "$1 还有站点。把这一天移出行程前，请先移动或删除这些站点。"],
  [/^That request was already (approved|rejected)\.$/, (s) => `该申请已经被${s === "approved" ? "批准" : "拒绝"}了。`],
  [/^places\[(\d+)\]: that isn't a place id\.$/, "places[$1]：不是有效的地点 ID。"],
  [/^(.+): that isn't a Google place id\.$/, (f) => `${field(f)}：不是有效的 Google 地点 ID。`],
  [/^(.+) must be (\d+)–(\d+) characters\.$/, (f, a, b) => `${field(f)}须为 ${a}–${b} 个字符。`],
  [/^(.+) is too long \(max (\d+) characters\)\.$/, (f, n) => `${field(f)}太长了（最多 ${n} 个字符）。`],
  [/^(.+) must be between (-?[\d.]+) and (-?[\d.]+)\.$/, (f, a, b) => `${field(f)}必须在 ${a} 到 ${b} 之间。`],
  [/^(.+) must be one of: (.+)\.$/, (f, vals) => `${field(f)}只能是 ${list(vals)} 之一。`],
  [/^(.+) must be a list\.$/, (f) => `${field(f)}必须是列表。`],
  [/^(.+) must be text\.$/, (f) => `${field(f)}必须是文本。`],
  [/^(.+) is required\.$/, (f) => `请填写${fieldAfter(f)}。`],

  // --- labels
  [/^Near (.+)$/, "$1 附近"],
];
