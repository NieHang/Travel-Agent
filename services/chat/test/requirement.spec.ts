import 'reflect-metadata';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { RequirementResult } from '@autix/contracts';
import { RequirementService } from '../src/llm/requirement.service.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { AccessTokenService } from '../src/auth/access-token.service.js';
import { loadAuthConfig } from '../src/config/auth.config.js';

describe('requirement extraction', () => {
  const input = '用户注册时必须绑定手机号，密码至少8位';
  let server: Server;
  let app: INestApplication;
  let auth: [string, string];
  let service: RequirementService;
  let modelResult: RequirementResult;
  let messages: Array<{ role: string; content: string }>;
  let modelRequests = 0;

  beforeAll(async () => {
    server = createServer(async (req, res) => {
      let raw = '';
      for await (const chunk of req) raw += chunk;
      const body = JSON.parse(raw);
      messages = body.messages;
      modelRequests++;
      const name = body.tools?.[0]?.function.name;
      res.setHeader('Content-Type', 'application/json');
      res.end(
        JSON.stringify({
          id: 'test',
          object: 'chat.completion',
          choices: [
            {
              index: 0,
              message: {
                role: 'assistant',
                content: name ? null : JSON.stringify(modelResult),
                ...(name
                  ? {
                      tool_calls: [
                        {
                          id: 'call_test',
                          type: 'function',
                          function: {
                            name,
                            arguments: JSON.stringify(modelResult),
                          },
                        },
                      ],
                    }
                  : {}),
              },
              finish_reason: name ? 'tool_calls' : 'stop',
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
    const { AppModule } = await import('../src/app.module.js');
    const module = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(PrismaService)
      .useValue({})
      .compile();
    service = module.get(RequirementService);
    app = module.createNestApplication();
    await app.init();
  });

  beforeEach(() => {
    modelResult = {
      requirements: [
        {
          action: '绑定手机号',
          constraints: ['用户注册时必须绑定手机号'],
          entities: ['用户', '手机号'],
        },
        {
          action: '设置密码',
          constraints: ['密码至少8位'],
          entities: ['密码'],
        },
      ],
    };
  });

  afterAll(async () => {
    await app?.close();
    if (server)
      await new Promise<void>((resolve) => server.close(() => resolve()));
    vi.unstubAllEnvs();
  });

  it('extracts structured JSON through the injectable service', async () => {
    expect(await service.extract(input)).toEqual(modelResult);
    expect(messages.at(-1)?.content).toContain(input);
  });

  it('POST /requirement/extract returns the model result and uses the supplied input', async () => {
    await request(app.getHttpServer())
      .post('/requirement/extract')
      .set(...auth)
      .send({ input })
      .expect(201)
      .expect(modelResult);
    expect(messages.at(-1)?.content).toContain(input);
    expect(messages[0]?.content).toContain('不允许编造信息');
  });

  it('returns an empty requirements array when nothing is extracted', async () => {
    modelResult = { requirements: [] };
    await request(app.getHttpServer())
      .post('/requirement/extract')
      .set(...auth)
      .send({ input: '' })
      .expect(201)
      .expect({ requirements: [] });
  });

  it.each([{}, { input: null }, { input: 123 }, { input: [] }])(
    'rejects invalid input %j before calling the model',
    async (body) => {
      const requestsBefore = modelRequests;
      await request(app.getHttpServer())
        .post('/requirement/extract')
        .set(...auth)
        .send(body)
        .expect(400);
      expect(modelRequests).toBe(requestsBefore);
    },
  );
});
