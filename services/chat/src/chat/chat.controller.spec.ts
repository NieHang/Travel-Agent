import 'reflect-metadata';
import { EventEmitter } from 'node:events';
import { inspect } from 'node:util';
import { Logger } from '@nestjs/common';
import type { SendTurnRequest, TripStreamEvent } from '@autix/contracts';
import type { Response } from 'express';
import type { ConversationsService } from '../conversations/conversations.service.js';
import { ChatController } from './chat.controller.js';
import type { TurnService } from '../trip/turn.js';

const SENTINEL = 'SENTINEL-user-text-7f3a';
const CONVERSATION_ID = 'conv-1';
const user = { userId: 'user-1' };
const text: TripStreamEvent = { type: 'text', delta: 'hi' };
const turn: SendTurnRequest = { revision: 3, command: { type: 'confirm' }, locale: 'en' };

/** 只实现控制器用到的那部分 Response。 */
function fakeResponse(state: { destroyed?: boolean } = {}) {
  const res = Object.assign(new EventEmitter(), {
    destroyed: state.destroyed ?? false,
    closed: false,
    headersSent: false,
    written: [] as string[],
    ended: false,
    status: () => res,
    setHeader: vi.fn(() => res),
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

function controller(run: TurnService['run']) {
  return new ChatController(
    { assertOwned: async () => undefined } as unknown as ConversationsService,
    { run } as unknown as TurnService,
  );
}

describe('ChatController.send', () => {
  afterEach(() => vi.restoreAllMocks());

  it('归属校验期间连接已断开：信号一开始就是中止的', async () => {
    let abortedAtStart: boolean | undefined;
    const res = fakeResponse({ destroyed: true });
    await controller(async function* (_id, _content, signal) {
      abortedAtStart = signal.aborted;
      yield text;
    }).send(user, CONVERSATION_ID, turn, res as unknown as Response);
    expect(abortedAtStart).toBe(true);
    expect(res.written).toEqual([]);
    expect(res.listenerCount('close')).toBe(0);
  });

  it('连接正常时信号未中止，事件照常写出', async () => {
    let abortedAtStart: boolean | undefined;
    const res = fakeResponse();
    await controller(async function* (id, request, signal) {
      expect(id).toBe(CONVERSATION_ID);
      expect(request).toBe(turn);
      abortedAtStart = signal.aborted;
      yield text;
    }).send(user, CONVERSATION_ID, turn, res as unknown as Response);
    expect(abortedAtStart).toBe(false);
    expect(res.setHeader.mock.calls).toEqual([
      ['Content-Type', 'text/event-stream'],
      ['Cache-Control', 'no-cache'],
      ['Connection', 'keep-alive'],
    ]);
    expect(res.written).toEqual(['event: message\ndata: {"type":"text","delta":"hi"}\n\n']);
    expect(res.ended).toBe(true);
  });

  it('流开始后的失败：日志只有固定描述、错误类名与会话 id，不含错误消息', async () => {
    const spy = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    const res = fakeResponse();
    await controller(async function* () {
      yield text;
      throw new TypeError(`model said: ${SENTINEL}`);
    }).send(user, CONVERSATION_ID, turn, res as unknown as Response);
    expect(res.ended).toBe(true);
    expect(spy).toHaveBeenCalledTimes(1);
    const logged = inspect(spy.mock.calls, { depth: 10 });
    expect(logged).not.toContain(SENTINEL);
    expect(logged).toContain('TypeError');
    expect(logged).toContain(CONVERSATION_ID);
    for (const arg of spy.mock.calls[0]) expect(typeof arg).toBe('string');
  });
});
