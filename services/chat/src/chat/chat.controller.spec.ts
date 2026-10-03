import 'reflect-metadata';
import { EventEmitter } from 'node:events';
import { inspect } from 'node:util';
import { Logger } from '@nestjs/common';
import type { ChatStreamEvent } from '@autix/contracts';
import type { Response } from 'express';
import type { ConversationsService } from '../conversations/conversations.service.js';
import { ChatController } from './chat.controller.js';
import type { ChatService } from './chat.service.js';

const SENTINEL = 'SENTINEL-user-text-7f3a';
const CONVERSATION_ID = 'conv-1';
const user = { userId: 'user-1' };
const delta: ChatStreamEvent = { event: 'delta', data: { text: 'hi' } };

/** 只实现控制器用到的那部分 Response。 */
function fakeResponse(state: { destroyed?: boolean } = {}) {
  const res = Object.assign(new EventEmitter(), {
    destroyed: state.destroyed ?? false,
    closed: false,
    headersSent: false,
    written: [] as string[],
    ended: false,
    status: () => res,
    setHeader: () => res,
    flushHeaders: () => {
      res.headersSent = true;
    },
    write: (chunk: string) => res.written.push(chunk) > 0,
    end: () => {
      res.ended = true;
    },
  });
  return res;
}

function controller(send: ChatService['send']) {
  return new ChatController(
    { send } as unknown as ChatService,
    { assertOwned: async () => undefined } as unknown as ConversationsService,
  );
}

describe('ChatController.send', () => {
  afterEach(() => vi.restoreAllMocks());

  it('归属校验期间连接已断开：信号一开始就是中止的', async () => {
    let abortedAtStart: boolean | undefined;
    const res = fakeResponse({ destroyed: true });
    await controller(async function* (_id, _content, signal) {
      abortedAtStart = signal.aborted;
      yield delta;
    }).send(user, CONVERSATION_ID, { content: 'x' }, res as unknown as Response);
    expect(abortedAtStart).toBe(true);
    expect(res.written).toEqual([]);
    expect(res.listenerCount('close')).toBe(0);
  });

  it('连接正常时信号未中止，事件照常写出', async () => {
    let abortedAtStart: boolean | undefined;
    const res = fakeResponse();
    await controller(async function* (_id, _content, signal) {
      abortedAtStart = signal.aborted;
      yield delta;
    }).send(user, CONVERSATION_ID, { content: 'x' }, res as unknown as Response);
    expect(abortedAtStart).toBe(false);
    expect(res.written).toEqual([`event: delta\ndata: ${JSON.stringify(delta.data)}\n\n`]);
    expect(res.ended).toBe(true);
  });

  it('流开始后的失败：日志只有固定描述、错误类名与会话 id，不含错误消息', async () => {
    const spy = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    const res = fakeResponse();
    await controller(async function* () {
      yield delta;
      throw new TypeError(`model said: ${SENTINEL}`);
    }).send(user, CONVERSATION_ID, { content: 'x' }, res as unknown as Response);
    expect(res.ended).toBe(true);
    expect(spy).toHaveBeenCalledTimes(1);
    const logged = inspect(spy.mock.calls, { depth: 10 });
    expect(logged).not.toContain(SENTINEL);
    expect(logged).toContain('TypeError');
    expect(logged).toContain(CONVERSATION_ID);
    for (const arg of spy.mock.calls[0]) expect(typeof arg).toBe('string');
  });
});
