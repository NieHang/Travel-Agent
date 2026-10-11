import { Module } from '@nestjs/common';
import { isLlmFakeEnabled } from '../config/auth.config.js';
import { AdvancedModule } from './advanced.module.js';
import { CHAT_REPLY_PORT } from './chat-reply/chat-reply.port.js';
import { FakeChatReply, FakeRequirementService } from './chat-reply/fakes.js';
import { ModelChatReply } from './chat-reply/model-chat-reply.js';
import { LlmController } from './llm.controller.js';
import { LlmService } from './llm.service.js';
import { RequirementService } from './requirement.service.js';
import { UIProtocolModule } from './ui-protocol/ui-protocol.module.js';
import { McpService } from './mcp/mcp.service.js';
import { McpModule } from './mcp/mcp.module.js';

@Module({
  imports: [AdvancedModule, McpModule, UIProtocolModule],
  controllers: [LlmController],
  providers: [
    LlmService,
    {
      provide: RequirementService,
      useFactory: () =>
        isLlmFakeEnabled()
          ? new FakeRequirementService()
          : new RequirementService(),
    },
    {
      provide: CHAT_REPLY_PORT,
      inject: [McpService],
      useFactory: (mcp: McpService) =>
        isLlmFakeEnabled() ? new FakeChatReply() : new ModelChatReply(mcp),
    },
  ],
  exports: [
    LlmService,
    RequirementService,
    CHAT_REPLY_PORT,
    AdvancedModule,
    UIProtocolModule,
  ],
})
export class LlmModule {}
