import { Client } from '@modelcontextprotocol/sdk/client/index';
import {
  StreamableHTTPClientTransport,
  StreamableHTTPClientTransportOptions,
} from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { FetchLike } from '@modelcontextprotocol/sdk/shared/transport';
import type { Tool as MCPToolDef } from '@modelcontextprotocol/sdk/types.js';

export interface McpServerConfig {
  url: string;
  headers?: Record<string, string>;
}

export interface ConnectedMcpServer {
  name: string;
  client: Client;
  tools: MCPToolDef[];
  transport: StreamableHTTPClientTransport;
}

const CONNECTION_TIMEOUT_MS = 30_000;
const MCP_REQUEST_TIMEOUT_MS = 60_000;

async function connectWithTimeout(
  client: Client,
  transport: StreamableHTTPClientTransport,
  name: string,
  ms: number,
): Promise<void> {
  const connectPromise = client.connect(transport);
  const timeoutPromise = new Promise<never>((rev, rej) => {
    const timeoutId = setTimeout(() => {
      transport.close().catch(() => {});
      rej(new Error(`MCP server ${name} connection timed out`));
    }, ms);
    connectPromise.then(
      () => clearTimeout(timeoutId),
      () => clearTimeout(timeoutId),
    );
  });
  return Promise.race([connectPromise, timeoutPromise]);
}

export function wrapFetchWithTimeout(
  fetch: FetchLike,
  timeoutMs: number,
): FetchLike {
  return async (url: string | URL, init?: RequestInit) => {
    const method = (init?.method ?? 'GET').toUpperCase();

    if (method === 'GET') return fetch(url, init);

    const controller = new AbortController();
    const timer = setTimeout(
      (c) =>
        c.abort(new DOMException('The operation timed out.', 'TimeoutError')),
      timeoutMs,
      controller,
    );
    timer.unref?.();

    try {
      const signal = init?.signal
        ? AbortSignal.any([init.signal, controller.signal])
        : controller.signal;
      return await fetch(url, { ...init, signal });
    } finally {
      clearTimeout(timer);
    }
  };
}

export async function connectMcpServer(
  name: string,
  config: McpServerConfig,
): Promise<ConnectedMcpServer> {
  const transportOptions: StreamableHTTPClientTransportOptions = {
    fetch: wrapFetchWithTimeout(fetch, MCP_REQUEST_TIMEOUT_MS),
    requestInit: {
      headers: {
        'User-Agent': 'travel-agent/0.1.0',
        ...config.headers,
      },
    },
  };

  const transport = new StreamableHTTPClientTransport(
    new URL(config.url),
    transportOptions,
  );
  const client = new Client(
    {
      name: 'travel-agent',
      version: '0.0.0',
    },
    {
      capabilities: {},
    },
  );

  await connectWithTimeout(client, transport, name, CONNECTION_TIMEOUT_MS);

  const caps = await client.getServerCapabilities();
  let tools: MCPToolDef[] = [];
  if (caps?.tools) {
    tools = (await client.listTools()).tools;
  } else {
    console.warn(`MCP server ${name} does not support tools capability`);
  }

  console.log(`Connected to MCP server ${name} with ${tools.length} tools`);
  return {
    name,
    client,
    tools,
    transport,
  };
}
