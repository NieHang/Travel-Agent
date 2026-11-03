import 'dotenv/config';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import { ModelTripLlm, type McpToolSource } from '../src/trip/llm.js';
import { initialState } from '../src/trip/state.js';
import { reduce } from '../src/trip/commands.js';
import { loadSkills } from '../src/skills/registry.js';
import { readCassette } from './replay/cassette.js';
import { recordMcp } from './replay/record.js';
import { ReplayMcp } from './replay/replay.js';

const path = fileURLToPath(new URL('./cassettes/p1/kyoto-hotels.json', import.meta.url));

try {
  await main();
} catch (error) {
  console.error('FAIL replay check:', error);
  process.exitCode = 1;
}

async function main(): Promise<void> {
  if (process.argv.includes('--record')) {
    const { McpService } = await import('../src/llm/mcp/mcp.service.js');
    const mcp = new McpService();
    try {
      await mcp.mcpManager.start();
      const recording = recordMcp(mcp);
      const calls = await runCase(recording);
      await recording.save(path);
      console.log(`Recorded ${path}\n${JSON.stringify(calls, null, 2)}`);
    } finally {
      await mcp.mcpManager.close();
    }
    return;
  }

  const cassette = await readCassette(path);
  const runs: { calls: { name: string; args: Record<string, unknown> }[]; misses: ReplayMcp['misses'] }[] = [];
  for (const trial of [1, 2, 3]) {
    const replay = new ReplayMcp(cassette);
    const calls = await runCase(replay);
    runs.push({ calls, misses: replay.misses });
    console.log(`Run ${trial}:\n${JSON.stringify(calls, null, 2)}\nMisses: ${JSON.stringify(replay.misses)}`);
  }
  const differences = runs.flatMap((run, index) => {
    const messages: string[] = [];
    if (!isDeepStrictEqual(run.calls, runs[0].calls)) messages.push(`Run ${index + 1} differs from run 1: ${JSON.stringify({ expected: runs[0].calls, actual: run.calls })}`);
    if (run.misses.length) messages.push(`Run ${index + 1} replay misses: ${JSON.stringify(run.misses)}`);
    return messages;
  });
  if (differences.length) {
    console.error(`FAIL\n${differences.join('\n')}`);
    process.exitCode = 1;
    return;
  }
  console.log('PASS: all 3 tool-call sequences are identical, with no replay misses.');
}

async function runCase(mcp: McpToolSource) {
  const llm = new ModelTripLlm(mcp, loadSkills(), { today: '2026-10-29' });
  const text = '京都站附近 1000 元以内的酒店';
  const state = initialState(0, 'zh');
  const signal = AbortSignal.timeout(180_000);
  const classified = await llm.classify({ text, state, history: [] }, signal);
  const { state: next } = reduce(state, { type: 'message', text }, classified);
  const calls: { name: string; args: Record<string, unknown> }[] = [];
  for await (const event of llm.respond('answer', { text, state: next, history: [] }, signal)) {
    if (event.type === 'tool_call') calls.push({ name: event.name, args: event.args });
  }
  return calls;
}
