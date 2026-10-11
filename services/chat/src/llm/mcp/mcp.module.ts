import { Module } from '@nestjs/common';
import { McpService } from './mcp.service.js';

/** One shared MCP connection pool for every module that binds MCP tools. */
@Module({
  providers: [McpService],
  exports: [McpService],
})
export class McpModule {}
