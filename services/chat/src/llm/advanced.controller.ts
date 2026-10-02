import {
  Body,
  Controller,
  Delete,
  Get,
  Inject,
  Param,
  Post,
} from '@nestjs/common';
import { AdvancedAnalysisService } from './advanced-analysis.service.js';
import { OrchestratorService } from './agents/orchestrator.service.js';
import { EmbeddingService } from './embedding/embedding.service.js';
import { VectorStoreService } from './embedding/vector-store.service.js';
import { FilesystemService } from './filesystem/filesystem.service.js';
import { TrimmedMemoryService } from './memory/trimmed-memory.service.js';

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

@Controller('api/files')
export class FilesystemController {
  constructor(
    @Inject(FilesystemService) private readonly filesystem: FilesystemService,
  ) {}

  @Post('chat')
  chat(@Body() body: { input?: string } = {}) {
    return this.filesystem.chat(body?.input ?? '');
  }
}

@Controller('api/embedding')
export class EmbeddingController {
  constructor(
    @Inject(EmbeddingService) private readonly embeddings: EmbeddingService,
    @Inject(VectorStoreService)
    private readonly vectorStore: VectorStoreService,
  ) {}

  @Post('embed')
  async embed(@Body() body: { text: string }) {
    const vector = await this.embeddings.embedQuery(body?.text);
    return { dimensions: vector.length, vector };
  }

  @Post('store')
  async store(@Body() body: { texts: string[] }) {
    await this.vectorStore.addTexts(body?.texts);
    return { added: body.texts.length };
  }

  @Post('search')
  search(@Body() body: { query: string; k: number }) {
    return this.vectorStore.search(body?.query, body?.k);
  }
}

@Controller('api/agents')
export class AgentsController {
  constructor(
    @Inject(OrchestratorService)
    private readonly orchestrator: OrchestratorService,
  ) {}

  @Post('orchestrate')
  orchestrate(@Body() body: { input: string }) {
    return this.orchestrator.orchestrate(body?.input);
  }
}

@Controller('api/advanced')
export class AdvancedController {
  constructor(
    @Inject(AdvancedAnalysisService)
    private readonly analysis: AdvancedAnalysisService,
  ) {}

  @Post('analyze')
  analyze(@Body() body: { sessionId: string; input: string }) {
    return this.analysis.analyze(body?.sessionId, body?.input);
  }
}
