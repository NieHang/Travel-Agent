import { Logger } from '@nestjs/common';
import { AIMessage, HumanMessage } from '@langchain/core/messages';

const summarizer = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock('./model.factory.js', () => ({ createChatModel: () => ({ invoke: summarizer.invoke }) }));

import { COMPACT_THRESHOLD, KEEP_RECENT_MESSAGES } from './compact.js';
import { ContextManager } from './context-manager.js';

// The token estimator counts each Chinese character as one token.
const tokens = (count: number) => '字'.repeat(count);
const turns = (count: number) =>
  Array.from({ length: count }, (_, i) => (i % 2 ? new AIMessage(`a${i}`) : new HumanMessage(`u${i}`)));

describe('ContextManager', () => {
  beforeEach(() => {
    summarizer.invoke.mockReset().mockResolvedValue(new AIMessage('SUMMARY'));
    vi.spyOn(Logger.prototype, 'log').mockImplementation(() => {});
    vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => {});
  });
  afterEach(() => vi.restoreAllMocks());

  it('keeps added messages in order and estimates their tokens', () => {
    const context = new ContextManager([new HumanMessage(tokens(3))]);
    context.addMessage(new AIMessage(tokens(2)));
    expect(context.getMessages().map((m) => m.text)).toEqual([tokens(3), tokens(2)]);
    expect(context.getEstimatedTokens()).toBe(5);
  });

  it('replaces old messages with one summary message and keeps the last 10', async () => {
    const recent = turns(KEEP_RECENT_MESSAGES);
    const context = new ContextManager([new HumanMessage(tokens(COMPACT_THRESHOLD)), ...turns(5), ...recent]);

    expect(await context.maybeCompact()).toBe(true);

    const [summary, ...rest] = context.getMessages();
    expect(summary).toBeInstanceOf(HumanMessage);
    expect(summary.text).toContain('SUMMARY');
    expect(rest).toHaveLength(KEEP_RECENT_MESSAGES);
    rest.forEach((m, i) => expect(m).toBe(recent[i]));
  });

  it('keeps the summary for later turns instead of summarizing again', async () => {
    const context = new ContextManager([new HumanMessage(tokens(COMPACT_THRESHOLD)), ...turns(KEEP_RECENT_MESSAGES)]);
    await context.maybeCompact();
    context.addMessage(new HumanMessage('next'));

    expect(await context.maybeCompact()).toBe(false);

    expect(context.getMessages()[0].text).toContain('SUMMARY');
    expect(context.getMessages().at(-1)?.text).toBe('next');
    expect(summarizer.invoke).toHaveBeenCalledTimes(1);
  });

  it('keeps only the last 20 messages when summarizing fails', async () => {
    summarizer.invoke.mockRejectedValue(new Error('summarizer down'));
    const messages = [new HumanMessage(tokens(COMPACT_THRESHOLD)), ...turns(30)];
    const context = new ContextManager(messages);

    expect(await context.maybeCompact()).toBe(false);

    expect(context.getMessages()).toEqual(messages.slice(-KEEP_RECENT_MESSAGES * 2));
  });

  it('stops without changing anything when aborted while summarizing', async () => {
    const controller = new AbortController();
    summarizer.invoke.mockImplementation(async () => {
      controller.abort();
      throw new Error('aborted');
    });
    const messages = [new HumanMessage(tokens(COMPACT_THRESHOLD)), ...turns(30)];
    const context = new ContextManager(messages);

    await expect(context.maybeCompact(controller.signal)).rejects.toThrow();

    expect(context.getMessages()).toEqual(messages);
  });
});
