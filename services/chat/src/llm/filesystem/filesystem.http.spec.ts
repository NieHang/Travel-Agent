import 'reflect-metadata';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';

// Exercise real tools in an isolated workspace and the real model client against a local API.
const state = vi.hoisted(() => ({ root: '' }));
vi.mock('../tools/business.tools.js', async (importOriginal) => {
  const original =
    await importOriginal<typeof import('../tools/business.tools.js')>();
  return {
    ...original,
    businessTools: original.createBusinessTools(state.root),
  };
});

type ModelRequest = {
  tools: Array<{
    function: { name: string; parameters: { properties: object } };
  }>;
  messages: Array<{
    role: string;
    content: string;
    tool_call_id?: string;
    tool_calls?: unknown[];
  }>;
};

describe('filesystem HTTP integration', () => {
  let app: INestApplication;
  let server: Server;
  const requests: ModelRequest[] = [];
  const report = 'reports/REQ-2026-001-analysis.md';
  const content = '# REQ-2026-001 分析\n明确手机号绑定和密码至少8位约束。';

  beforeAll(async () => {
    state.root = await mkdtemp(join(tmpdir(), 'filesystem-http-'));
    await mkdir(join(state.root, 'requirements'));
    await mkdir(join(state.root, 'standards'));
    await writeFile(
      join(state.root, 'requirements/REQ-2026-001.json'),
      '{"requirementId":"REQ-2026-001","description":"用户注册时必须绑定手机号，密码至少8位"}',
    );
    await writeFile(
      join(state.root, 'standards/requirement-spec.md'),
      '# 需求规范\n不得编造缺失业务规则。',
    );
    server = createServer(async (req, res) => {
      let raw = '';
      for await (const chunk of req) raw += chunk;
      const body: ModelRequest = JSON.parse(raw);
      requests.push(body);
      const round = body.messages.filter(
        (message) => message.role === 'tool',
      ).length;
      const steps = [
        { name: 'query_requirement', args: { requirementId: 'REQ-2026-001' } },
        { name: 'read_file', args: { path: 'standards/requirement-spec.md' } },
        { name: 'write_file', args: { path: report, content } },
      ];
      const step = steps[round];
      res.setHeader('Content-Type', 'application/json');
      res.end(
        JSON.stringify({
          id: 'filesystem-test',
          object: 'chat.completion',
          choices: [
            {
              index: 0,
              message: {
                role: 'assistant',
                content: step ? null : `已保存 ${report}`,
                ...(step
                  ? {
                      tool_calls: [
                        {
                          id: `file-${round}`,
                          type: 'function',
                          function: {
                            name: step.name,
                            arguments: JSON.stringify(step.args),
                          },
                        },
                      ],
                    }
                  : {}),
              },
              finish_reason: step ? 'tool_calls' : 'stop',
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
    if (state.root) await rm(state.root, { recursive: true, force: true });
  });

  it('sends Zod schemas and completes real query/read/write operations through the route', async () => {
    await request(app.getHttpServer())
      .post('/api/files/chat')
      .send({ input: '把需求判断结论写入 reports/REQ-2026-001-analysis.md' })
      .expect(201)
      .expect({ content: `已保存 ${report}` });
    expect(requests).toHaveLength(4);
    expect(requests[0].tools.map((entry) => entry.function.name)).toEqual([
      'query_requirement',
      'read_file',
      'write_file',
    ]);
    expect(
      requests[0].tools.every((entry) => entry.function.parameters.properties),
    ).toBe(true);
    const results = requests[3].messages.filter(
      (message) => message.role === 'tool',
    );
    expect(results.map((message) => message.tool_call_id)).toEqual([
      'file-0',
      'file-1',
      'file-2',
    ]);
    expect(JSON.parse(results[0].content).requirementId).toBe('REQ-2026-001');
    expect(results[1].content).toContain('不得编造');
    expect(JSON.parse(results[2].content)).toEqual({
      path: report,
      written: true,
    });
    expect(await readFile(join(state.root, report), 'utf8')).toBe(content);
  });
});
