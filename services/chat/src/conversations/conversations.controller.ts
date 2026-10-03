import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Inject,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import {
  CreateConversationRequestSchema,
  ListConversationsQuerySchema,
  ListMessagesQuerySchema,
  RenameConversationRequestSchema,
  type Conversation,
  type CreateConversationRequest,
  type ListConversationsQuery,
  type ListMessagesQuery,
  type Message,
  type Page,
  type RenameConversationRequest,
} from '@autix/contracts';
import { CurrentUser, type AuthUser } from '../auth/decorators.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { ConversationsService } from './conversations.service.js';

@Controller('api/conversations')
export class ConversationsController {
  constructor(@Inject(ConversationsService) private readonly conversations: ConversationsService) {}

  @Get()
  list(
    @CurrentUser() current: AuthUser,
    @Query(new ZodValidationPipe(ListConversationsQuerySchema)) query: ListConversationsQuery,
  ): Promise<Page<Conversation>> {
    return this.conversations.list(current.userId, query);
  }

  @Post()
  create(
    @CurrentUser() current: AuthUser,
    @Body(new ZodValidationPipe(CreateConversationRequestSchema)) body: CreateConversationRequest,
  ): Promise<Conversation> {
    return this.conversations.create(current.userId, body.title);
  }

  @Patch(':id')
  rename(
    @CurrentUser() current: AuthUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(RenameConversationRequestSchema)) body: RenameConversationRequest,
  ): Promise<Conversation> {
    return this.conversations.rename(current.userId, id, body.title);
  }

  @Delete(':id')
  @HttpCode(204)
  remove(@CurrentUser() current: AuthUser, @Param('id') id: string): Promise<void> {
    return this.conversations.remove(current.userId, id);
  }

  @Get(':id/messages')
  listMessages(
    @CurrentUser() current: AuthUser,
    @Param('id') id: string,
    @Query(new ZodValidationPipe(ListMessagesQuerySchema)) query: ListMessagesQuery,
  ): Promise<Page<Message>> {
    return this.conversations.listMessages(current.userId, id, query);
  }
}
