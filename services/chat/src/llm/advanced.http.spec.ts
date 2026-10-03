import 'reflect-metadata';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { RunnableMemoryService } from './memory/runnable-memory.service.js';
import { TrimmedMemoryService } from './memory/trimmed-memory.service.js';
import type { FilesystemService } from './filesystem/filesystem.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { AccessTokenService } from '../auth/access-token.service.js';
import { loadAuthConfig } from '../config/auth.config.js';

const state = vi.hoisted(() => ({ root: '' }));
vi.mock('./tools/business.tools.js', async (importOriginal) => {
  const original =
    await importOriginal<typeof import('./tools/business.tools.js')>();
  return {
    ...original,
    businessTools: original.createBusinessTools(state.root),
  };
});

const rounds = [
  '我们想做一个需求分析助手，希望它能记住多轮对话',
  '需求单号是 REQ-2026-001',
  '用户注册时必须绑定手机号，密码至少8位',
];
const input = '帮我判断这个需求是否完整，并产出一份需求分析报告';
const report =
  '# 需求分析报告\nREQ-2026-001：手机号绑定、密码至少8位。需求尚缺验收标准。';

describe('advanced analysis HTTP integration', () => {
  let app: INestApplication;
  let server: Server;
  let auth: [string, string];
  let clarification = false;
  let fail = false;
  const calls: Array<{ agent: string; context: string }> = [];

  beforeAll(async () => {
    state.root = await mkdtemp(join(tmpdir(), 'advanced-http-'));
    server = createServer(async (req, res) => {
      let raw = '';
      for await (const chunk of req) raw += chunk;
      const body = JSON.parse(raw) as { messages: Array<{ content: string }> };
      const context = body.messages
        .map((message) => message.content)
        .join('\n');
      const agent = /AGENT:(\w+)/.exec(context)?.[1] ?? 'memory';
      calls.push({ agent, context });
      const replies: Record<string, string> = {
        memory: '已记录需求信息',
        extract: JSON.stringify({
          goal: '需求分析助手',
          users: [],
          features: ['手机号绑定'],
          constraints: ['密码至少8位'],
          unknowns: ['验收标准'],
        }),
        clarify: JSON.stringify({
          needsClarification: clarification,
          clarificationQuestions: clarification ? ['目标用户是谁？'] : [],
        }),
        analysis: '需求尚缺验收标准。',
        risk: '需要确认密码安全规则。',
        summary: report,
      };
      res.setHeader('Content-Type', 'application/json');
      res.end(
        JSON.stringify({
          id: 'advanced-test',
          object: 'chat.completion',
          choices: [
            {
              index: 0,
              message: {
                role: 'assistant',
                content:
                  fail && agent === 'extract' ? 'invalid JSON' : replies[agent],
              },
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
    vi.stubEnv('JWT_ACCESS_SECRET', 'test-access-secret-at-least-32-chars-long');
    auth = [
      'Authorization',
      `Bearer ${await new AccessTokenService(loadAuthConfig()).sign('test-user')}`,
    ];
    const { AppModule } = await import('../app.module.js');
    const module = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(PrismaService)
      .useValue({})
      .compile();
    app = module.createNestApplication();
    app.useLogger(false);
    await app.init();
  });

  beforeEach(() => {
    calls.length = 0;
    clarification = false;
    fail = false;
  });

  afterEach(() => vi.restoreAllMocks());
  afterAll(async () => {
    await app?.close();
    if (server)
      await new Promise<void>((resolve) => server.close(() => resolve()));
    vi.unstubAllEnvs();
    if (state.root) await rm(state.root, { recursive: true, force: true });
  });

  const analyze = (sessionId: string) =>
    request(app.getHttpServer())
      .post('/api/advanced/analyze')
      .set(...auth)
      .send({ sessionId, input });
  const files = () => readdir(join(state.root, 'reports')).catch(() => []);

  it('uses the first three HTTP turns, saves the full report and appends it without another model call', async () => {
    const sessionId = 'four-rounds';
    for (const input of rounds)
      await request(app.getHttpServer())
        .post('/api/memory/chat')
        .set(...auth)
        .send({ sessionId, input })
        .expect(201);
    await app
      .get(RunnableMemoryService)
      .appendMessage('other-session', '其他会话秘密', '已记录');
    const append = vi.spyOn(app.get(RunnableMemoryService), 'appendMessage');
    const { body } = await analyze(sessionId).expect(201);
    expect(body).toMatchObject({
      status: 'completed',
      report,
      clarificationQuestions: [],
    });
    expect(body.reportPath).toMatch(/^reports\/[A-Za-z0-9-]+-analysis\.md$/);
    expect(await readFile(join(state.root, body.reportPath), 'utf8')).toBe(
      report,
    );
    expect(calls.map((call) => call.agent)).toEqual([
      'memory',
      'memory',
      'memory',
      'extract',
      'clarify',
      'analysis',
      'risk',
      'summary',
    ]);
    const context = calls.find((call) => call.agent === 'extract')!.context;
    for (const turn of [...rounds, input]) expect(context).toContain(turn);
    expect(context).not.toContain('其他会话秘密');
    expect(append).toHaveBeenCalledExactlyOnceWith(sessionId, input, report);
    const { body: history } = await request(app.getHttpServer())
      .get(`/api/memory/history/${sessionId}`)
      .set(...auth)
      .expect(200);
    expect(history).toHaveLength(8);
    expect(history.slice(-2)).toEqual([
      { role: 'human', content: input },
      { role: 'ai', content: report },
    ]);
    expect(
      await app.get(TrimmedMemoryService).getHistory(sessionId),
    ).toHaveLength(8);
  });

  it('returns clarification immediately without saving a report or appending a conclusion', async () => {
    clarification = true;
    const before = await files();
    const { body } = await analyze('clarification').expect(201);
    expect(body).toMatchObject({
      status: 'needs_clarification',
      clarificationQuestions: ['目标用户是谁？'],
      report: null,
    });
    expect(calls.map((call) => call.agent)).toEqual(['extract', 'clarify']);
    expect(await files()).toEqual(before);
    expect(
      await app.get(RunnableMemoryService).getHistory('clarification'),
    ).toEqual([]);
  });

  it('returns failed orchestration without saving or recording success', async () => {
    fail = true;
    const before = await files();
    const { body } = await analyze('failed').expect(201);
    expect(body).toMatchObject({
      status: 'failed',
      fallback: 'manual_review',
      report: null,
    });
    expect(await files()).toEqual(before);
    expect(await app.get(RunnableMemoryService).getHistory('failed')).toEqual(
      [],
    );
  });

  it('does not append a conclusion if saving the report fails', async () => {
    const { FilesystemService: Service } =
      await import('./filesystem/filesystem.service.js');
    vi.spyOn(
      app.get<FilesystemService>(Service),
      'writeReport',
    ).mockRejectedValueOnce(new Error('disk full'));
    await analyze('write-failed').expect(500);
    expect(
      await app.get(RunnableMemoryService).getHistory('write-failed'),
    ).toEqual([]);
    expect(calls.map((call) => call.agent)).toEqual([
      'extract',
      'clarify',
      'analysis',
      'risk',
      'summary',
    ]);
  });

  it.each([
    {},
    { sessionId: '', input },
    { sessionId: 1, input },
    { sessionId: 'invalid', input: '' },
    { sessionId: 'invalid', input: 1 },
    null,
  ])('rejects invalid analyze bodies: %j', async (body) => {
    await request(app.getHttpServer())
      .post('/api/advanced/analyze')
      .set(...auth)
      .send(body ?? undefined)
      .expect(400);
    expect(calls).toEqual([]);
  });
});
