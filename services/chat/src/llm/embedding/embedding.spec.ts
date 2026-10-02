import 'reflect-metadata';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';

// Keep the vector store and HTTP stack real; replace only model downloads/inference.
const runtime = vi.hoisted(() => ({ loads: 0, failLoad: false }));
vi.mock('@xenova/transformers', () => ({
  pipeline: async (task: string, model: string) => {
    runtime.loads++;
    if (runtime.failLoad) throw new Error('model unavailable');
    if (
      task !== 'feature-extraction' ||
      model !== 'Xenova/paraphrase-multilingual-MiniLM-L12-v2'
    ) {
      throw new Error('wrong embedding model');
    }
    return async (
      texts: string[],
      options: { pooling: string; normalize: boolean },
    ) => {
      if (options.pooling !== 'mean' || !options.normalize)
        throw new Error('wrong pooling');
      return {
        tolist: () =>
          texts.map((text) =>
            text.includes('验收')
              ? [0, 1, 0]
              : text.includes('约束')
                ? [0, 0, 1]
                : [1, 0, 0],
          ),
      };
    };
  },
}));

describe('local embeddings and vector HTTP API', () => {
  let app: INestApplication;

  beforeEach(() => {
    runtime.loads = 0;
    runtime.failLoad = false;
  });

  afterEach(async () => {
    await app?.close();
  });

  it('shares one model load across concurrent query/document embeddings and preserves order', async () => {
    const { EmbeddingService } = await import('./embedding.service.js');
    const embeddings = new EmbeddingService();
    const [query, documents] = await Promise.all([
      embeddings.embedQuery('验收测试'),
      embeddings.embedDocuments(['需求规范', '约束说明']),
    ]);
    expect(query).toEqual([0, 1, 0]);
    expect(documents).toEqual([
      [1, 0, 0],
      [0, 0, 1],
    ]);
    expect(runtime.loads).toBe(1);
    expect(await embeddings.embedDocuments([])).toEqual([]);
  });

  it('retries initialization after a model download failure', async () => {
    const { EmbeddingService } = await import('./embedding.service.js');
    const embeddings = new EmbeddingService();
    runtime.failLoad = true;
    await expect(embeddings.embedQuery('验收测试')).rejects.toThrow(
      'model unavailable',
    );
    runtime.failLoad = false;
    expect(await embeddings.embedQuery('验收测试')).toEqual([0, 1, 0]);
  });

  it('seeds once during concurrent searches, ranks documents, and retains added texts', async () => {
    const { EmbeddingService } = await import('./embedding.service.js');
    const { VectorStoreService } = await import('./vector-store.service.js');
    const store = new VectorStoreService(new EmbeddingService());
    const [first, all] = await Promise.all([
      store.search('验收', 1),
      store.search('验收', 10),
    ]);
    expect(first).toHaveLength(1);
    expect(first[0].pageContent).toContain('验收标准');
    expect(all).toHaveLength(3);
    await store.addTexts(['新增验收文档']);
    const results = await store.search('验收', 10);
    expect(results).toHaveLength(4);
    expect(results.map((doc) => doc.pageContent)).toContain('新增验收文档');
  });

  async function createApp() {
    const { LlmModule } = await import('../llm.module.js');
    const module = await Test.createTestingModule({
      imports: [LlmModule],
    }).compile();
    app = module.createNestApplication();
    await app.init();
    return request(app.getHttpServer());
  }

  it('exposes embedding dimensions, stores texts and returns the top k documents', async () => {
    const api = await createApp();
    expect(runtime.loads).toBe(0);
    await api
      .post('/api/embedding/embed')
      .send({ text: '验收' })
      .expect(201)
      .expect({ dimensions: 3, vector: [0, 1, 0] });
    await api
      .post('/api/embedding/store')
      .send({ texts: ['新增验收文档'] })
      .expect(201)
      .expect({ added: 1 });
    const response = await api
      .post('/api/embedding/search')
      .send({ query: '验收', k: 2 })
      .expect(201);
    expect(response.body).toHaveLength(2);
    expect(
      response.body.map((doc: { pageContent: string }) => doc.pageContent),
    ).toContain('新增验收文档');
  });

  it('rejects malformed inputs before loading the model', async () => {
    const api = await createApp();
    for (const text of [undefined, '', '  ', 42]) {
      await api.post('/api/embedding/embed').send({ text }).expect(400);
    }
    for (const texts of [undefined, [], ['ok', ' '], 'text', [12]]) {
      await api.post('/api/embedding/store').send({ texts }).expect(400);
    }
    for (const k of [undefined, 0, -1, 1.5, '2']) {
      await api
        .post('/api/embedding/search')
        .send({ query: '验收', k })
        .expect(400);
    }
    await api
      .post('/api/embedding/search')
      .send({ query: ' ', k: 1 })
      .expect(400);
    expect(runtime.loads).toBe(0);
  });
});
