import 'reflect-metadata';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { RequirementSchema, RequirementResultSchema } from '@autix/contracts';

describe('structured requirement route', () => {
  let server: Server;
  let app: INestApplication;
  let modelResult: object;
  let messages: Array<{ role: string; content: string }>;

  beforeAll(async () => {
    server = createServer(async (req, res) => {
      let raw = '';
      for await (const chunk of req) raw += chunk;
      const body = JSON.parse(raw);
      messages = body.messages;
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
    const { LlmModule } = await import('./llm.module.js');
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

  it('returns fixed fields and sends the supplied input with the extraction instructions', async () => {
    modelResult = {
      requirements: [
        {
          action: '绑定手机号',
          constraints: ['用户注册时必须绑定手机号', '密码至少8位'],
          entities: ['用户', '手机号', '密码'],
        },
      ],
    };
    await request(app.getHttpServer())
      .post('/api/langchain/structured')
      .send({ input: '用户注册时必须绑定手机号，密码至少8位' })
      .expect(201)
      .expect(modelResult);
    expect(messages[0]?.content).toContain('不允许编造信息');
    expect(messages.at(-1)?.content).toContain(
      '用户注册时必须绑定手机号，密码至少8位',
    );
  });

  it('returns empty requirements when no requirement is extracted', async () => {
    modelResult = { requirements: [] };
    await request(app.getHttpServer())
      .post('/api/langchain/structured')
      .send({ input: '' })
      .expect(201)
      .expect({ requirements: [] });
  });

  it('the shared schema rejects incorrect types and missing required fields', () => {
    expect(
      RequirementResultSchema.safeParse({
        requirements: [
          { action: '注册', constraints: '必须绑定手机号', entities: [] },
        ],
      }).success,
    ).toBe(false);
    expect(
      RequirementSchema.safeParse({ action: '注册', constraints: [] }).success,
    ).toBe(false);
    expect(
      RequirementSchema.safeParse({
        action: '注册',
        constraints: [],
        entities: [],
      }).success,
    ).toBe(true);
  });
});
