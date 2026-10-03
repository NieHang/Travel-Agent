import 'reflect-metadata';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { Test } from '@nestjs/testing';
import { LlmModule } from '../llm.module.js';
import { RequirementService } from '../requirement.service.js';
import { CHAT_REPLY_PORT, TRAVEL_SYSTEM_PROMPT } from './chat-reply.port.js';
import {
  FAKE_REPLY_CHUNKS,
  FAKE_REQUIREMENTS,
  FakeChatReply,
  FakeRequirementService,
} from './fakes.js';
import { ModelChatReply } from './model-chat-reply.js';

type Received = { messages: Array<{ role: string; content: string }> };

describe('fake implementations', () => {
  it('假实现依次输出固定分块', async () => {
    const out: string[] = [];
    for await (const c of new FakeChatReply().streamReply(
      [],
      new AbortController().signal,
    ))
      out.push(c);
    expect(out).toEqual(FAKE_REPLY_CHUNKS);
  });
  it('假实现在中止后停止输出', async () => {
    const ac = new AbortController();
    const out: string[] = [];
    for await (const c of new FakeChatReply().streamReply([], ac.signal)) {
      out.push(c);
      ac.abort();
    }
    expect(out).toEqual([FAKE_REPLY_CHUNKS[0]]);
  });
  it('假抽取返回固定结果', async () =>
    expect(await new FakeRequirementService().extract('x')).toEqual(
      FAKE_REQUIREMENTS,
    ));
});

describe('ModelChatReply against a local model API', () => {
  let server: Server;
  let received: Received;
  let deltas: string[];

  beforeAll(async () => {
    server = createServer(async (req, res) => {
      let raw = '';
      for await (const chunk of req) raw += chunk;
      received = JSON.parse(raw);
      res.setHeader('Content-Type', 'text/event-stream');
      for (const content of deltas)
        res.write(
          `data: ${JSON.stringify({ id: 'test', object: 'chat.completion.chunk', choices: [{ index: 0, delta: { role: 'assistant', content }, finish_reason: null }] })}\n\n`,
        );
      res.end('data: [DONE]\n\n');
    });
    await new Promise<void>((resolve) =>
      server.listen(0, '127.0.0.1', resolve),
    );
  });

  beforeEach(() => {
    vi.stubEnv('OPENAI_API_KEY', 'local-test-key');
    vi.stubEnv(
      'OPENAI_BASE_URL',
      `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`,
    );
    vi.stubEnv('HTTPS_PROXY', '');
    vi.stubEnv('HTTP_PROXY', '');
  });

  afterEach(() => vi.unstubAllEnvs());

  afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

  it('真实实现：系统提示词在最前，历史按顺序与角色传给模型，流式输出文本块', async () => {
    deltas = ['你', '好'];
    const out: string[] = [];
    for await (const c of new ModelChatReply().streamReply(
      [
        { role: 'user', content: '去里斯本' },
        { role: 'assistant', content: '几天？' },
        { role: 'user', content: '5 天' },
      ],
      new AbortController().signal,
    ))
      out.push(c);
    expect(out.join('')).toBe('你好');
    // LangChain sends the system message as "developer" for reasoning models
    // such as the configured gpt-5.x, and as "system" otherwise.
    expect(received.messages.map((m) => m.role)).toEqual([
      expect.stringMatching(/^(system|developer)$/),
      'user',
      'assistant',
      'user',
    ]);
    expect(received.messages[0].content).toBe(TRAVEL_SYSTEM_PROMPT);
    expect(received.messages[3].content).toBe('5 天');
  });

  it('真实实现：不输出空文本块', async () => {
    deltas = ['你', '', '好'];
    const out: string[] = [];
    for await (const c of new ModelChatReply().streamReply(
      [{ role: 'user', content: 'hi' }],
      new AbortController().signal,
    ))
      out.push(c);
    expect(out).not.toContain('');
    expect(out.join('')).toBe('你好');
  });
});

describe('LlmModule bindings', () => {
  afterEach(() => vi.unstubAllEnvs());

  it.each([
    ['1', FakeChatReply, FakeRequirementService],
    [undefined, ModelChatReply, RequirementService],
  ])('LLM_FAKE=%s 时 LlmModule 绑定对应实现', async (flag, cls, reqCls) => {
    vi.stubEnv('LLM_FAKE', flag);
    const mod = await Test.createTestingModule({
      imports: [LlmModule],
    }).compile();
    expect(mod.get(CHAT_REPLY_PORT)).toBeInstanceOf(cls);
    expect(mod.get(RequirementService)).toBeInstanceOf(reqCls);
  });
});
