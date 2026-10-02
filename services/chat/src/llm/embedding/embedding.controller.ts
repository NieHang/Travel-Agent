import { Body, Controller, Inject, Post } from '@nestjs/common';
import { EmbeddingService } from './embedding.service.js';
import { VectorStoreService } from './vector-store.service.js';

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
