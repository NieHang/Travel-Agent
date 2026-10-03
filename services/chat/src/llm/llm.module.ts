import { Module } from '@nestjs/common';
import { AdvancedModule } from './advanced.module.js';
import { CHAT_REPLY_PORT } from './chat-reply/chat-reply.port.js';
import { FakeChatReply, FakeRequirementService } from './chat-reply/fakes.js';
import { ModelChatReply } from './chat-reply/model-chat-reply.js';
import { LlmController } from './llm.controller.js';
import { LlmService } from './llm.service.js';
import { RequirementService } from './requirement.service.js';

const useFake = () => process.env.LLM_FAKE === '1';

@Module({
  imports: [AdvancedModule],
  controllers: [LlmController],
  providers: [
    LlmService,
    {
      provide: RequirementService,
      useFactory: () =>
        useFake() ? new FakeRequirementService() : new RequirementService(),
    },
    {
      provide: CHAT_REPLY_PORT,
      useFactory: () =>
        useFake() ? new FakeChatReply() : new ModelChatReply(),
    },
  ],
  exports: [LlmService, RequirementService, CHAT_REPLY_PORT, AdvancedModule],
})
export class LlmModule {}
