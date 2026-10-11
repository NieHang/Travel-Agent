import { McpServerConfig } from './client.js';

function required(name: string): string | undefined {
  const v = process.env[name];
  if (!v) console.warn(`[MCP] ${name} is not set`);
  return v;
}

function buildRollingGoServer(): McpServerConfig | undefined {
  const rollingGoUrl = required('ROLLING_GO');
  const rollingGoApiKey = required('ROLLING_GO_API_KEY');
  if (rollingGoUrl) {
    return {
      url: rollingGoUrl,
      headers: {
        Authorization: `Bearer ${rollingGoApiKey}`,
      },
    };
  }
}

function buildServers(): Record<string, McpServerConfig> {
  const servers: Record<string, McpServerConfig> = {};

  const rollingGoServer = buildRollingGoServer();
  if (rollingGoServer) {
    servers.rollingGo = rollingGoServer;
  }

  return servers;
}

export const MCP_SERVERS = buildServers();
