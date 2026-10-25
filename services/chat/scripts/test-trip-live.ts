// Live check of the trip prompts against the configured model and MCP servers.
// Usage: bun run scripts/test-trip-live.ts (PRINT_DRAFT=1 also prints the Tokyo→Osaka drafts)
import 'dotenv/config';
import { McpService } from '../src/llm/mcp/mcp.service.js';
import { ModelTripLlm } from '../src/trip/llm.js';
import { loadSkills } from '../src/skills/registry.js';
import { reduce } from '../src/trip/commands.js';
import { groundResults, linkStays, mergeStays } from '../src/trip/results.js';
import { initialState, type Locale, type TripState } from '../src/trip/state.js';

const mcp = new McpService();
await mcp.mcpManager.start();
const llm = new ModelTripLlm(mcp, loadSkills());
let failures = 0;
const check = (label: string, ok: boolean) => {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${label}`);
  if (!ok) failures++;
};

async function turn(state: TripState, text: string) {
  const signal = AbortSignal.timeout(180_000);
  const classified = await llm.classify({ text, state, history: [] }, signal);
  const { state: next, effect } = reduce(state, { type: 'message', text }, classified);
  let draft = '';
  const loaded: string[] = [];
  const calls: string[] = [];
  if (effect)
    for await (const e of llm.respond(effect, { text, state: next, history: [] }, signal)) {
      if (e.type === 'text') draft += e.delta;
      if (e.type === 'tool_call') calls.push(e.name);
      if (e.type === 'tool_call' && e.name === 'load_skill' && Array.isArray(e.args.names)) loaded.push(...(e.args.names as string[]));
      if (e.type === 'show_results') {
        const group = groundResults(e.input, e.results);
        if (effect === 'itinerary' && group.panel === 'hotels') next.stays = mergeStays(next.stays, group);
        else if (group.items.length) next.results.push(group);
      }
    }
  if (effect === 'itinerary') {
    next.itinerary = draft;
    next.days = linkStays(await llm.extractDays(draft, next.stays, next.locale, signal), next.stays);
  }
  return { classified, next, effect, draft, loaded, calls };
}

for (const locale of ['zh', 'en'] as Locale[]) {
  const start = initialState(0, locale);
  const zh = locale === 'zh';

  const overnight = await turn(start, zh ? '帮我规划大阪亲子游，2026-12-01 到 2026-12-03，4 个人' : 'Plan a family trip to Osaka, 2026-12-01 to 2026-12-03, 4 people');
  check(`${locale}: one-shot planning reaches review`, overnight.next.stage === 'review' && overnight.effect === 'itinerary');
  check(`${locale}: overnight trip found stays`, (overnight.next.stays?.items.length ?? 0) > 0);
  if (!overnight.next.stays) console.log(`  tool calls: ${JSON.stringify(overnight.calls)}`);
  check(`${locale}: stays carry amenities or images`, (overnight.next.stays?.items ?? []).some((h) => h.amenities.length > 0 || h.image));
  check(`${locale}: at least one day links to a stay`, overnight.next.days.some((d) => d.stayRef));

  const dayTrip = await turn(start, zh ? '奈良一日游，2026-12-01 当天往返，1 个人，个人游' : 'Solo day trip to Nara on 2026-12-01, back the same day, 1 person');
  check(`${locale}: same-day trip has no stays`, !dayTrip.next.stays);

  const search = await turn(start, zh ? '京都站附近 1000 元以内的酒店' : 'Hotels near Kyoto Station under 1000 CNY');
  check(`${locale}: hotel question is chat`, search.classified.intent === 'chat');
  check(`${locale}: hotel question shows cards`, search.next.results.some((g) => g.items.length > 0));

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
  const headings = zh ? ['总览', '出发前要办'] : ['Overview', 'Before you go'];
  check(`${locale}: japan draft has overview and before-you-go`, headings.every((h) => japan.draft.includes(h)));
  check(`${locale}: japan draft marks estimates`, zh ? /约/.test(japan.draft) : /approx/i.test(japan.draft));
  check(`${locale}: japan draft covers every day`, japan.next.days.length >= 6);
  const legs = /(线|新干线|Line|Shinkansen|Skyliner|Haruka|→)/;
  const legStops = japan.next.days.flatMap((d) => d.stops.map((s) => s.name)).filter((name) => legs.test(name));
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

await mcp.mcpManager.close();
console.log(failures ? `${failures} check(s) failed` : 'all checks passed');
process.exit(failures ? 1 : 0);
