import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { Document } from '@langchain/core/documents';
import { MemoryVectorStore } from '@langchain/classic/vectorstores/memory';
import { EmbeddingService } from './embedding.service.js';

// Example fragments; replace these with actual business standards when available.
const initialDocuments = [
  new Document({
    pageContent:
      '需求规范片段：需求应明确执行主体、动作及可验证的约束。分析应以需求单原文为依据，不得编造缺失的业务规则。',
    metadata: { category: '需求规范' },
  }),
  new Document({
    pageContent:
      '验收标准片段：每项需求应提供可验证的验收标准，说明前置条件、操作步骤和预期结果，覆盖正常流程、边界条件及异常情况。',
    metadata: { category: '验收标准' },
  }),
  new Document({
    pageContent:
      '约束说明片段：约束应明确适用对象、限制条件与判断依据。将明确约束、待澄清问题与分析建议分别表述，不得将建议当作已有业务规则。',
    metadata: { category: '约束说明' },
  }),
];

@Injectable()
export class VectorStoreService {
  private readonly store: MemoryVectorStore;
  private initialized?: Promise<void>;

  constructor(@Inject(EmbeddingService) embeddings: EmbeddingService) {
    this.store = new MemoryVectorStore(embeddings);
  }

  private ensureInitialized(): Promise<void> {
    // Seed before the first operation without blocking unrelated chat routes at startup.
    this.initialized ??= this.store
      .addDocuments(initialDocuments)
      .catch((error: unknown) => {
        this.initialized = undefined;
        throw error;
      });
    return this.initialized;
  }

  async addTexts(texts: string[]): Promise<void> {
    if (
      !Array.isArray(texts) ||
      texts.length === 0 ||
      texts.some((text) => typeof text !== 'string' || !text.trim())
    ) {
      throw new BadRequestException(
        'texts must be a non-empty array of non-empty strings',
      );
    }
    await this.ensureInitialized();
    await this.store.addDocuments(
      texts.map((pageContent) => new Document({ pageContent })),
    );
  }

  async search(query: string, k: number): Promise<Document[]> {
    if (typeof query !== 'string' || !query.trim()) {
      throw new BadRequestException('query must be a non-empty string');
    }
    if (!Number.isSafeInteger(k) || k < 1) {
      throw new BadRequestException('k must be a positive integer');
    }
    await this.ensureInitialized();
    return this.store.similaritySearch(query, k);
  }
}
