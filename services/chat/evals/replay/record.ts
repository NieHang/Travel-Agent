import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { DynamicStructuredTool } from '@langchain/core/tools';
import type { BaseCallbackHandler } from '@langchain/core/callbacks/base';
import type { McpToolSource } from '../../src/trip/llm.js';
import { McpResultSchema, type Cassette } from './cassette.js';

export function recordMcp(source: McpToolSource, callbacks?: BaseCallbackHandler[]) {
  const sourceTools = source.mcpManager.getTools();
  const cassette: Cassette = {
    tools: sourceTools.map((tool) => ({
      name: tool.name, description: tool.description, schema: tool.schema as Record<string, unknown>,
    })),
    calls: [],
  };
  const tools = sourceTools.map((tool) => new DynamicStructuredTool({
    name: tool.name,
    description: tool.description,
    schema: tool.schema,
    callbacks,
    func: async (args: Record<string, unknown>, _runManager, config) => {
      const result = McpResultSchema.parse(await tool.invoke(args, config));
      cassette.calls.push({ tool: tool.name, args, result });
      return result;
    },
  }));
  return {
    mcpManager: { getTools: () => tools },
    cassette,
    async save(path: string): Promise<void> {
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, JSON.stringify(cassette, null, 2) + '\n');
    },
  };
}
