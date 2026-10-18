// Live check of the trip prompts against the configured model and MCP servers.
// Usage: bun run scripts/test-trip-live.ts
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
  if (effect)
    for await (const e of llm.respond(effect, { text, state: next, history: [] }, signal)) {
      if (e.type === 'text') draft += e.delta;
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
  return { classified, next, effect, draft };
}

for (const locale of ['zh', 'en'] as Locale[]) {
  const start = initialState(0, locale);
  const zh = locale === 'zh';

  const overnight = await turn(start, zh ? '帮我规划杭州亲子游，2026-12-01 到 2026-12-03，4 个人' : 'Plan a family trip to Hangzhou, 2026-12-01 to 2026-12-03, 4 people');
  check(`${locale}: one-shot planning reaches review`, overnight.next.stage === 'review' && overnight.effect === 'itinerary');
  check(`${locale}: overnight trip found stays`, (overnight.next.stays?.items.length ?? 0) > 0);
  check(`${locale}: stays carry amenities or images`, (overnight.next.stays?.items ?? []).some((h) => h.amenities.length > 0 || h.image));
  check(`${locale}: at least one day links to a stay`, overnight.next.days.some((d) => d.stayRef));

  const dayTrip = await turn(start, zh ? '杭州一日游，2026-12-01 当天往返，1 个人，个人游' : 'Solo day trip to Hangzhou on 2026-12-01, back the same day, 1 person');
  check(`${locale}: same-day trip has no stays`, !dayTrip.next.stays);

  const search = await turn(start, zh ? '杭州西湖附近 800 元以内的酒店' : 'Hotels near West Lake in Hangzhou under 800 CNY');
  check(`${locale}: hotel question is chat`, search.classified.intent === 'chat');
  check(`${locale}: hotel question shows cards`, search.next.results.some((g) => g.items.length > 0));

  const vague = await turn(start, zh ? '12 月想去个暖和的地方，两个人' : 'Somewhere warm in December for two');
  check(`${locale}: vague destination asks to clarify`, vague.next.clarify?.field === 'destination');
}

await mcp.mcpManager.close();
console.log(failures ? `${failures} check(s) failed` : 'all checks passed');
process.exit(failures ? 1 : 0);
