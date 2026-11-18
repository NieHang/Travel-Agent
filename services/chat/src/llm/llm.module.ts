import { Module } from '@nestjs/common';
import { isLlmFakeEnabled } from '../config/auth.config.js';
import { AdvancedModule } from './advanced.module.js';
import { FakeRequirementService } from './requirement.fake.js';
import { LlmService } from './llm.service.js';
import { RequirementService } from './requirement.service.js';

@Module({
  imports: [AdvancedModule],
  providers: [
    LlmService,
    {
      provide: RequirementService,
      useFactory: () =>
        isLlmFakeEnabled()
          ? new FakeRequirementService()
          : new RequirementService(),
    },
  ],
  exports: [
    LlmService,
    RequirementService,
    AdvancedModule,
  ],
})
export class LlmModule {}
