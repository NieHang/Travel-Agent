import { Body, Controller, Inject, Logger, Param, Post, Res, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { SendMessageRequestSchema, type SendMessageRequest } from '@autix/contracts';
import type { Response } from 'express';
import { AppThrottlerGuard } from '../auth/app-throttler.guard.js';
import { CurrentUser, type AuthUser } from '../auth/decorators.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { ConversationsService } from '../conversations/conversations.service.js';
import { ChatService } from './chat.service.js';

const CHAT_LIMIT = { default: { limit: 20, ttl: 60_000 } };

@Controller('api/conversations')
export class ChatController {
  private readonly logger = new Logger(ChatController.name);

  constructor(
    @Inject(ChatService) private readonly chat: ChatService,
    @Inject(ConversationsService) private readonly conversations: ConversationsService,
  ) {}

  /**
   * 以 SSE 流式返回助手回复。全局 JwtAuthGuard 先于限流 guard 执行，所以按用户计数。
   * 响应头在第一个事件（用户消息已落库）时才写出：在那之前的失败都是普通 JSON 错误。
   */
  @Post(':id/messages')
  @UseGuards(AppThrottlerGuard)
  @Throttle(CHAT_LIMIT)
  async send(
    @CurrentUser() current: AuthUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(SendMessageRequestSchema)) body: SendMessageRequest,
    @Res() res: Response,
  ): Promise<void> {
    await this.conversations.assertOwned(current.userId, id);

    const abort = new AbortController();
    const onClose = () => abort.abort();
    res.on('close', onClose);
    try {
      for await (const event of this.chat.send(id, body.content, abort.signal)) {
        if (abort.signal.aborted) break;
        if (!res.headersSent) {
          res.status(200);
          res.setHeader('Content-Type', 'text/event-stream');
          res.setHeader('Cache-Control', 'no-cache');
          res.setHeader('Connection', 'keep-alive');
          res.flushHeaders();
        }
        res.write(`event: ${event.event}\ndata: ${JSON.stringify(event.data)}\n\n`);
      }
      if (!abort.signal.aborted) res.end();
    } catch (error) {
      // 流还没开始：交给全局异常过滤器，按普通 JSON 错误返回。
      if (!res.headersSent && !abort.signal.aborted) throw error;
      this.logger.error(error);
      if (!abort.signal.aborted) res.end();
    } finally {
      res.off('close', onClose);
    }
  }
}
