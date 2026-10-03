import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { inspect } from 'node:util';
import { Logger } from '@nestjs/common';
import type { ChatStreamEvent, RequirementResult } from '@autix/contracts';
import { createTestPrisma, resetDb } from '../../test/helpers/db.js';
import type { ChatReplyPort, ChatTurn } from '../llm/chat-reply/chat-reply.port.js';
import { FAKE_REQUIREMENTS } from '../llm/chat-reply/fakes.js';
import { ChatService, HISTORY_LIMIT, REQUIREMENT_WAIT_MS } from './chat.service.js';

type Extractor = { extract(input: string, signal?: AbortSignal): Promise<RequirementResult> };
type FakePort = ChatReplyPort & { lastHistory: ChatTurn[] };

async function collect(gen: AsyncIterable<ChatStreamEvent>): Promise<ChatStreamEvent[]> {
  const events: ChatStreamEvent[] = [];
  for await (const e of gen) events.push(e);
  return events;
}

/**
 * 按 `chunks` 依次输出的假端口。
 * - `failAfter`：输出这么多块之后抛错；`0` 表示首块之前。
 * - `onChunk(i)`：在第 `i` 块输出之前被 await。
 */
function port(
  chunks: string[],
  opts: { failAfter?: number; onChunk?: (i: number) => unknown } = {},
): FakePort {
  const fake: FakePort = {
    lastHistory: [],
    async *streamReply(history) {
      fake.lastHistory = history;
      for (let i = 0; i <= chunks.length; i++) {
        if (opts.failAfter === i) throw new Error('upstream failed');
        if (i === chunks.length) return;
        await opts.onChunk?.(i);
        yield chunks[i]!;
      }
    },
  };
  return fake;
}

const nextMacrotask = () => new Promise<void>((resolve) => setImmediate(resolve));

/** 抽取成功，但像真实模型一样比回复的首个分块晚：在下一个宏任务才给出结果。 */
const extractOk: Extractor = {
  extract: async () => {
    await nextMacrotask();
    return FAKE_REQUIREMENTS;
  },
};
const extractFails: Extractor = { extract: () => Promise.reject(new Error('extract failed')) };
const extractEmpty: Extractor = { extract: () => Promise.resolve({ requirements: [] }) };
const extractNeverResolves: Extractor = { extract: () => new Promise<RequirementResult>(() => {}) };

/** 记下收到的信号；一直不给结果，直到该信号中止时才拒绝（真实模型客户端被取消时的表现）。 */
function abortableExtractor(): Extractor & { signal: AbortSignal | undefined; calls: number } {
  const fake = {
    signal: undefined as AbortSignal | undefined,
    calls: 0,
    extract(_input: string, signal?: AbortSignal) {
      fake.signal = signal;
      fake.calls += 1;
      return new Promise<RequirementResult>((_resolve, reject) => {
        const onAbort = () => reject(new Error('extraction aborted'));
        if (signal?.aborted) onAbort();
        else signal?.addEventListener('abort', onAbort, { once: true });
      });
    },
  };
  return fake;
}

describe('ChatService.send', () => {
  const prisma = createTestPrisma();
  const signal = new AbortController().signal;
  let id: string;

  const chat = (reply: ChatReplyPort, extractor: Extractor) =>
    new ChatService(prisma, reply, extractor);

  const messages = () =>
    prisma.message.findMany({
      where: { conversationId: id },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });

  const lastAssistant = () =>
    prisma.message.findFirstOrThrow({
      where: { conversationId: id, role: 'ASSISTANT' },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    });

  beforeAll(async () => {
    // 出错路径会写日志；这些是测试有意触发的，不让它们混进测试输出。
    Logger.overrideLogger(false);
    await prisma.$connect();
  });

  beforeEach(async () => {
    await resetDb(prisma);
    const user = await prisma.user.create({
      data: { email: 'chat@example.com', passwordHash: 'h', nickname: 'Chat' },
    });
    id = (await prisma.conversation.create({ data: { userId: user.id, title: '' } })).id;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('正常完成：事件顺序、落库、标题、updatedAt', async () => {
    const before = (await prisma.conversation.findUniqueOrThrow({ where: { id } })).updatedAt;
    const events = await collect(chat(port(['你', '好']), extractOk).send(id, '去里斯本 5 天', signal));
    expect(events.map((e) => e.event)).toEqual(
      expect.arrayContaining(['user_message', 'delta', 'delta', 'requirement', 'done']),
    );
    expect(events).toHaveLength(5);
    expect(events[0].event).toBe('user_message');
    expect(events.at(-1)!.event).toBe('done');
    const [user, assistant] = await prisma.message.findMany({
      where: { conversationId: id },
      orderBy: { createdAt: 'asc' },
    });
    expect(user).toMatchObject({ role: 'USER', content: '去里斯本 5 天', status: 'complete' });
    expect(assistant).toMatchObject({
      role: 'ASSISTANT',
      content: '你好',
      status: 'complete',
      metadata: { requirements: FAKE_REQUIREMENTS.requirements },
    });
    const conv = await prisma.conversation.findUniqueOrThrow({ where: { id } });
    expect(conv.title).toBe('去里斯本 5 天');
    expect(conv.updatedAt.getTime()).toBeGreaterThan(before.getTime());

    // 事件里带的就是落库的那两条消息；助手消息严格晚于用户消息。
    expect(events[0]).toMatchObject({ data: { message: { id: user!.id, role: 'USER' } } });
    expect(events.at(-1)).toMatchObject({
      data: { message: { id: assistant!.id, status: 'complete', content: '你好' } },
    });
    expect(events.filter((e) => e.event === 'delta').map((e) => e.data)).toEqual([
      { text: '你' },
      { text: '好' },
    ]);
    expect(events.find((e) => e.event === 'requirement')!.data).toEqual(FAKE_REQUIREMENTS);
    expect(assistant!.createdAt.getTime()).toBeGreaterThan(user!.createdAt.getTime());
    expect(await prisma.message.count({ where: { conversationId: id } })).toBe(2);
  });

  it('已有标题时不覆盖', async () => {
    await prisma.conversation.update({ where: { id }, data: { title: '我的行程' } });
    const events = await collect(chat(port(['ok']), extractOk).send(id, '去里斯本 5 天', signal));
    expect(events.at(-1)!.event).toBe('done');
    const conv = await prisma.conversation.findUniqueOrThrow({ where: { id } });
    expect(conv.title).toBe('我的行程');
  });

  it('历史：最近 20 条非空消息，按时间正序，含本条，角色映射正确', async () => {
    // 预置 25 条交替的用户/助手消息（内容 m0…m24），其中 m10 的内容为空串
    const base = Date.UTC(2026, 0, 1);
    for (let i = 0; i < 25; i++) {
      await prisma.message.create({
        data: {
          conversationId: id,
          role: i % 2 === 0 ? 'USER' : 'ASSISTANT',
          content: i === 10 ? '' : `m${i}`,
          createdAt: new Date(base + i * 1000),
        },
      });
    }
    const p = port(['ok']);
    await collect(chat(p, extractOk).send(id, 'now', signal));
    expect(HISTORY_LIMIT).toBe(20);
    expect(p.lastHistory).toHaveLength(20);
    expect(p.lastHistory.at(-1)).toEqual({ role: 'user', content: 'now' });
    expect(p.lastHistory.map((t) => t.content)).not.toContain('');
    expect(p.lastHistory[0].content).toBe('m5'); // now + m24…m5 去掉空的 m10，共 20 条
    expect(p.lastHistory.map((t) => t.content)).toEqual([
      ...[5, 6, 7, 8, 9, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24].map((i) => `m${i}`),
      'now',
    ]);
    // 偶数下标是用户消息，奇数下标是助手消息。
    expect(p.lastHistory[0]).toEqual({ role: 'assistant', content: 'm5' });
    expect(p.lastHistory[1]).toEqual({ role: 'user', content: 'm6' });
  });

  it('抽取失败不影响回复：无 requirement 事件，metadata 标记失败', async () => {
    const events = await collect(chat(port(['ok']), extractFails).send(id, 'x', signal));
    expect(events.map((e) => e.event)).not.toContain('requirement');
    expect(events.at(-1)!.event).toBe('done');
    expect((await lastAssistant()).metadata).toEqual({ requirementError: true });
  });

  it('抽取失败的日志只有固定描述、错误类名与会话 id，不含错误消息', async () => {
    const sentinel = 'SENTINEL-user-text-41c9';
    const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const failing: Extractor = {
      extract: () => Promise.reject(new SyntaxError(`could not parse model output: ${sentinel}`)),
    };
    const events = await collect(chat(port(['ok']), failing).send(id, sentinel, signal));
    expect(events.at(-1)!.event).toBe('done');
    expect(warn).toHaveBeenCalledTimes(1);
    const logged = inspect(warn.mock.calls, { depth: 10 });
    expect(logged).not.toContain(sentinel);
    expect(logged).toContain('SyntaxError');
    expect(logged).toContain(id);
    for (const arg of warn.mock.calls[0]) expect(typeof arg).toBe('string');
  });

  it('上游出错的日志只有固定描述、错误类名与会话 id，不含错误消息', async () => {
    const sentinel = 'SENTINEL-user-text-9d02';
    const error = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    const failing: ChatReplyPort = {
      streamReply: () => ({
        [Symbol.asyncIterator]: () => ({
          next: () => Promise.reject(new RangeError(`upstream rejected: ${sentinel}`)),
        }),
      }),
    };
    const events = await collect(chat(failing, extractEmpty).send(id, sentinel, signal));
    expect(events.at(-1)!.event).toBe('error');
    expect(error).toHaveBeenCalledTimes(1);
    const logged = inspect(error.mock.calls, { depth: 10 });
    expect(logged).not.toContain(sentinel);
    expect(logged).toContain('RangeError');
    expect(logged).toContain(id);
    for (const arg of error.mock.calls[0]) expect(typeof arg).toBe('string');
  });

  it('抽取结果为空：无 requirement 事件，metadata 为 null', async () => {
    const events = await collect(chat(port(['ok']), extractEmpty).send(id, 'x', signal));
    expect(events.map((e) => e.event)).toEqual(['user_message', 'delta', 'done']);
    expect(events.at(-1)).toMatchObject({ data: { message: { metadata: null } } });
    expect(await lastAssistant()).toMatchObject({ status: 'complete', content: 'ok', metadata: null });
  });

  it('抽取先于回复完成：不等回复结束就产出 requirement', async () => {
    const immediate: Extractor = { extract: () => Promise.resolve(FAKE_REQUIREMENTS) };
    // 每个分块之前让出一个宏任务，抽取结果此时早已就绪。
    const events = await collect(
      chat(port(['一', '二'], { onChunk: nextMacrotask }), immediate).send(id, 'x', signal),
    );
    expect(events.map((e) => e.event)).toEqual([
      'user_message',
      'requirement',
      'delta',
      'delta',
      'done',
    ]);
  });

  it('抽取超过 15 秒按失败处理', async () => {
    // 只替换定时器，数据库 I/O 照常进行。
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const setTimeoutSpy = vi.spyOn(globalThis, 'setTimeout');
    let settled = false;
    const pending = collect(chat(port(['ok']), extractNeverResolves).send(id, 'x', signal)).finally(
      () => {
        settled = true;
      },
    );
    // 回复流结束、开始等待抽取之后再拨动时钟，否则那个定时器还没被创建。
    while (!setTimeoutSpy.mock.calls.some(([, ms]) => ms === REQUIREMENT_WAIT_MS)) {
      await nextMacrotask();
    }
    expect(REQUIREMENT_WAIT_MS).toBe(15_000);

    await vi.advanceTimersByTimeAsync(14_999);
    for (let i = 0; i < 5; i++) await nextMacrotask();
    expect(settled).toBe(false);
    expect(await prisma.message.count({ where: { conversationId: id } })).toBe(1);

    await vi.advanceTimersByTimeAsync(1);
    const events = await pending;
    expect(events.map((e) => e.event)).toEqual(['user_message', 'delta', 'done']);
    expect(events.at(-1)!.event).toBe('done');
    expect((await lastAssistant()).metadata).toEqual({ requirementError: true });
  });

  it('上游出错：error 事件，已生成部分以 error 状态落库', async () => {
    const events = await collect(
      chat(port(['半', '句'], { failAfter: 2 }), extractOk).send(id, 'x', signal),
    );
    const last = events.at(-1)!;
    expect(last).toMatchObject({
      event: 'error',
      data: { code: 'MODEL_FAILED', message: { status: 'error', content: '半句' } },
    });
    expect(events.map((e) => e.event)).not.toContain('done');
    expect(events.filter((e) => e.event === 'error')).toHaveLength(1);
    expect(await lastAssistant()).toMatchObject({ status: 'error', content: '半句' });
    expect(await prisma.message.count({ where: { conversationId: id } })).toBe(2);
  });

  it('上游在首个分块前出错：助手消息内容为空、状态 error', async () => {
    const events = await collect(
      chat(port(['不会输出'], { failAfter: 0 }), extractOk).send(id, 'x', signal),
    );
    expect(events.map((e) => e.event)).toEqual(['user_message', 'error']);
    expect(events.at(-1)).toMatchObject({
      event: 'error',
      data: { code: 'MODEL_FAILED', message: { role: 'ASSISTANT', status: 'error', content: '' } },
    });
    const rows = await messages();
    expect(rows).toHaveLength(2);
    expect(rows[1]).toMatchObject({ role: 'ASSISTANT', status: 'error', content: '' });
  });

  it('客户端中止：已生成部分以 partial 落库，不再产出事件', async () => {
    const ac = new AbortController();
    const gen = chat(port(['一', '二', '三']), extractOk).send(id, 'x', ac.signal);
    const seen: string[] = [];
    for await (const e of gen) {
      seen.push(e.event);
      if (e.event === 'delta') {
        ac.abort();
        break;
      }
    }
    expect(seen).toEqual(['user_message', 'delta']);
    expect(await lastAssistant()).toMatchObject({ status: 'partial', content: '一' });
    expect(await prisma.message.count({ where: { conversationId: id } })).toBe(2);
  });

  it('调用方提前结束迭代但未中止信号：同样以 partial 落库一次，并中止模型调用', async () => {
    let replySignal: AbortSignal | undefined;
    const reply: ChatReplyPort = {
      async *streamReply(_history, s) {
        replySignal = s;
        yield '一';
        yield '二';
      },
    };
    for await (const e of chat(reply, extractOk).send(id, 'x', signal)) {
      if (e.event === 'delta') break;
    }
    expect(replySignal!.aborted).toBe(true);
    expect(await lastAssistant()).toMatchObject({ status: 'partial', content: '一' });
    expect(await prisma.message.count({ where: { conversationId: id } })).toBe(2);
  });

  it('中止后上游抛出的错误算客户端中止，不是 MODEL_FAILED', async () => {
    const ac = new AbortController();
    const p = port(['一', '二'], {
      onChunk: (i) => {
        if (i !== 1) return;
        ac.abort();
        throw new Error('AbortError');
      },
    });
    const events = await collect(chat(p, extractOk).send(id, 'x', ac.signal));
    expect(events.map((e) => e.event)).toEqual(['user_message', 'delta']);
    expect(await lastAssistant()).toMatchObject({ status: 'partial', content: '一' });
    expect(await prisma.message.count({ where: { conversationId: id } })).toBe(2);
  });

  it('中止后上游安静地结束：仍是 partial，不产出 done', async () => {
    const ac = new AbortController();
    const p = port(['一', '二'], { onChunk: (i) => (i === 1 ? ac.abort() : undefined) });
    const events = await collect(chat(p, extractOk).send(id, 'x', ac.signal));
    expect(events.map((e) => e.event)).toEqual(['user_message', 'delta']);
    expect(await lastAssistant()).toMatchObject({ status: 'partial', content: '一' });
    expect(await prisma.message.count({ where: { conversationId: id } })).toBe(2);
  });

  it('等待抽取期间中止：立刻停止等待，以 partial 落库', async () => {
    const ac = new AbortController();
    const gen = chat(port(['ok']), extractNeverResolves).send(id, 'x', ac.signal);
    const seen: string[] = [];
    for await (const e of gen) {
      seen.push(e.event);
      // 回复只有这一块；稍后（已进入等待抽取阶段）再中止。
      if (e.event === 'delta') setTimeout(() => ac.abort(), 50);
    }
    expect(seen).toEqual(['user_message', 'delta']);
    expect(await lastAssistant()).toMatchObject({ status: 'partial', content: 'ok', metadata: null });
    expect(await prisma.message.count({ where: { conversationId: id } })).toBe(2);
  });

  it('客户端中途中止时抽取也被中止：仍是 partial，metadata 不因此记失败', async () => {
    const ac = new AbortController();
    const extractor = abortableExtractor();
    const seen: string[] = [];
    for await (const e of chat(port(['一', '二', '三']), extractor).send(id, 'x', ac.signal)) {
      seen.push(e.event);
      if (e.event === 'delta') {
        expect(extractor.signal).toBeInstanceOf(AbortSignal);
        expect(extractor.signal!.aborted).toBe(false);
        ac.abort();
        break;
      }
    }
    expect(seen).toEqual(['user_message', 'delta']);
    expect(extractor.calls).toBe(1);
    expect(extractor.signal!.aborted).toBe(true);
    await nextMacrotask();
    expect(await lastAssistant()).toMatchObject({ status: 'partial', content: '一', metadata: null });
    expect(await prisma.message.count({ where: { conversationId: id } })).toBe(2);
  });

  it('上游出错时抽取也被中止：仍是 MODEL_FAILED，metadata 不因此记失败', async () => {
    const extractor = abortableExtractor();
    const events = await collect(
      chat(port(['半', '句'], { failAfter: 1 }), extractor).send(id, 'x', signal),
    );
    expect(events.map((e) => e.event)).toEqual(['user_message', 'delta', 'error']);
    expect(events.at(-1)).toMatchObject({
      event: 'error',
      data: { code: 'MODEL_FAILED', message: { status: 'error', content: '半', metadata: null } },
    });
    expect(extractor.calls).toBe(1);
    expect(extractor.signal).toBeInstanceOf(AbortSignal);
    expect(extractor.signal!.aborted).toBe(true);
    await nextMacrotask();
    expect(await lastAssistant()).toMatchObject({ status: 'error', content: '半', metadata: null });
    expect(await prisma.message.count({ where: { conversationId: id } })).toBe(2);
  });

  it('上游出错之前抽取已真正失败：error 消息照旧记 requirementError', async () => {
    const events = await collect(
      chat(port(['半'], { failAfter: 1, onChunk: nextMacrotask }), extractFails).send(id, 'x', signal),
    );
    expect(events.at(-1)).toMatchObject({
      event: 'error',
      data: { message: { status: 'error', content: '半', metadata: { requirementError: true } } },
    });
  });

  it('生成过程中会话被删除：流正常结束，不抛错，不留孤立消息', async () => {
    const p = port(['一', '二'], {
      onChunk: (i) => (i === 0 ? prisma.conversation.delete({ where: { id } }) : undefined),
    });
    const pending = collect(chat(p, extractOk).send(id, 'x', signal));
    await expect(pending).resolves.toBeDefined();
    const events = await pending;
    expect(events.map((e) => e.event)).not.toContain('done');
    expect(events.map((e) => e.event)).not.toContain('error');
    expect(await prisma.message.count({ where: { conversationId: id } })).toBe(0);
    expect(await prisma.message.count()).toBe(0);
  });

  it('会话不存在：抛 CONVERSATION_NOT_FOUND，不产出事件，不落库', async () => {
    await expect(
      collect(chat(port(['ok']), extractOk).send('missing', 'x', signal)),
    ).rejects.toMatchObject({ code: 'CONVERSATION_NOT_FOUND' });
    expect(await prisma.message.count()).toBe(0);
  });
});
