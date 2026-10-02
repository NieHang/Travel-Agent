import {
  Body,
  Controller,
  Delete,
  Get,
  Inject,
  Param,
  Post,
} from '@nestjs/common';
import { TrimmedMemoryService } from './trimmed-memory.service.js';

@Controller('api/memory')
export class MemoryController {
  constructor(
    @Inject(TrimmedMemoryService) private readonly memory: TrimmedMemoryService,
  ) {}

  @Post('chat')
  chat(@Body() body: { sessionId: string; input: string }) {
    return this.memory.chat(body?.sessionId, body?.input);
  }

  @Get('history/:sessionId')
  async getHistory(@Param('sessionId') sessionId: string) {
    return (await this.memory.getHistory(sessionId)).map((message) => ({
      role: message.getType(),
      content: message.content,
    }));
  }

  @Delete('history/:sessionId')
  async clearSession(@Param('sessionId') sessionId: string) {
    await this.memory.clearSession(sessionId);
    return { cleared: true };
  }
}
