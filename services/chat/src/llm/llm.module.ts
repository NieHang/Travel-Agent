import { Module } from '@nestjs/common';
import { AdvancedModule } from './advanced.module.js';
import { LlmController } from './llm.controller.js';
import { LlmService } from './llm.service.js';
import { RequirementService } from './requirement.service.js';

@Module({
  imports: [AdvancedModule],
  controllers: [LlmController],
  providers: [LlmService, RequirementService],
  exports: [LlmService, RequirementService, AdvancedModule],
})
export class LlmModule {}
