import { Module } from '@nestjs/common';
import { isLlmFakeEnabled } from '../config/auth.config.js';
import { McpModule } from '../llm/mcp/mcp.module.js';
import { McpService } from '../llm/mcp/mcp.service.js';
import { FakeTripLlm } from './fake-llm.js';
import { ModelTripLlm, TRIP_LLM } from './llm.js';
import { TurnService } from './turn.js';

@Module({
  imports: [McpModule],
  providers: [
    {
      provide: TRIP_LLM,
      inject: [McpService],
      useFactory: (mcp: McpService) => (isLlmFakeEnabled() ? new FakeTripLlm() : new ModelTripLlm(mcp)),
    },
    TurnService,
  ],
  exports: [TurnService],
})
export class TripModule {}
