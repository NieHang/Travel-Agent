import 'reflect-metadata';
import { createRequire } from 'node:module';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { RunnableMemoryService } from './runnable-memory.service.js';
import { TrimmedMemoryService } from './trimmed-memory.service.js';

describe('requirement memory', () => {
  let server: Server;
  let app: INestApplication;
  let messages: Array<{ role: string; content: string }>;
  let fail = false;
  const rounds = [
    '我们想做一个需求分析助手，希望它能记住多轮对话',
    '需求单号是 REQ-2026-001',
    '帮我判断这个需求是否完整',
  ];

  beforeAll(async () => {
    server = createServer(async (req, res) => {
      let raw = '';
      for await (const chunk of req) raw += chunk;
      messages = JSON.parse(raw).messages;
      res.setHeader('Content-Type', 'application/json');
      if (fail) {
        res.statusCode = 400;
        res.end(JSON.stringify({ error: { message: 'test failure' } }));
        return;
      }
      res.end(
        JSON.stringify({
          id: 'memory-test',
          object: 'chat.completion',
          choices: [
            {
              index: 0,
              message: { role: 'assistant', content: '需求尚缺验收标准' },
              finish_reason: 'stop',
            },
          ],
        }),
      );
    });
    await new Promise<void>((resolve) =>
      server.listen(0, '127.0.0.1', resolve),
    );
    vi.stubEnv('OPENAI_API_KEY', 'local-test-key');
    vi.stubEnv(
      'OPENAI_BASE_URL',
      `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`,
    );
    vi.stubEnv('HTTPS_PROXY', '');
    vi.stubEnv('HTTP_PROXY', '');
    const { LlmModule } = await import('../llm.module.js');
    const module = await Test.createTestingModule({
      imports: [LlmModule],
    }).compile();
    app = module.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app?.close();
    if (server)
      await new Promise<void>((resolve) => server.close(() => resolve()));
    vi.unstubAllEnvs();
  });

  describe.each([RunnableMemoryService, TrimmedMemoryService])(
    '%s',
    (Service) => {
      let service: RunnableMemoryService;
      beforeEach(async () => {
        service = app.get(Service);
        fail = false;
        await service.clearSession('s1');
        await service.clearSession('s2');
      });

      it('sends all previous turns and the requirement ID on the third turn', async () => {
        for (const input of rounds) await service.chat('s1', input);
        expect(messages.map((message) => message.content).slice(1)).toEqual([
          rounds[0],
          '需求尚缺验收标准',
          rounds[1],
          '需求尚缺验收标准',
          rounds[2],
        ]);
        expect(await service.getHistory('s1')).toHaveLength(6);
        await service.chat('s2', '新的需求');
        expect(messages.map((message) => message.content).slice(1)).toEqual([
          '新的需求',
        ]);
      });

      it('appends a pair and clears only the selected session', async () => {
        await service.appendMessage('s1', '需求单号 REQ-2026-001', '已记录');
        await service.appendMessage('s2', '另一需求', '待补充');
        await service.chat('s1', '单号是什么');
        expect(messages[1].content).toBe('需求单号 REQ-2026-001');
        await service.clearSession('s1');
        expect(await service.getHistory('s1')).toEqual([]);
        expect(await service.getHistory('s2')).toHaveLength(2);
      });

      it('serializes concurrent turns for the same session', async () => {
        await Promise.all(rounds.map((input) => service.chat('s1', input)));
        expect(
          (await service.getHistory('s1'))
            .filter((m) => m.getType() === 'human')
            .map((m) => m.content),
        ).toEqual(rounds);
        expect(messages.map((m) => m.content).slice(1)).toEqual([
          rounds[0],
          '需求尚缺验收标准',
          rounds[1],
          '需求尚缺验收标准',
          rounds[2],
        ]);
      });

      it('does not record failed model calls and allows the next turn', async () => {
        fail = true;
        await expect(service.chat('s1', '失败的请求')).rejects.toThrow();
        expect(await service.getHistory('s1')).toEqual([]);
        fail = false;
        await service.chat('s1', '重试');
        expect(await service.getHistory('s1')).toHaveLength(2);
      });
    },
  );

  it('trims old turns to 2000 tokens, keeps recent turns, and preserves stored history', async () => {
    const service = app.get(TrimmedMemoryService);
    await service.clearSession('trim');
    await service.appendMessage('trim', 'old '.repeat(2500), 'old answer');
    await service.appendMessage('trim', '需求单号是 REQ-2026-001', '已记录');
    await service.chat('trim', rounds[2]);
    expect(messages.map((m) => m.content).slice(1)).toEqual([
      '需求单号是 REQ-2026-001',
      '已记录',
      rounds[2],
    ]);
    const requireFromCore = createRequire(
      import.meta.resolve('@langchain/core/messages'),
    );
    const tokenizer = requireFromCore('js-tiktoken').getEncoding('o200k_base');
    const tokens =
      3 +
      messages.reduce(
        (sum, m) =>
          sum +
          3 +
          tokenizer.encode(m.role).length +
          tokenizer.encode(m.content).length,
        0,
      );
    expect(tokens).toBeLessThanOrEqual(2000);
    expect(await service.getHistory('trim')).toHaveLength(6);
  });

  it('exposes chat, history, and deletion over HTTP', async () => {
    await request(app.getHttpServer())
      .delete('/api/memory/history/http')
      .expect(200);
    for (const input of rounds) {
      await request(app.getHttpServer())
        .post('/api/memory/chat')
        .send({ sessionId: 'http', input })
        .expect(201)
        .expect({ content: '需求尚缺验收标准' });
    }
    const response = await request(app.getHttpServer())
      .get('/api/memory/history/http')
      .expect(200);
    expect(response.body).toHaveLength(6);
    expect(response.body[2]).toEqual({ role: 'human', content: rounds[1] });
    await request(app.getHttpServer())
      .delete('/api/memory/history/http')
      .expect(200)
      .expect({ cleared: true });
    await request(app.getHttpServer())
      .get('/api/memory/history/http')
      .expect(200)
      .expect([]);
  });

  it('drops older complete turns when their combined size exceeds the budget', async () => {
    const service = app.get(TrimmedMemoryService);
    await service.appendMessage(
      'boundary',
      'old '.repeat(1600),
      'previous answer',
    );
    await service.appendMessage(
      'boundary',
      'recent '.repeat(600),
      'recent answer',
    );
    await service.chat('boundary', '判断完整性');
    expect(messages.map((m) => m.content).slice(1)).toEqual([
      'recent '.repeat(600),
      'recent answer',
      '判断完整性',
    ]);
  });

  it('keeps full history in the untrimmed version', async () => {
    const service = app.get(RunnableMemoryService);
    await service.appendMessage('full', 'old '.repeat(2500), 'previous answer');
    await service.chat('full', '继续分析');
    expect(messages.map((m) => m.content).slice(1)).toEqual([
      'old '.repeat(2500),
      'previous answer',
      '继续分析',
    ]);
  });

  it('queries and updates history without model credentials and returns a snapshot', async () => {
    const service = app.get(TrimmedMemoryService);
    const apiKey = process.env.OPENAI_API_KEY;
    vi.stubEnv('OPENAI_API_KEY', '');
    try {
      expect(await service.getHistory('absent')).toEqual([]);
      await service.appendMessage('offline', '已知需求', '已记录');
      const history = await service.getHistory('offline');
      history[0].content = '被修改';
      expect((await service.getHistory('offline'))[0].content).toBe('已知需求');
      await service.clearSession('offline');
      expect(await service.getHistory('offline')).toEqual([]);
    } finally {
      vi.stubEnv('OPENAI_API_KEY', apiKey);
    }
  });

  it.each([
    {},
    { sessionId: '', input: 'test' },
    { sessionId: 's1', input: 1 },
    { sessionId: 's1', input: ' ' },
  ])('rejects invalid chat bodies: %j', async (body) => {
    await request(app.getHttpServer())
      .post('/api/memory/chat')
      .send(body)
      .expect(400);
  });

  it('rejects an oversized current input without silently dropping it', async () => {
    const service = app.get(TrimmedMemoryService);
    await service.clearSession('large');
    await expect(service.chat('large', 'word '.repeat(2500))).rejects.toThrow(
      '2000',
    );
    expect(await service.getHistory('large')).toEqual([]);
  });
});
