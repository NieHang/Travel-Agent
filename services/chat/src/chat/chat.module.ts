import { Module } from '@nestjs/common';
import { ConversationsModule } from '../conversations/conversations.module.js';
import { LlmModule } from '../llm/llm.module.js';
import { ChatController } from './chat.controller.js';
import { ChatService } from './chat.service.js';

// AppThrottlerGuard 依赖的存储与配置来自 AppModule 里的 ThrottlerModule.forRoot（全局模块）。
@Module({
  imports: [ConversationsModule, LlmModule],
  controllers: [ChatController],
  providers: [ChatService],
})
export class ChatModule {}
