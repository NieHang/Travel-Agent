import 'dotenv/config';
import { AIMessage, HumanMessage } from '@langchain/core/messages';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { McpService } from '../src/llm/mcp/mcp.service.js';
import { ModelTripLlm } from '../src/trip/llm.js';
import { initialState } from '../src/trip/state.js';
import { loadSkills } from '../src/skills/registry.js';
import { readDataset } from './schemas.js';
import { recordMcp } from './replay/record.js';
import { turn } from './turn.js';
import { readCassette } from './replay/cassette.js';
import { itineraryReplayKey } from './replay/itinerary.js';
import { readRuns } from './comparison.js';

// Recording runs no geocoders and exports no traces. Prepared drafts let us count Google requests before approval.
const mcp = new McpService();
try {
  await mcp.mcpManager.start();
  if (process.argv[2] === '--refresh') {
    const selected = process.argv[3];
    const prefixes = process.argv.slice(4);
    const entries = await readDataset('itinerary');
    if ((selected !== 'all' && !entries.some((e) => e.id === selected)) || !prefixes.length) throw new Error('Usage: eval:record-itinerary --refresh <case-id|all> <run-prefix>...');
    const runs = (await Promise.all(prefixes.map((p) => readRuns(fileURLToPath(new URL('./results/', import.meta.url)), p)))).flat();
    for (const id of selected === 'all' ? entries.map((e) => e.id) : [selected]) {
      const path = fileURLToPath(new URL(`./cassettes/l3/${id}.json`, import.meta.url));
      const cassette = await readCassette(path);
      const recording = recordMcp(mcp);
      const tools = new Map(recording.mcpManager.getTools().map((tool) => [tool.name, tool]));
      for (const run of runs) {
        if (run.suite !== 'itinerary') throw new Error('Refresh requires itinerary runs');
        for (const item of run.items.filter((i) => i.id === id))
          for (const call of item.output?.toolCalls ?? []) {
            const tool = tools.get(call.name);
            if (!tool) continue;
            const key = JSON.stringify(itineraryReplayKey(call.name, call.args));
            if (cassette.calls.some((c) => c.tool === call.name && JSON.stringify(itineraryReplayKey(c.tool, c.args)) === key)) continue;
            await tool.invoke(call.args, { signal: AbortSignal.timeout(60_000) });
            cassette.calls.push(...recording.cassette.calls.splice(0));
            await writeFile(path, JSON.stringify(cassette, null, 2) + '\n');
            console.log(`${id}: recorded observed argument variant (${cassette.calls.length} calls)`);
          }
      }
    }
  } else for (const item of await readDataset('itinerary')) {
    if (!('must' in item)) continue;
    const filter = process.argv.slice(2);
    if (filter.length && !filter.includes(item.id)) continue;
    const recording = recordMcp(mcp);
    const llm = new ModelTripLlm(recording, loadSkills(), { today: item.today });
    try {
      const history = item.history.map((message) => message.role === 'user' ? new HumanMessage(message.text) : new AIMessage(message.text));
      const output = await turn(llm, initialState(0, item.locale), item.text, { history });
      await recording.save(fileURLToPath(new URL(`./cassettes/l3/${item.id}.json`, import.meta.url)));
      await mkdir(new URL('./results/prepared/', import.meta.url), { recursive: true });
      await writeFile(new URL(`./results/prepared/${item.id}.json`, import.meta.url), JSON.stringify({ item, output }, null, 2) + '\n');
      console.log(`${item.id}: ${output.effect}, ${output.next.days.length} days, ${recording.cassette.calls.length} MCP calls`);
    } catch (error) {
      console.error(`${item.id}: ${error instanceof Error ? error.message : String(error)}`);
      process.exitCode = 1;
    }
  }
} finally {
  await mcp.mcpManager.close();
}
