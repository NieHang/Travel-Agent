import type { Tool as MCPToolDef } from '@modelcontextprotocol/sdk/types.js';
import {
  DynamicStructuredTool,
  type ToolSchemaBase,
} from '@langchain/core/tools';
import type { McpManager } from './manager.js';
import { CallbackManagerForToolRun } from '@langchain/core/callbacks/manager';

const MAX_MCP_DESCRIPTION_LENGTH = 2048;

function buildMcpToolName(serverName: string, toolName: string) {
  return `mcp_${serverName}_${toolName}`;
}

function joinTextBlocks(content: unknown): string {
  if (!Array.isArray(content)) return '';
  return content
    .filter(
      (block): block is { text: string; type: 'text' } => block.type === 'text',
    )
    .map((block) => block.text)
    .join('\n');
}

export function wrapMcpTool(
  manager: McpManager,
  serverName: string,
  def: MCPToolDef,
): DynamicStructuredTool {
  const rawDesc = def.description ?? '';
  const description =
    rawDesc.length > MAX_MCP_DESCRIPTION_LENGTH
      ? rawDesc.slice(0, MAX_MCP_DESCRIPTION_LENGTH) + '... [truncated]'
      : rawDesc;

  return new DynamicStructuredTool({
    name: buildMcpToolName(serverName, def.name),
    description,
    schema: def.inputSchema as ToolSchemaBase,
    func: async (
      args: Record<string, unknown>,
      runManager?: CallbackManagerForToolRun | undefined,
      config?: { signal?: AbortSignal },
    ): Promise<Record<string, unknown>> => {
      try {
        const result = await manager.callTool(serverName, def.name, args, {
          signal: config?.signal,
        });
        return {
          content: joinTextBlocks(result?.content),
          isError: result?.isError === true,
        };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return {
          content: `MCP tool call failed: ${msg}`,
          isError: true,
        };
      }
    },
  });
}
