import 'reflect-metadata';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';

const input = '用户注册时必须绑定手机号，密码至少8位';
const toolCalls = [
  {
    id: 'constraint_1',
    type: 'function',
    function: {
      name: 'check_constraint_validity',
      arguments: JSON.stringify({ constraint: '密码至少8位', input }),
    },
  },
  {
    id: 'entity_1',
    type: 'function',
    function: {
      name: 'lookup_entity_definition',
      arguments: JSON.stringify({ entity: '手机号' }),
    },
  },
];
type WireMessage = {
  role: string;
  content: string;
  tool_call_id?: string;
  tool_calls?: unknown[];
};
type ModelRequest = {
  messages: WireMessage[];
  tools: Array<{ function: { name: string; parameters: object } }>;
};

describe('requirement tool routes', () => {
  let server: Server;
  let app: INestApplication;
  let requests: ModelRequest[];
  let scenario:
    | 'normal'
    | 'no-tools'
    | 'repeat'
    | 'unknown'
    | 'bad-args'
    | 'invalid-json'
    | 'wrong-source';

  beforeAll(async () => {
    server = createServer(async (req, res) => {
      let raw = '';
      for await (const chunk of req) raw += chunk;
      const body: ModelRequest = JSON.parse(raw);
      requests.push(body);
      const hasResults = body.messages.some(
        (message) => message.role === 'tool',
      );
      let calls = toolCalls;
      if (scenario === 'unknown')
        calls = [
          {
            ...toolCalls[0],
            function: { name: 'unknown_tool', arguments: '{}' },
          },
        ];
      if (scenario === 'bad-args')
        calls = [
          {
            ...toolCalls[0],
            function: {
              name: 'check_constraint_validity',
              arguments: '{"constraint":42}',
            },
          },
        ];
      if (scenario === 'invalid-json')
        calls = [
          {
            ...toolCalls[0],
            function: { name: 'check_constraint_validity', arguments: '{' },
          },
        ];
      if (scenario === 'wrong-source')
        calls = [
          {
            ...toolCalls[0],
            function: {
              name: 'check_constraint_validity',
              arguments: JSON.stringify({
                constraint: '必须绑定手机号',
                input: '必须绑定手机号',
              }),
            },
          },
        ];
      const callTools =
        scenario !== 'no-tools' && (!hasResults || scenario === 'repeat');
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
                content: callTools ? null : '{"requirements":[]}',
                ...(callTools ? { tool_calls: calls } : {}),
              },
              finish_reason: callTools ? 'tool_calls' : 'stop',
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

  beforeEach(() => {
    requests = [];
    scenario = 'normal';
  });
  afterAll(async () => {
    await app?.close();
    if (server)
      await new Promise<void>((resolve) => server.close(() => resolve()));
    vi.unstubAllEnvs();
  });

  it('tool-bind sends both schemas and returns calls without executing them', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/langchain/tool-bind')
      .send({ input })
      .expect(201);
    expect(response.body.tool_calls).toEqual([
      {
        name: 'check_constraint_validity',
        args: { constraint: '密码至少8位', input },
        id: 'constraint_1',
        type: 'tool_call',
      },
      {
        name: 'lookup_entity_definition',
        args: { entity: '手机号' },
        id: 'entity_1',
        type: 'tool_call',
      },
    ]);
    expect(requests).toHaveLength(1);
    expect(requests[0].tools.map((entry) => entry.function.name)).toEqual([
      'check_constraint_validity',
      'lookup_entity_definition',
    ]);
    expect(
      requests[0].tools.every(
        (entry) => 'properties' in entry.function.parameters,
      ),
    ).toBe(true);
    expect(requests[0].messages[0].content).toContain('不允许编造信息');
    expect(requests[0].messages.at(-1)?.content).toContain(input);
  });

  it('tool-loop feeds back every result with the assistant calls and matching IDs', async () => {
    await request(app.getHttpServer())
      .post('/api/langchain/tool-loop')
      .send({ input })
      .expect(201)
      .expect({ content: '{"requirements":[]}' });
    expect(requests).toHaveLength(2);
    const messages = requests[1].messages;
    const assistantIndex = messages.findIndex(
      (message) => message.role === 'assistant',
    );
    expect(assistantIndex).toBeGreaterThan(0);
    expect(messages[assistantIndex].tool_calls).toHaveLength(2);
    expect(
      messages
        .slice(assistantIndex + 1)
        .every((message) => message.role === 'tool'),
    ).toBe(true);
    const results = messages.filter((message) => message.role === 'tool');
    expect(results.map((message) => message.tool_call_id)).toEqual([
      'constraint_1',
      'entity_1',
    ]);
    expect(JSON.parse(results[0].content)).toMatchObject({ valid: true });
    expect(JSON.parse(results[1].content)).toMatchObject({
      found: true,
      entity: '手机号',
      definition: expect.any(String),
    });
  });

  it.each(['tool-bind', 'tool-loop'])(
    '%s returns immediately when the model needs no tools',
    async (route) => {
      scenario = 'no-tools';
      const response = await request(app.getHttpServer())
        .post(`/api/langchain/${route}`)
        .send({ input })
        .expect(201);
      expect(response.body.content).toBe('{"requirements":[]}');
      expect(requests).toHaveLength(1);
      if (route === 'tool-bind') expect(response.body.tool_calls).toEqual([]);
    },
  );

  it('supports the same default requirement example as existing demonstration routes', async () => {
    await request(app.getHttpServer())
      .post('/api/langchain/tool-bind')
      .expect(201);
    expect(requests[0].messages.at(-1)?.content).toContain(input);
  });

  it.each(['tool-bind', 'tool-loop'])(
    '%s rejects non-string input before calling the model',
    async (route) => {
      await request(app.getHttpServer())
        .post(`/api/langchain/${route}`)
        .send({ input: 42 })
        .expect(400);
      expect(requests).toHaveLength(0);
    },
  );

  it.each(['unknown', 'bad-args'] as const)(
    'returns %s tool errors to the model for recovery',
    async (value) => {
      scenario = value;
      await request(app.getHttpServer())
        .post('/api/langchain/tool-loop')
        .send({ input })
        .expect(201);
      expect(requests).toHaveLength(2);
      const result = requests[1].messages.find(
        (message) => message.role === 'tool',
      )!;
      expect(result.tool_call_id).toBe('constraint_1');
      expect(JSON.parse(result.content)).toMatchObject({
        error: expect.any(String),
      });
    },
  );

  it('rejects unparseable model tool calls instead of treating them as completion', async () => {
    scenario = 'invalid-json';
    await request(app.getHttpServer())
      .post('/api/langchain/tool-loop')
      .send({ input })
      .expect(502);
    expect(requests).toHaveLength(1);
  });

  it('grounds constraint checks in the request even when the model supplies different source text', async () => {
    scenario = 'wrong-source';
    await request(app.getHttpServer())
      .post('/api/langchain/tool-loop')
      .send({ input: '用户注册' })
      .expect(201);
    const result = requests[1].messages.find(
      (message) => message.role === 'tool',
    )!;
    expect(JSON.parse(result.content)).toMatchObject({
      constraint: '必须绑定手机号',
      valid: false,
    });
  });

  it('stops a model that keeps requesting tools at the loop limit', async () => {
    scenario = 'repeat';
    await request(app.getHttpServer())
      .post('/api/langchain/tool-loop')
      .send({ input })
      .expect(502);
    expect(requests.length).toBeGreaterThan(1);
    expect(requests.length).toBeLessThanOrEqual(6);
  });
});
