import { Module } from '@nestjs/common';
import { ConversationsModule } from '../conversations/conversations.module.js';
import { ChatController } from './chat.controller.js';
import { TripModule } from '../trip/trip.module.js';

// AppThrottlerGuard 依赖的存储与配置来自 AppModule 里的 ThrottlerModule.forRoot（全局模块）。

@Module({
  imports: [ConversationsModule, TripModule],
  controllers: [ChatController],
})
export class ChatModule {}
