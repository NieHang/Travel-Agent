import { type DynamicModule, Module } from '@nestjs/common';
import { isLlmDemoRoutesEnabled } from '../config/auth.config.js';
import {
  AdvancedController,
  AgentsController,
  EmbeddingController,
  FilesystemController,
  MemoryController,
} from './advanced.controller.js';
import { LlmController } from './llm.controller.js';
import { LlmModule } from './llm.module.js';
import { RequirementController } from './requirement.controller.js';

/**
 * The LangChain demo routes are not scoped to a user (memory history is keyed by a client-supplied
 * sessionId), so they and the services behind them load only when LLM_DEMO_ROUTES is set.
 */
@Module({})
export class DemoRoutesModule {
  static register(): DynamicModule {
    if (!isLlmDemoRoutesEnabled()) return { module: DemoRoutesModule };
    return {
      module: DemoRoutesModule,
      imports: [LlmModule],
      controllers: [
        RequirementController,
        LlmController,
        MemoryController,
        FilesystemController,
        EmbeddingController,
        AgentsController,
        AdvancedController,
      ],
    };
  }
}
