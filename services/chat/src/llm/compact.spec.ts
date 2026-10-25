import { AIMessage, HumanMessage, SystemMessage, ToolMessage, type BaseMessage } from '@langchain/core/messages';

const model = vi.hoisted(() => ({ create: vi.fn(), invoke: vi.fn() }));
vi.mock('./model.factory.js', () => ({
  createChatModel: (options: unknown) => {
    model.create(options);
    return { invoke: model.invoke };
  },
}));

import { buildSummaryContent, COMPACT_THRESHOLD, KEEP_RECENT_MESSAGES, maybeCompact } from './compact.js';

// The token estimator counts each Chinese character as exactly one token.
const tokens = (count: number) => '字'.repeat(count);
const turns = (count: number) =>
  Array.from({ length: count }, (_, i) => (i % 2 ? new AIMessage(tokens(1)) : new HumanMessage(tokens(1))));
const toolCall = (id: string, args: Record<string, unknown>) =>
  new AIMessage({ content: '', tool_calls: [{ id, name: 'searchHotels', args }] });

describe('maybeCompact', () => {
  beforeEach(() => {
    model.create.mockReset();
    model.invoke.mockReset().mockResolvedValue(new AIMessage('SUMMARY'));
  });

  it('leaves a conversation at the threshold untouched', async () => {
    const messages = [new HumanMessage(tokens(COMPACT_THRESHOLD - 20)), ...turns(20)];
    const before = [...messages];
    expect(await maybeCompact(messages)).toBe(false);
    expect(messages).toEqual(before);
    expect(model.invoke).not.toHaveBeenCalled();
  });

  it('summarizes older messages with the configured compact model, keeping the system prompt and the last 10', async () => {
    const system = new SystemMessage('You are Hilda.');
    const messages: BaseMessage[] = [system, new HumanMessage(tokens(COMPACT_THRESHOLD - 20)), ...turns(21)];
    const old = messages.slice(1, -KEEP_RECENT_MESSAGES);
    const recent = messages.slice(-KEEP_RECENT_MESSAGES);
    const signal = new AbortController().signal;

    expect(await maybeCompact(messages, signal)).toBe(true);

    expect(model.create).toHaveBeenCalledWith({ model: 'deepseek-flash', operation: 'compact' });
    const [prompt, options] = model.invoke.mock.calls[0] as [BaseMessage[], unknown];
    expect(prompt[1].text).toBe(buildSummaryContent(old));
    expect(options).toEqual({ signal });
    expect(messages).toHaveLength(2 + KEEP_RECENT_MESSAGES);
    expect(messages[0]).toBe(system);
    expect(messages[1]).toBeInstanceOf(HumanMessage);
    expect(messages[1].text).toContain('SUMMARY');
    messages.slice(2).forEach((message, i) => expect(message).toBe(recent[i]));
  });

  it('counts tool call arguments toward the threshold', async () => {
    const messages = [toolCall('call_1', { q: tokens(COMPACT_THRESHOLD) }), ...turns(KEEP_RECENT_MESSAGES)];
    expect(await maybeCompact(messages)).toBe(true);
  });

  it('never keeps a tool result without the tool call that produced it', async () => {
    const call = toolCall('call_1', { city: 'Kyoto' });
    const result = new ToolMessage({ tool_call_id: 'call_1', content: '{"hotels":[]}' });
    const messages = [new HumanMessage(tokens(COMPACT_THRESHOLD)), new AIMessage('ok'), call, result, ...turns(9)];

    expect(await maybeCompact(messages)).toBe(true);

    expect(messages).toHaveLength(1 + 11);
    expect(messages[1]).toBe(call);
    expect(messages[2]).toBe(result);
  });

  it('does nothing when no message is older than the recent window', async () => {
    const messages = [new SystemMessage('sys'), new HumanMessage(tokens(COMPACT_THRESHOLD + 1)), ...turns(9)];
    expect(await maybeCompact(messages)).toBe(false);
    expect(model.invoke).not.toHaveBeenCalled();
  });

  it('keeps the conversation when the summary comes back empty', async () => {
    model.invoke.mockResolvedValue(new AIMessage('  '));
    const messages = [new HumanMessage(tokens(COMPACT_THRESHOLD + 1)), ...turns(20)];
    const before = [...messages];
    await expect(maybeCompact(messages)).rejects.toThrow('empty summary');
    expect(messages).toEqual(before);
  });
});

describe('buildSummaryContent', () => {
  it('labels each message by role and pairs tool calls with their results by id', () => {
    expect(
      buildSummaryContent([
        new SystemMessage('Be brief.'),
        new HumanMessage('Hotels in Kyoto?'),
        new AIMessage({ content: 'Searching.', tool_calls: [{ id: 'call_1', name: 'searchHotels', args: { city: 'Kyoto' } }] }),
        new ToolMessage({ tool_call_id: 'call_1', content: '{"hotels":[]}' }),
        new AIMessage('None found.'),
      ]),
    ).toBe(
      [
        'system: Be brief.',
        'user: Hotels in Kyoto?',
        'assistant: Searching.',
        'tool_use (call_1): searchHotels {"city":"Kyoto"}',
        'tool_result (call_1): {"hotels":[]}',
        'assistant: None found.',
      ].join('\n'),
    );
  });

  it('cuts a tool_use to 200 characters and a tool_result to 500', () => {
    const lines = buildSummaryContent([
      toolCall('call_1', { q: 'x'.repeat(1000) }),
      new ToolMessage({ tool_call_id: 'call_1', content: 'y'.repeat(1000) }),
    ]).split('\n');

    const use = lines[0].slice('tool_use (call_1): '.length);
    const result = lines[1].slice('tool_result (call_1): '.length);
    expect(use).toHaveLength(200);
    expect(use.startsWith('searchHotels {"q":"xxx')).toBe(true);
    expect(use.endsWith('…')).toBe(true);
    expect(result).toHaveLength(500);
    expect(result.endsWith('…')).toBe(true);
  });
});
