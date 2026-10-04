import { createHash } from 'node:crypto';
import { Body, Controller, Inject, Post } from '@nestjs/common';
import { CurrentUser, type AuthUser } from '../../auth/decorators.js';
import { ZodValidationPipe } from '../../common/zod-validation.pipe.js';
import { actionRequestSchema, chatRequestSchema } from './ui-schemas.js';
import { UIFlowService } from './ui-flow.service.js';
import type { AIUIResponse, UIAction } from './ui-types.js';

@Controller('api/ui-chat')
export class UIChatController {
  constructor(@Inject(UIFlowService) private readonly flow: UIFlowService) {}

  @Post('chat')
  chat(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(chatRequestSchema))
    body: { sessionId: string; input: string },
  ): Promise<AIUIResponse> {
    return this.flow.chat(this.scope(user, body.sessionId), body.input);
  }

  @Post('action')
  action(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(actionRequestSchema))
    body: { sessionId: string; action: UIAction },
  ): Promise<AIUIResponse> {
    return this.flow.handleAction(
      this.scope(user, body.sessionId),
      body.action,
    );
  }

  private scope(user: AuthUser, sessionId: string): string {
    // Hash the unambiguous tuple so maximum-length client IDs fit the service limit.
    return createHash('sha256')
      .update(JSON.stringify([user.userId, sessionId]))
      .digest('hex');
  }
}
