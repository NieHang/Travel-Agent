import 'reflect-metadata';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';

describe('requirement chain routes', () => {
  let server: Server;
  let app: INestApplication;
  const inputs: string[] = [];

  beforeAll(async () => {
    server = createServer(async (req, res) => {
      let raw = '';
      for await (const chunk of req) raw += chunk;
      const body = JSON.parse(raw);
      inputs.push(body.messages.at(-1).content);
      if (body.stream) {
        res.setHeader('Content-Type', 'text/event-stream');
        for (const content of ['手机号', '密码至少8位']) {
          res.write(
            `data: ${JSON.stringify({ id: 'test', object: 'chat.completion.chunk', choices: [{ index: 0, delta: { role: 'assistant', content }, finish_reason: null }] })}\n\n`,
          );
        }
        res.end('data: [DONE]\n\n');
      } else {
        res.setHeader('Content-Type', 'application/json');
        res.end(
          JSON.stringify({
            id: 'test',
            object: 'chat.completion',
            choices: [
              {
                index: 0,
                message: { role: 'assistant', content: '手机号；密码至少8位' },
                finish_reason: 'stop',
              },
            ],
          }),
        );
      }
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

  it('chain-invoke returns parsed text using the fixed requirement', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/langchain/chain-invoke')
      .send({ input: '用户注册时必须绑定手机号，密码至少8位' })
      .expect(201);
    expect(response.text).toBe('手机号；密码至少8位');
    expect(inputs.at(-1)).toContain('用户注册时必须绑定手机号，密码至少8位');
  });

  it('chain-stream sends parsed text chunks and SSE completion', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/langchain/chain-stream')
      .send({ input: '用户注册时必须绑定手机号，密码至少8位' })
      .expect(200)
      .expect('Content-Type', /text\/event-stream/);
    expect(response.text).toContain('data: "手机号"');
    expect(response.text).toContain('data: "密码至少8位"');
    expect(response.text).toContain('data: [DONE]');
    expect(inputs.at(-1)).toContain('用户注册时必须绑定手机号，密码至少8位');
  });

  it('chain-batch returns parsed strings using the fixed requirement', async () => {
    await request(app.getHttpServer())
      .post('/api/langchain/chain-batch')
      .send({ inputs: ['用户注册时必须绑定手机号，密码至少8位'] })
      .expect(201)
      .expect(['手机号；密码至少8位']);
    expect(inputs.at(-1)).toContain('用户注册时必须绑定手机号，密码至少8位');
  });
});
