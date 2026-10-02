import 'reflect-metadata';
import { createServer, type Server } from 'node:http';
import { connect, type AddressInfo } from 'node:net';
import type { Duplex } from 'node:stream';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';

const input = '用户注册时必须绑定手机号，密码至少8位';

describe.each(['direct', 'HTTPS_PROXY', 'HTTP_PROXY'])(
  'LangChain HTTP routes (%s)',
  (transport) => {
    let server: Server;
    let proxy: Server;
    let tunnels = 0;
    let proxiedRequests = 0;
    const upstreamPorts = new Set<number>();
    const sockets = new Set<Duplex>();
    let app: INestApplication;
    const requests: Array<{
      messages: Array<{ role: string; content: string }>;
      model: string;
      temperature: number;
      max_completion_tokens?: number;
      max_tokens?: number;
    }> = [];

    beforeAll(async () => {
      server = createServer(async (req, res) => {
        if (upstreamPorts.has(req.socket.remotePort!)) proxiedRequests++;
        let raw = '';
        for await (const chunk of req) raw += chunk;
        const body = JSON.parse(raw);
        requests.push(body);
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
                  message: {
                    role: 'assistant',
                    content: '手机号；密码至少8位',
                  },
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
      vi.stubEnv('HTTPS_PROXY', '');
      vi.stubEnv('HTTP_PROXY', '');
      if (transport !== 'direct') {
        proxy = createServer();
        proxy.on('connect', (req, client, head) => {
          tunnels++;
          const upstream = connect(
            (server.address() as AddressInfo).port,
            '127.0.0.1',
          );
          sockets.add(client);
          sockets.add(upstream);
          client.on('error', () => upstream.destroy());
          upstream.on('error', () => client.destroy());
          upstream.on('connect', () => {
            upstreamPorts.add(upstream.localPort!);
            client.write('HTTP/1.1 200 Connection Established\r\n\r\n');
            upstream.write(head);
            client.pipe(upstream).pipe(client);
          });
        });
        await new Promise<void>((resolve) =>
          proxy.listen(0, '127.0.0.1', resolve),
        );
        vi.stubEnv(
          transport,
          `http://127.0.0.1:${(proxy.address() as AddressInfo).port}`,
        );
        // HTTPS_PROXY must take precedence over HTTP_PROXY.
        if (transport === 'HTTPS_PROXY')
          vi.stubEnv('HTTP_PROXY', 'http://127.0.0.1:1');
      }
      vi.stubEnv(
        'OPENAI_BASE_URL',
        `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`,
      );
      const { LlmModule } = await import('./llm.module.js');
      const module = await Test.createTestingModule({
        imports: [LlmModule],
      }).compile();
      app = module.createNestApplication();
      await app.init();
    });

    afterAll(async () => {
      await app?.close();
      for (const socket of sockets) socket.destroy();
      if (proxy)
        await new Promise<void>((resolve) => proxy.close(() => resolve()));
      if (server)
        await new Promise<void>((resolve) => server.close(() => resolve()));
      vi.unstubAllEnvs();
    });

    it('invoke returns model content', async () => {
      await request(app.getHttpServer())
        .post('/api/langchain/invoke')
        .send({ input })
        .expect(201)
        .expect({ content: '手机号；密码至少8位' });
    });

    it('stream sends incremental content and completion as SSE', async () => {
      const response = await request(app.getHttpServer())
        .post('/api/langchain/stream')
        .send({ input })
        .expect(200)
        .expect('Content-Type', /text\/event-stream/);
      expect(response.text).toContain('data: {"content":"手机号"}');
      expect(response.text).toContain('data: {"content":"密码至少8位"}');
      expect(response.text).toContain('data: [DONE]');
    });

    it('batch returns an array for the fixed input', async () => {
      await request(app.getHttpServer())
        .post('/api/langchain/batch')
        .send({ inputs: [input] })
        .expect(201)
        .expect([{ content: '手机号；密码至少8位' }]);
    });

    it('prompt-preview renders messages without a model call or API key', async () => {
      const count = requests.length;
      const apiKey = process.env.OPENAI_API_KEY;
      vi.stubEnv('OPENAI_API_KEY', '');
      try {
        await request(app.getHttpServer())
          .post('/api/langchain/prompt-preview')
          .expect(201)
          .expect({
            messages: [
              {
                role: 'system',
                content:
                  '你是需求结构化抽取助手。请从用户需求中抽取实体、规则和约束。',
              },
              {
                role: 'human',
                content: `请逐步分析并输出结构化抽取结果：\n${input}`,
              },
            ],
          });
        expect(requests).toHaveLength(count);
      } finally {
        vi.stubEnv('OPENAI_API_KEY', apiKey);
      }
    });

    it('prompt-to-model sends the rendered messages and returns model content', async () => {
      await request(app.getHttpServer())
        .post('/api/langchain/prompt-to-model')
        .expect(201)
        .expect({ content: '手机号；密码至少8位' });
    });

    it('all requests use YAML parameters and the required messages', () => {
      expect(requests).toHaveLength(4);
      if (transport !== 'direct') {
        expect(tunnels).toBeGreaterThan(0);
        expect(proxiedRequests).toBe(4);
      }
      for (const body of requests) {
        expect(body.model).toBe('gpt-5.4');
        expect(body.temperature).toBe(0);
        expect(body.max_completion_tokens ?? body.max_tokens).toBe(800);
        expect(body.messages).toEqual([
          // ChatOpenAI maps SystemMessage to developer for GPT-5 models.
          {
            role: 'developer',
            content:
              '你是需求结构化抽取助手。请从用户需求中抽取实体、规则和约束。',
          },
          {
            role: 'user',
            content: `请逐步分析并输出结构化抽取结果：\n${input}`,
          },
        ]);
      }
    });
  },
);
