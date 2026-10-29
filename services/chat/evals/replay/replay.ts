import { DynamicStructuredTool } from '@langchain/core/tools';
import type { BaseCallbackHandler } from '@langchain/core/callbacks/base';
import type { McpToolSource } from '../../src/trip/llm.js';
import type { Cassette } from './cassette.js';

export function normalizeArgs(value: unknown): unknown {
  if (value === null || value === undefined || value === '') return undefined;
  if (Array.isArray(value)) return value.map(normalizeArgs).filter((item) => item !== undefined);
  if (typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value)
      .sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
      .map(([key, item]) => [key, normalizeArgs(item)])
      .filter(([, item]) => item !== undefined),
  );
}

export class ReplayMcp implements McpToolSource {
  readonly misses: { tool: string; args: Record<string, unknown> }[] = [];
  readonly mcpManager: { getTools(): DynamicStructuredTool[] };

  constructor(cassette: Cassette, callbacks?: BaseCallbackHandler[]) {
    const tools = cassette.tools.map((tool) => new DynamicStructuredTool({
      name: tool.name,
      description: tool.description,
      schema: tool.schema,
      callbacks,
      func: async (args: Record<string, unknown>) => {
        const key = JSON.stringify(normalizeArgs(args));
        const match = cassette.calls.find((call) => call.tool === tool.name && JSON.stringify(normalizeArgs(call.args)) === key);
        if (match) return match.result;
        this.misses.push({ tool: tool.name, args });
        return cassette.calls.find((call) => call.tool === tool.name)?.result
          ?? { content: `No recorded result for ${tool.name}`, isError: true };
      },
    }));
    this.mcpManager = { getTools: () => tools };
  }
}
