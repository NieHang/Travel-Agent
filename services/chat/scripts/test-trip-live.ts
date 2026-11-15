// Live check of the trip prompts against the configured model and MCP servers.
// Usage: bun run scripts/test-trip-live.ts (PRINT_DRAFT=1 also prints the Tokyo→Osaka drafts)
import 'dotenv/config';
import { AIMessage, HumanMessage, type BaseMessage } from '@langchain/core/messages';
import { hasOsakaStay } from '../evals/evaluators/itinerary.js';
import { legDetails, TRAVEL_LEG } from '../evals/travel-leg.js';
import { McpService } from '../src/llm/mcp/mcp.service.js';
import { ModelTripLlm } from '../src/trip/llm.js';
import { loadSkills } from '../src/skills/registry.js';
import { turn as runTurn } from '../evals/turn.js';
import { initialState, type Locale, type TripState } from '../src/trip/state.js';

const mcp = new McpService();
await mcp.mcpManager.start();
const llm = new ModelTripLlm(mcp, loadSkills());
let failures = 0;
const check = (label: string, ok: boolean) => {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${label}`);
  if (!ok) failures++;
};

const turn = (state: TripState, text: string) => runTurn(llm, state, text);
type Turn = Awaited<ReturnType<typeof turn>>;

/** Hotel names in the draft: zh writes name（nameEn）, en writes nameEn and never the provider's Chinese name. */
function checkHotelNames(label: string, locale: Locale, { draft, toolResults }: Turn) {
  const hotels = toolResults.flatMap((r) => {
    try {
      return (JSON.parse(r.content) as { hotels?: { name: string; nameEn: string | null }[] }).hotels ?? [];
    } catch {
      return [];
    }
  });
  const bad = locale === 'zh'
    ? hotels.filter((h) => h.nameEn && draft.includes(h.name) && !draft.includes(`${h.name}（${h.nameEn}）`)).map((h) => h.name)
    : hotels.filter((h) => draft.includes(h.name)).map((h) => h.name);
  const named = hotels.some((h) => draft.includes(locale === 'zh' ? h.name : h.nameEn ?? h.name));
  check(`${label} names hotels as ${locale === 'zh' ? 'name（nameEn）' : 'nameEn'}`, named && bad.length === 0);
  if (bad.length || !named) console.log(`  hotels named wrongly: ${JSON.stringify(bad)}, any named: ${named}`);
}

// Narration before a tool call ("...search hotels.# Trip") must not reach the draft.
function checkNoNarration(label: string, draft: string) {
  // [^\s#], not \S: the first "#" of "## 总览" is itself non-space, so \S flagged every level-2 heading.
  const at = draft.search(/[^\s#]#{1,3} \S/);
  check(`${label} has no narration glued to a heading`, at < 0);
  if (at >= 0) console.log(`  glued: ${JSON.stringify(draft.slice(Math.max(0, at - 160), at + 40))}`);
}

// lowestPrice is per night; the model once called it the price of the whole stay ("单人两晚约1730元起").
function checkNightlyPrices(label: string, locale: Locale, { draft, toolResults, next }: Turn) {
  const amounts = toolResults.flatMap((r) => {
    try {
      return ((JSON.parse(r.content) as { hotels?: { lowestPrice: string | null }[] }).hotels ?? []).flatMap((h) => h.lowestPrice?.split(' ')[0] ?? []);
    } catch {
      return [];
    }
  });
  const patterns = amounts.map(amountPattern);
  const summaries = [...(next.stays?.items ?? []), ...next.results.flatMap((g) => g.items)].flatMap((item) => item.summary ?? []);
  const priced = [...draft.split('\n'), ...summaries].filter((text) => patterns.some((p) => p.test(text)));
  const nightly = locale === 'zh' ? /每晚|[/／]\s*晚|一晚/ : /per night|a night\b|nightly|\/\s*night\b/i;
  const bad = priced.filter((text) => !nightly.test(text));
  check(`${label} marks hotel prices as nightly (${priced.length} priced)`, bad.length === 0);
  if (bad.length) console.log(`  prices without a nightly unit: ${JSON.stringify(bad)}`);
}

/** An amount as prose writes it, with or without thousands separators: "1730" also matches "1,730". */
function amountPattern(amount: string): RegExp {
  const [whole, fraction] = amount.split('.');
  const grouped = whole.replace(/\B(?=(\d{3})+$)/g, ',?');
  return new RegExp(`(?<![\\d.,])${grouped}${fraction ? `\\.${fraction}` : ''}(?![\\d]|[.,]\\d)`);
}

for (const locale of ['zh', 'en'] as Locale[]) {
  const start = initialState(0, locale);
  const zh = locale === 'zh';

  const refused = await turn(start, zh ? '成都三天美食之旅，2026-11-27 到 2026-11-29，2 个人，朋友' : 'Plan a family trip to Lisbon, 2027-01-04 to 2027-01-09, 3 people');
  check(`${locale}: non-Japan trip is refused`, refused.effect === null && refused.next.requirements.destination === undefined);
  check(`${locale}: refusal names the city`, (refused.next.outsideJapan?.places ?? []).some((name) => name.toLowerCase().includes(zh ? '成都' : 'lisbon')));
  check(`${locale}: refused trip calls no tools`, refused.calls.length === 0);

  const mixed = await turn(start, zh ? '先去首尔再去福冈，2026-12-01 到 2026-12-06，情侣 2 个人' : 'Seoul then Fukuoka, 2026-12-01 to 2026-12-06, 2 people, couple');
  check(`${locale}: mixed trip is refused`, mixed.effect === null && mixed.next.requirements.destination === undefined);
  check(`${locale}: mixed refusal names the outside city`, (mixed.next.outsideJapan?.places ?? []).some((name) => name.toLowerCase().includes(zh ? '首尔' : 'seoul')));
  check(`${locale}: mixed trip offers the Japan part`, (mixed.next.outsideJapan?.japan ?? '').toLowerCase().includes(zh ? '福冈' : 'fukuoka'));

  const outsideHotel = await turn(start, zh ? '巴黎 1000 元以内的酒店' : 'Hotels in Paris under 1000 CNY');
  check(`${locale}: outside-Japan hotel question is chat`, outsideHotel.classified.intent === 'chat');
  check(`${locale}: outside-Japan hotel question calls no tools`, outsideHotel.calls.length === 0);

  const overnight = await turn(start, zh ? '帮我规划大阪亲子游，2026-12-01 到 2026-12-03，4 个人' : 'Plan a family trip to Osaka, 2026-12-01 to 2026-12-03, 4 people');
  check(`${locale}: one-shot planning reaches review`, overnight.next.stage === 'review' && overnight.effect === 'itinerary');
  check(`${locale}: Japan destination was checked`, overnight.next.checkedDestination !== null);
  check(`${locale}: overnight trip found stays`, (overnight.next.stays?.items.length ?? 0) > 0);
  check(`${locale}: overnight trip found Osaka stays`, hasOsakaStay(overnight.next));
  if (!overnight.next.stays) console.log(`  tool calls: ${JSON.stringify(overnight.calls)}`);
  check(`${locale}: stays carry amenities or images`, (overnight.next.stays?.items ?? []).some((h) => h.amenities.length > 0 || h.image));
  check(`${locale}: at least one day links to a stay`, overnight.next.days.some((d) => d.stayRef));
  checkHotelNames(`${locale}: overnight draft`, locale, overnight);
  checkNoNarration(`${locale}: overnight draft`, overnight.draft);
  checkNightlyPrices(`${locale}: overnight draft`, locale, overnight);

  const dayTrip = await turn(start, zh ? '奈良一日游，2026-12-01 当天往返，1 个人，个人游' : 'Solo day trip to Nara on 2026-12-01, back the same day, 1 person');
  check(`${locale}: same-day trip has no stays`, !dayTrip.next.stays);

  const search = await turn(start, zh ? '京都站附近 1000 元以内的酒店' : 'Hotels near Kyoto Station under 1000 CNY');
  check(`${locale}: hotel question is chat`, search.classified.intent === 'chat');
  check(`${locale}: hotel question shows cards`, search.next.results.some((g) => g.items.length > 0));
  checkNightlyPrices(`${locale}: hotel answer`, locale, search);

  const vague = await turn(start, zh ? '12 月想去个暖和的地方，两个人' : 'Somewhere warm in December for two');
  check(`${locale}: vague destination asks to clarify`, vague.next.clarify?.field === 'destination');

  const japan = await turn(
    start,
    zh
      ? '帮我规划日本情侣游，东京进大阪出，2026-12-01 到 2026-12-06，2 个人'
      : "Plan a couple's trip to Japan, fly into Tokyo and out of Osaka, 2026-12-01 to 2026-12-06, 2 people",
  );
  check(`${locale}: japan trip reaches review`, japan.next.stage === 'review' && japan.effect === 'itinerary');
  check(`${locale}: japan trip loads the city skills`, ['japan-tokyo', 'japan-osaka'].every((n) => japan.loaded.includes(n)));
  check(`${locale}: japan trip still finds stays`, (japan.next.stays?.items.length ?? 0) > 0);
  check(`${locale}: japan trip finds Osaka stays`, hasOsakaStay(japan.next));
  checkHotelNames(`${locale}: japan draft`, locale, japan);
  checkNoNarration(`${locale}: japan draft`, japan.draft);
  checkNightlyPrices(`${locale}: japan draft`, locale, japan);
  const headings = zh ? ['总览', '出发前要办'] : ['Overview', 'Before you go'];
  check(`${locale}: japan draft has overview and before-you-go`, headings.every((h) => japan.draft.includes(h)));
  const legDetail = legDetails(japan.draft);
  check(`${locale}: japan draft legs give the mode only`, legDetail.length === 0);
  if (legDetail.length) console.log(`  legs with details: ${JSON.stringify(legDetail)}`);
  check(`${locale}: japan draft covers every day`, japan.next.days.length >= 6);
  const legStops = japan.next.days.flatMap((d) => d.stops.map((s) => s.name)).filter((name) => TRAVEL_LEG.test(name));
  check(`${locale}: travel legs are not stops`, legStops.length === 0);
  if (legStops.length) console.log(`  leg stops: ${JSON.stringify(legStops)}`);
  // Full days (all but the first and last block) each need a rainy-day / drop-if-tired line.
  const dayBlocks = japan.draft.split(/^(?=[#*\s]*(?:Day\s*\d+|第\s*\d+\s*天|D\d+\b))/im).filter((b) => /^[#*\s]*(?:Day\s*\d+|第\s*\d+\s*天|D\d+\b)/i.test(b));
  const missingAlt = dayBlocks.slice(1, -1).filter((b) => !/备选|Alternative/i.test(b)).map((b) => b.split('\n')[0].trim());
  check(`${locale}: every full day has an alternatives line`, dayBlocks.length >= 6 && missingAlt.length === 0);
  if (missingAlt.length || dayBlocks.length < 6) console.log(`  day blocks ${dayBlocks.length}, missing alternatives: ${JSON.stringify(missingAlt)}`);
  // 5 nights is not a short trip: every city gets at least 2 nights.
  const overview = japan.draft.slice(0, japan.draft.search(zh ? /出发前要办/ : /Before you go/i));
  const nights = [...overview.matchAll(zh ? /(\d+)\s*晚/g : /(\d+)\s*nights?\b/gi)].map((m) => Number(m[1]));
  check(`${locale}: no city gets a single night`, nights.length >= 2 && nights.every((n) => n >= 2));
  if (!(nights.length >= 2 && nights.every((n) => n >= 2))) console.log(`  overview nights: ${JSON.stringify(nights)}`);
  if (process.env.PRINT_DRAFT) console.log(japan.draft);
  console.log(`${locale}: loaded ${JSON.stringify(japan.loaded)}, days ${japan.next.days.length}, draft ${japan.draft.length} chars, tool calls ${JSON.stringify(japan.calls)}`);
}

// Multi-turn: edits change only the part they name.
for (const locale of ['en', 'zh'] as Locale[]) {
  const zh = locale === 'zh';
  const history: BaseMessage[] = [];
  const say = async (state: TripState, text: string) => {
    const out = await runTurn(llm, state, text, { history: [...history] });
    history.push(new HumanMessage(text), new AIMessage(out.reply ?? ''));
    return out;
  };
  const draft = await say(initialState(0, locale), zh ? '帮我规划京都情侣游，2026-11-22 到 2026-11-25，2 个人' : "Plan a couple's trip to Kyoto, 2026-11-22 to 2026-11-25, 2 people");
  check(`${locale}: kyoto draft reaches review`, draft.effect === 'itinerary' && draft.next.days.length >= 4);
  check(`${locale}: kyoto draft links every night to a stay`, draft.next.days.slice(0, 3).every((d) => d.stayRef));
  check(`${locale}: draft reply is a summary, not the plan`, (draft.reply ?? '').length < 600 && !/Day 2 \||第\s*2\s*天/.test(draft.reply ?? ''));

  const lighter = await say(draft.next, zh ? '第三天太累了，能轻松一点吗？' : 'Day 3 looks too tiring, can you make it lighter?');
  check(`${locale}: "day 3 lighter" is a revise of day 3`, lighter.effect === 'revise' && lighter.next.days[2] !== undefined);
  const others = [0, 1, 3].every((i) => JSON.stringify(lighter.next.days[i]) === JSON.stringify(draft.next.days[i]));
  check(`${locale}: other days are unchanged`, others);
  check(`${locale}: day 3 changed`, JSON.stringify(lighter.next.days[2]) !== JSON.stringify(draft.next.days[2]));
  check(`${locale}: every hotel is unchanged`, lighter.next.days.every((d, i) => d.stayRef === draft.next.days[i].stayRef));
  check(`${locale}: revise reply is short`, Boolean(lighter.reply) && (lighter.reply ?? '').length < 600);
  if (!others || lighter.effect !== 'revise') console.log(`  classified ${JSON.stringify(lighter.classified)}, reply ${JSON.stringify(lighter.reply)}`);

  const cheaper = await say(lighter.next, zh ? '酒店换一家便宜点的' : 'Can we stay somewhere cheaper?');
  check(`${locale}: "cheaper hotel" revises nights only`, cheaper.effect === 'revise' && cheaper.next.days.every((d, i) => d.title === lighter.next.days[i].title && d.body === lighter.next.days[i].body));
  const price = (state: TripState) => state.stays?.items.find((h) => h.ref === state.days[0].stayRef)?.price?.amount ?? Infinity;
  check(`${locale}: the new hotel is cheaper`, price(cheaper.next) < price(lighter.next));
  if (process.env.PRINT_DRAFT) console.log(cheaper.reply);
}

await mcp.mcpManager.close();
console.log(failures ? `${failures} check(s) failed` : 'all checks passed');
process.exit(failures ? 1 : 0);
