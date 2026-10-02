import { BadRequestException, Injectable } from '@nestjs/common';
import { Embeddings } from '@langchain/core/embeddings';
import type { FeatureExtractionPipeline } from '@xenova/transformers';

@Injectable()
export class EmbeddingService extends Embeddings {
  private extractor?: Promise<FeatureExtractionPipeline>;

  constructor() {
    super({});
  }

  private getExtractor(): Promise<FeatureExtractionPipeline> {
    // Share initialization across concurrent requests; allow retry on download failure.
    this.extractor ??= import('@xenova/transformers')
      .then(({ pipeline }) =>
        pipeline(
          'feature-extraction',
          'Xenova/paraphrase-multilingual-MiniLM-L12-v2',
        ),
      )
      .catch((error: unknown) => {
        this.extractor = undefined;
        throw error;
      });
    return this.extractor;
  }

  async embedQuery(text: string): Promise<number[]> {
    const [vector] = await this.embedDocuments([text]);
    return vector;
  }

  async embedDocuments(documents: string[]): Promise<number[][]> {
    if (
      !Array.isArray(documents) ||
      documents.some((text) => typeof text !== 'string' || !text.trim())
    ) {
      throw new BadRequestException('documents must contain non-empty strings');
    }
    if (documents.length === 0) return [];
    const extractor = await this.getExtractor();
    const output = await extractor(documents, {
      pooling: 'mean',
      normalize: true,
    });
    return output.tolist() as number[][];
  }
}
