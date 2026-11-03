export const TRAVEL_LEG = /(线|新干线|Line|Shinkansen|Skyliner|Haruka|→)/;

// No tool gives transit facts yet, so the japan-travel skill gives each travel leg its mode only.
const DAY_HEADING = /^[#*\s]*(?:Day\s*\d+|第\s*\d+\s*天|D\d+\b)/im;
// Hotel lines are graded elsewhere and hotel names often contain rail brands ("Sotetsu Fresa Inn", "JR Kyushu Hotel").
const HOTEL_LINE = /^(?:Tonight|Overnight|Stay at|今晚|住宿)/i;
const TIME_PREFIX = /^(?:约\s*|approx\.?\s*|~\s*)?\d{1,2}[:：]\d{2}(?:\s*[-–~～至]\s*\d{1,2}[:：]\d{2})?\s*/i;
// The first colon that is not part of a time ends the stop and starts its description.
const DESCRIPTION_COLON = /(?<!\d)[:：]|[:：](?!\d)/;
const RIDE = /→|->|\b(?:trains?|subway|metro|bus(?:es)?|taxis?|cab|shinkansen|bullet train|ferry|tram|monorail|cable car|ropeway)\b|电车|列车|火车|地铁|巴士|公交|大巴|出租车|打车|的士|新干线|轻轨|缆车|渡轮|轮渡|单轨/i;
const MODE = new RegExp(`${RIDE.source}|\\b(?:walk(?:s|ing)?|on foot)\\b|步行|徒步|走路`, 'i');
// A ride from one place to another, so hours beside it are the ride's: "Kyoto → Nara by train, approx. 1 h", "Shinkansen, approx. 2.5 h".
const JOURNEY = /→|->|\bshinkansen\b|bullet train|新干线|\b(?:trains?|subway|metro|bus(?:es)?|ferry|taxi)\s+(?:to|back)\b|(?:电车|列车|火车|地铁|巴士|大巴|渡轮)(?:去|到|前往|返回|回)/i;
const MINUTES = /\d+(?:\.\d+)?(?:\s*[-–~～至到]\s*\d+)?[\s-]*(?:min(?:ute)?s?\b|分钟|分鐘)/i;
const HOURS = /\d+(?:\.\d+)?(?:\s*[-–~～至到]\s*\d+(?:\.\d+)?)?[\s-]*(?:h\b|hrs?\b|hours?\b|小时|小時)|半小时|half an hour/i;
// Time to leave for airport check-in is advice, not a travel time.
const BUFFER = /登机|值机|安检|起飞前|提前|boarding|before (?:your |the )?(?:flight|departure)|in advance|预留|留出|\bleave (?:plenty|enough|at least|approx)|\ballow\b/i;
// "（具体线路与换乘请查时刻表）" asks the traveller to look the details up.
const REMINDER = /请(?:查|核对|确认|自行)|please (?:check|confirm)|check (?:the )?(?:timetable|train times|routes?)/i;
const CLAUSE = /[,;，；。—]|\s[–-]\s/;
const OPERATORS = 'Kintetsu|Keihan|Hankyu|Hanshin|Nankai|Keisei|Keikyu|Odakyu|Tobu|Seibu|Toei|Keio|Tokyu|Sotetsu';
const OPERATORS_ZH = '近铁|近鉄|京阪|阪急|阪神|南海|京成|京急|小田急|东武|東武|西武|都营|都営|京王|东急|東急|相铁|叡山|岚电|嵐電';
const LEG_DETAILS = [
  /\b[A-Z][\w'-]*\s+[Ll]ine\b/,
  /\b(?:Skyliner|Haruka|rapi:t|Nozomi|Hikari|Kodama|Mizuho|Narita Express|N'EX|Romancecar|Limited Express|Special Rapid|Airport Limousine|Tokyo Metro|Osaka Metro|Randen|Eizan)\b/i,
  /\bJR\b(?![\s-]*(?:Pass|Kyushu|East|West|Central|Inn|Hotel|周游券|通票|九州))/,
  // "山手线", "御堂筋线", "2 号线"; not 新干线 (a mode), 路线, 天际线, 海岸线 and similar words.
  /(?![路沿动视光航界直曲干际电毛底红岸平一前防热连主铁行通览条间])\p{Script=Han}[线線](?!路)/u,
  // Operators only as transport; "阪急百货" and "Kintetsu-Nara Station" are places.
  new RegExp(`\\b(?:${OPERATORS})[\\s-]+(?:Railway|Electric|trains?|Rapid|Express|Limited|to|from)\\b|\\b(?:take|taking|by|via|on|ride)\\s+(?:the\\s+)?(?:${OPERATORS})\\b`, 'i'),
  new RegExp(`(?:乘|坐|搭)(?:坐|乘)?\\s*(?:${OPERATORS_ZH})|(?:${OPERATORS_ZH})(?:电铁|电车|铁道|特急|快速|急行|列车|到|至|前往)`),
  /\b(?:\d+|one|two|three|four|five|a few)\s+stops?\b/i,
  /(?<![第下每上])[\d一两二三四五六七八九十]+\s*站(?![台点式])/,
  /\b(?:\d+|one|two|no|zero|a)\s+transfers?\b|\btransfer (?:at|onto)\b|\bwithout (?:a )?transfer|\bno change\b|\bchange (?:trains|lines)\b/i,
  /换乘|转乘|转车|直达/,
];

/** Day-section lines that give a travel leg more than its mode: a line, train or operator, stops, transfers or a travel time. */
export function legDetails(draft: string): string[] {
  const start = draft.search(DAY_HEADING);
  if (start < 0) return [];
  const clauses = (text: string) => text.split(CLAUSE).filter((clause) => !BUFFER.test(clause));
  return draft.slice(start).split('\n').map((raw) => raw.replace(/[*_`]/g, '').replace(/^\s*[-•]\s*/, '').trim()).filter((line) => {
    if (HOTEL_LINE.test(line)) return false;
    const told = line.replace(/[(（][^)）]*[)）]/g, (group) => REMINDER.test(group) ? '' : group).split(CLAUSE).filter((clause) => !REMINDER.test(clause)).join(',');
    if (LEG_DETAILS.some((detail) => detail.test(told))) return true;
    const rest = line.replace(TIME_PREFIX, '');
    // Minutes in the same clause as a mode are a travel time anywhere: "walk approx. 10 min", "地铁约 15 分钟".
    if (clauses(rest).some((clause) => MODE.test(clause) && MINUTES.test(clause))) return true;
    // Before the description, minutes anywhere next to a mode are a travel time, and so are hours beside a journey.
    // Other hours are time at the place: "Osaka Castle by subway (approx. 1.5 h)", "Kiyomizu-dera, approx. 1.5 h; taxi drop-off".
    const head = clauses(rest.split(DESCRIPTION_COLON)[0]);
    const unbracketed = (clause = '') => clause.replace(/[(（][^)）]*[)）]/g, '');
    return MODE.test(head.join()) && head.some((clause) => MINUTES.test(clause))
      || head.some((clause, i) => HOURS.test(clause) && (JOURNEY.test(clause) || JOURNEY.test(unbracketed(head[i - 1]))));
  });
}
