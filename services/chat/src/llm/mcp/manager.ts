import type { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import {
  ErrorCode,
  McpError,
  ToolListChangedNotificationSchema,
  type CallToolResult,
  type Tool as MCPToolDef,
} from '@modelcontextprotocol/sdk/types.js';
import { DynamicStructuredTool } from '@langchain/core/tools';
import { type McpServerConfig, connectMcpServer } from './client.js';
import { wrapMcpTool } from './mcp-tools.js';

type ServerStatus = 'idle' | 'connecting' | 'connected' | 'failed';

interface ServerState {
  name: string;
  config: McpServerConfig;
  status: ServerStatus;
  client?: Client;
  transport?: StreamableHTTPClientTransport;
  tools: MCPToolDef[];
  connecting?: Promise<void>;
  retryAttempt: number;
  retryTimer?: NodeJS.Timeout;
  lastError?: string;
}

const MAX_RETRY_DELAY_MS = 60_000;
const TOOL_CALL_TIMEOUT_MS = 60_000;

export class McpManager {
  private servers = new Map<string, ServerState>();
  private closed = false;

  constructor(configs: Record<string, McpServerConfig>) {
    for (const [name, config] of Object.entries(configs)) {
      this.servers.set(name, {
        name,
        config,
        status: 'idle',
        tools: [],
        retryAttempt: 0,
      });
    }
  }

  async start(): Promise<void> {
    await Promise.allSettled(
      [...this.servers.values()].map((s) => this.ensureConnected(s)),
    );
    for (const s of this.servers.values()) {
      console.log(`[MCP] ${s.name}: ${s.status} (${s.tools.length} tools)`);
    }
  }

  getTools(): DynamicStructuredTool[] {
    const out: DynamicStructuredTool[] = [];
    const seen = new Set<string>();
    for (const s of this.servers.values()) {
      if (s.status !== 'connected') continue;
      for (const toolDef of s.tools) {
        const tool = wrapMcpTool(this, s.name, toolDef);
        if (!seen.has(tool.name)) {
          seen.add(tool.name);
          out.push(tool);
        } else {
          console.warn(`[MCP] Duplicate tool name ${tool.name}, skipping`);
          continue;
        }
      }
    }
    return out;
  }

  async callTool(
    serverName: string,
    toolName: string,
    args: Record<string, unknown>,
    options?: {
      meta?: Record<string, unknown>;
      signal?: AbortSignal;
    },
  ): Promise<CallToolResult> {
    const server = this.servers.get(serverName);
    if (!server) {
      throw new Error(`MCP server ${serverName} not found`);
    }
    if (server.status !== 'connected' || !server.client) {
      throw new Error(`MCP server ${serverName} is not connected`);
    }

    const controller = new AbortController();
    const timer = setTimeout(() => {
      controller.abort();
    }, TOOL_CALL_TIMEOUT_MS);

    const signal = options?.signal
      ? AbortSignal.any([options.signal, controller.signal])
      : controller.signal;

    const call = () =>
      server?.client?.callTool(
        {
          name: toolName,
          arguments: args,
          _meta: options?.meta,
        },
        undefined,
        { signal, timeout: TOOL_CALL_TIMEOUT_MS },
      ) as Promise<CallToolResult>;

    try {
      return await call();
    } catch (err) {
      if (signal.aborted) throw err;

      if (err instanceof McpError && err.code !== ErrorCode.ConnectionClosed)
        throw err;

      await this.reset(server);
      await this.ensureConnected(server);
      return await call();
    } finally {
      clearTimeout(timer);
    }
  }

  private async connect(state: ServerState): Promise<void> {
    try {
      const { client, tools, transport } = await connectMcpServer(
        state.name,
        state.config,
      );
      state.client = client;
      state.transport = transport;
      state.status = 'connected';
      state.retryAttempt = 0;

      client.onclose = () => this.handleDisconnect(state, client);
      client.onerror = (err) => {
        console.error(`[MCP] ${state.name} error:`, err);
        this.handleDisconnect(state, client);
      };

      client.setNotificationHandler(
        ToolListChangedNotificationSchema,
        async () => {
          if (state.client !== client) return;
          try {
            state.tools = (await client.listTools()).tools;
          } catch (err) {
            console.warn(`[MCP] ${state.name} failed to refresh tools:`, err);
          }
        },
      );

      state.tools = tools;
      state.retryAttempt = 0;
      state.lastError = undefined;
    } catch (err) {
      state.status = 'failed';
      state.lastError = err instanceof Error ? err.message : String(err);
      console.error(`[MCP] ${state.name} connection failed:`, state.lastError);
      this.scheduleRetry(state);
      throw err;
    }
  }

  private scheduleRetry(state: ServerState) {
    if (this.closed) return;
    clearTimeout(state.retryTimer);
    const delay = Math.min(1000 * 2 ** state.retryAttempt, MAX_RETRY_DELAY_MS);
    console.warn(
      `[MCP] ${state.name} will retry connection in ${delay}ms (attempt ${state.retryAttempt + 1})`,
    );
    state.retryAttempt++;
    state.retryTimer = setTimeout(() => {
      this.ensureConnected(state)?.catch(() => {});
    }, delay);
    state.retryTimer.unref?.();
  }

  private ensureConnected(state: ServerState): Promise<void> | undefined {
    if (this.closed) return Promise.reject(new Error('McpManger is closed'));
    if (state.status === 'connected') return Promise.resolve();
    if (!state.connecting) {
      state.connecting = this.connect(state).finally(() => {
        state.connecting = undefined;
      });
    }
    return state.connecting;
  }

  private handleDisconnect(state: ServerState, client: Client) {
    if (state.client !== client) return;
    console.warn(`[MCP] ${state.name} disconnected`);
    state.client = undefined;
    state.transport = undefined;
    state.status = 'idle';
    this.scheduleRetry(state);
  }

  private async reset(state: ServerState) {
    clearTimeout(state.retryTimer);
    const { client, transport } = state;
    state.status = 'idle';
    state.client = undefined;
    state.transport = undefined;
    state.tools = [];
    state.retryAttempt = 0;
    state.lastError = undefined;
    await transport?.terminateSession().catch(() => {});
    await client?.close().catch(() => {});
  }

  async close(): Promise<void> {
    this.closed = true;
    await Promise.allSettled(
      [...this.servers.values()].map(async (s) => {
        if (s.transport) {
          await s.transport.close().catch(() => {});
        }
      }),
    );
  }
}
