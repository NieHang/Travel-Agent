import { Body, Controller, Inject, Post } from '@nestjs/common';
import { OrchestratorService } from './orchestrator.service.js';

@Controller('api/agents')
export class AgentsController {
  constructor(
    @Inject(OrchestratorService)
    private readonly orchestrator: OrchestratorService,
  ) {}

  @Post('orchestrate')
  orchestrate(@Body() body: { input: string }) {
    return this.orchestrator.orchestrate(body?.input);
  }
}
