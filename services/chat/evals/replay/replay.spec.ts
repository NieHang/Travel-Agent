import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DynamicStructuredTool, type ToolSchemaBase } from '@langchain/core/tools';
import { BaseCallbackHandler } from '@langchain/core/callbacks/base';
import { readCassette, type Cassette } from './cassette.js';
import { recordMcp } from './record.js';
import { normalizeArgs, ReplayMcp } from './replay.js';

const schema = { type: 'object', properties: { city: { type: 'string', description: 'City name' } }, required: ['city'], additionalProperties: false } satisfies ToolSchemaBase;
const cassette: Cassette = {
  tools: [
    { name: 'mcp_hotels_search', description: 'Search hotels', schema },
    { name: 'mcp_hotels_details', description: 'Hotel details', schema },
  ],
  calls: [
    { tool: 'mcp_hotels_search', args: { city: 'Kyoto' }, result: { content: 'Kyoto hotels', isError: false } },
    { tool: 'mcp_hotels_search', args: { city: 'Osaka' }, result: { content: 'Osaka unavailable', isError: true } },
  ],
};

it('normalizes key order and drops empty values recursively without dropping false or zero', () => {
  expect(JSON.stringify(normalizeArgs({ z: null, c: '', b: { z: undefined, y: '', c: 0, b: false, a: 'Kyoto' }, a: [null, '', undefined, { z: 2, a: 1 }] })))
    .toBe('{"a":[{"a":1,"z":2}],"b":{"a":"Kyoto","b":false,"c":0}}');
});

it('matches normalized arguments exactly and returns the matching result', async () => {
  const replay = new ReplayMcp(cassette);
  expect(await replay.mcpManager.getTools()[0].invoke({ city: 'Osaka' }))
    .toEqual({ content: 'Osaka unavailable', isError: true });
  expect(replay.misses).toEqual([]);
});

it('matches reordered nested arguments with empty values omitted', async () => {
  const replay = new ReplayMcp({
    tools: [{ name: 'mcp_search', description: 'Search', schema: { type: 'object', properties: {} } }],
    calls: [{
      tool: 'mcp_search',
      args: { city: 'Kyoto', filters: { maxPrice: 1000, stars: [4, 5] } },
      result: { content: 'Filtered hotels', isError: false },
    }],
  });
  expect(await replay.mcpManager.getTools()[0].invoke({
    filters: { stars: [4, null, 5, ''], unused: null, maxPrice: 1000 }, city: 'Kyoto', empty: '',
  })).toEqual({ content: 'Filtered hotels', isError: false });
  expect(replay.misses).toEqual([]);
});

it('sets callbacks on every returned record and replay tool', () => {
  class Handler extends BaseCallbackHandler { name = 'callbacks-test'; }
  const callbacks = [new Handler()];
  const source = {
    mcpManager: {
      getTools: () => cassette.tools.map((tool) => new DynamicStructuredTool({
        ...tool, func: async () => ({ content: 'ok', isError: false }),
      })),
    },
  };
  const recording = recordMcp(source, callbacks);
  const replay = new ReplayMcp(cassette, callbacks);
  for (const tool of [...recording.mcpManager.getTools(), ...replay.mcpManager.getTools()]) {
    expect(tool.callbacks).toEqual(callbacks);
  }
});

it('falls back to the first recording for the same tool and lists the miss', async () => {
  const replay = new ReplayMcp(cassette);
  expect(await replay.mcpManager.getTools()[0].invoke({ city: 'Tokyo' }))
    .toEqual({ content: 'Kyoto hotels', isError: false });
  expect(replay.misses).toEqual([{ tool: 'mcp_hotels_search', args: { city: 'Tokyo' } }]);
});

it('returns an error and records a miss when a tool has no calls', async () => {
  const replay = new ReplayMcp(cassette);
  expect(await replay.mcpManager.getTools()[1].invoke({ city: 'Tokyo' }))
    .toEqual({ content: 'No recorded result for mcp_hotels_details', isError: true });
  expect(replay.misses).toEqual([{ tool: 'mcp_hotels_details', args: { city: 'Tokyo' } }]);
});

it('records, saves, reads and replays identical results and tool definitions with callbacks', async () => {
  class Handler extends BaseCallbackHandler { name = 'replay-test'; }
  const callbacks = [new Handler()];
  const sourceTool = new DynamicStructuredTool({
    name: 'mcp_hotels_search', description: 'Search hotels', schema,
    func: async () => ({ content: 'Kyoto hotels', isError: false }),
  });
  const record = recordMcp({ mcpManager: { getTools: () => [sourceTool] } }, callbacks);
  const recordedTool = record.mcpManager.getTools()[0];
  expect(recordedTool.callbacks).toEqual(callbacks);
  expect(await recordedTool.invoke({ city: 'Kyoto' })).toEqual({ content: 'Kyoto hotels', isError: false });
  expect(record.cassette).toEqual({ tools: [cassette.tools[0]], calls: [cassette.calls[0]] });
  const dir = mkdtempSync(join(tmpdir(), 'mcp-replay-'));
  try {
    const path = join(dir, 'cassette.json');
    await record.save(path);
    expect(readFileSync(path, 'utf8')).toBe(JSON.stringify({ tools: [cassette.tools[0]], calls: [cassette.calls[0]] }, null, 2) + '\n');
    const replay = new ReplayMcp(await readCassette(path), callbacks);
    const tool = replay.mcpManager.getTools()[0];
    expect(tool.callbacks).toEqual(callbacks);
    expect(tool.name).toBe('mcp_hotels_search');
    expect(tool.description).toBe('Search hotels');
    expect(JSON.stringify(tool.schema)).toBe('{"type":"object","properties":{"city":{"type":"string","description":"City name"}},"required":["city"],"additionalProperties":false}');
    expect(await tool.invoke({ city: 'Kyoto' })).toEqual({ content: 'Kyoto hotels', isError: false });
    expect(replay.misses).toEqual([]);
  } finally {
    rmSync(dir, { recursive: true });
  }
});

it('validates cassettes at the file boundary', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'mcp-replay-'));
  try {
    const path = join(dir, 'invalid.json');
    writeFileSync(path, '{"tools":[],"calls":[{"tool":"bad","args":{},"result":{"content":4,"isError":false}}]}');
    await expect(readCassette(path)).rejects.toThrow();
  } finally {
    rmSync(dir, { recursive: true });
  }
});
