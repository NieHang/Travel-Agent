import {
  Body,
  Controller,
  Get,
  Inject,
  Logger,
  Param,
  Post,
  Res,
  UseGuards,
} from '@nestjs/common';
import { propagateAttributes, startActiveObservation } from '@langfuse/tracing';
import { Throttle } from '@nestjs/throttler';
import { SendTurnRequestSchema, type SendTurnRequest } from '@autix/contracts';
import type { Response } from 'express';
import { AppThrottlerGuard } from '../auth/app-throttler.guard.js';
import { CurrentUser, type AuthUser } from '../auth/decorators.js';
import { errorName } from '../common/error-name.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { ConversationsService } from '../conversations/conversations.service.js';
import { TurnService } from '../trip/turn.js';

const CHAT_LIMIT = { default: { limit: 20, ttl: 60_000 } };

@Controller('api/conversations')
export class ChatController {
  private readonly logger = new Logger(ChatController.name);

  constructor(
    @Inject(ConversationsService)
    private readonly conversations: ConversationsService,
    @Inject(TurnService) private readonly turns: TurnService,
  ) {}

  @Get(':id/ui-state')
  async uiState(@CurrentUser() current: AuthUser, @Param('id') id: string) {
    await this.conversations.assertOwned(current.userId, id);
    return this.turns.getState(id);
  }

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
    @Body(new ZodValidationPipe(SendTurnRequestSchema))
    body: SendTurnRequest,
    @Res() res: Response,
  ): Promise<void> {
    await this.conversations.assertOwned(current.userId, id);

    const abort = new AbortController();
    const onClose = () => abort.abort();
    res.on('close', onClose);
    // 归属校验期间连接就断开的话，close 事件已经错过了。
    if (res.destroyed || res.closed) abort.abort();
    try {
      // One Langfuse trace per turn, one session per conversation. The model and tool calls of the turn nest under it
      // because the stream is consumed inside this callback. Without the Langfuse keys this records nothing.
      await startActiveObservation('run-trip-turn', (turn) => propagateAttributes(
        { sessionId: id, userId: current.userId, metadata: { command: body.command.type } },
        async () => {
          for await (const event of this.turns.run(id, body, abort.signal)) {
            if (abort.signal.aborted) break;
            if (!res.headersSent) {
              res.status(200);
              res.setHeader('Content-Type', 'text/event-stream');
              res.setHeader('Cache-Control', 'no-cache');
              res.setHeader('Connection', 'keep-alive');
              res.flushHeaders();
            }
            if (event.type === 'start') turn.update({ input: event.userMessage.content });
            if (event.type === 'done') turn.update({ output: event.message.content });
            if (event.type === 'error') turn.update({ output: event.message?.content, level: 'ERROR', statusMessage: event.code });
            res.write(`event: message\ndata: ${JSON.stringify(event)}\n\n`);
          }
        },
      ), { asType: 'agent' });
      if (!abort.signal.aborted) res.end();
    } catch (error) {
      // 流还没开始：交给全局异常过滤器，按普通 JSON 错误返回。
      if (!res.headersSent && !abort.signal.aborted) throw error;
      this.logger.error(
        `Chat stream failed (${errorName(error)}) conversation=${id}`,
      );
      if (!abort.signal.aborted) res.end();
    } finally {
      res.off('close', onClose);
    }
  }
}
