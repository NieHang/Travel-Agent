import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { McpManager } from './manager.js';
import { MCP_SERVERS } from './servers.js';

@Injectable()
export class McpService implements OnModuleInit, OnModuleDestroy {
  readonly mcpManager = new McpManager(MCP_SERVERS);

  onModuleInit(): void {
    void this.mcpManager.start();
  }

  onModuleDestroy(): void {
    void this.mcpManager.close();
  }
}
