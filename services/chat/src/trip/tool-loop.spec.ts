import { AIMessage, AIMessageChunk, HumanMessage, ToolMessage, type BaseMessage } from '@langchain/core/messages';
import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import { MAX_TOOL_ROUNDS, streamToolLoop, type LoopEvent, type StreamingModel } from './tool-loop.js';

const textChunks = (...parts: string[]) => parts.map((content) => new AIMessageChunk({ content }));
const callChunk = (id: string, name: string, args: unknown, raw = JSON.stringify(args)) =>
  new AIMessageChunk({ content: '', tool_call_chunks: [{ id, name, args: raw, index: 0, type: 'tool_call_chunk' }] });

/** Each invocation streams the next scripted round and records the conversation it saw. */
function scripted(rounds: AIMessageChunk[][]): StreamingModel & { seen: BaseMessage[][] } {
  const seen: BaseMessage[][] = [];
  let i = 0;
  return {
    seen,
    async stream(messages) {
      seen.push([...messages]);
      const round = rounds[Math.min(i++, rounds.length - 1)];
      return (async function* () {
        yield* round;
      })();
    },
  };
}

const searchHotels = tool(async ({ city }: { city: string }) => `{"hotels":[{"name":"Casa ${city}"}]}`, {
  name: 'searchHotels',
  description: 'search',
  schema: z.object({ city: z.string() }),
});
const broken = tool(async () => {
  throw new Error('provider down');
}, { name: 'broken', description: 'fails', schema: z.object({}) });

async function collect(model: StreamingModel, signal = new AbortController().signal) {
  const events: LoopEvent[] = [];
  for await (const e of streamToolLoop(model, [searchHotels, broken], [new HumanMessage('hi')], signal)) events.push(e);
  return events;
}

/** A local tool whose output the loop must pass through untouched and not record. */
const rawTool = (output: string) =>
  tool(async () => output, { name: 'load_skill', description: 'load', schema: z.object({ names: z.array(z.string()) }) });

async function collectUnrecorded(model: StreamingModel, output: string) {
  const events: LoopEvent[] = [];
  const loop = streamToolLoop(model, [searchHotels, rawTool(output)], [new HumanMessage('hi')], new AbortController().signal, MAX_TOOL_ROUNDS, new Set(['load_skill']));
  for await (const e of loop) events.push(e);
  return events;
}

const validItem = {
  source: 'c1', id: null, title: { original: 'Casa Lisboa', translation: null }, address: null, price: null,
  rating: null, url: null, image: null, details: [], amenities: [], summary: null,
};

describe('streamToolLoop', () => {
  it('asks the model to retry a tool call whose arguments are not valid JSON', async () => {
    const model = scripted([
      [callChunk('c1', 'show_results', null, '{"panel": "hotels", "items": [{"source": "c1"}}, "x"]}')],
      [callChunk('c2', 'show_results', { panel: 'hotels', items: [validItem] })],
      textChunks('done'),
    ]);
    const events = await collect(model);
    expect(events.filter((e) => e.type === 'show_results')).toHaveLength(1);
    expect(events.at(-1)).toEqual({ type: 'text', delta: 'done' });
    // The broken call is not sent back (the API would reject a ToolMessage for it); a server note is.
    expect(model.seen[1].some((m) => AIMessage.isInstance(m))).toBe(false);
    const note = model.seen[1].at(-1);
    expect(note).toBeInstanceOf(HumanMessage);
    expect(note?.text).toContain('show_results');
  });

  it('streams plain text from a round without tool calls', async () => {
    const events = await collect(scripted([textChunks('你', '好')]));
    expect(events).toEqual([{ type: 'text', delta: '你' }, { type: 'text', delta: '好' }]);
  });

  it('runs tools, reports results, then streams the final text', async () => {
    const model = scripted([[callChunk('c1', 'searchHotels', { city: 'Lisboa' })], textChunks('done')]);
    const events = await collect(model);
    expect(events[0]).toEqual({ type: 'tool_call', name: 'searchHotels', args: { city: 'Lisboa' } });
    expect(events[1]).toMatchObject({
      type: 'tool_results',
      results: [{ callId: 'c1', tool: 'searchHotels', args: { city: 'Lisboa' }, isError: false }],
    });
    expect(events.at(-1)).toEqual({ type: 'text', delta: 'done' });
    expect(model.seen[1].at(-1)).toBeInstanceOf(ToolMessage);
  });

  it.each([
    ['a skill body', 'TOKYO-NOTES'],
    ['a long body with JSON-looking text', 'x'.repeat(13_000) + '{"a":1}'],
  ])('runs an unrecorded tool without recording its result (%s)', async (_, output) => {
    const model = scripted([[callChunk('c1', 'load_skill', { names: ['japan-tokyo'] })], textChunks('done')]);
    const events = await collectUnrecorded(model, output);
    expect(events[0]).toEqual({ type: 'tool_call', name: 'load_skill', args: { names: ['japan-tokyo'] } });
    expect(events.some((e) => e.type === 'tool_results')).toBe(false);
    const message = model.seen[1].at(-1);
    expect(message).toBeInstanceOf(ToolMessage);
    expect(message?.content).toBe(output);
  });

  it('shows the model each result with the callId that show_results items must cite', async () => {
    const model = scripted([[callChunk('c1', 'searchHotels', { city: 'Lisboa' })], textChunks('done')]);
    await collect(model);
    const reply = JSON.parse(String((model.seen[1].at(-1) as ToolMessage).content));
    expect(reply).toMatchObject({ callId: 'c1', isError: false });
  });

  it('feeds tool errors back as error results instead of failing', async () => {
    const events = await collect(scripted([[callChunk('c9', 'broken', {})], textChunks('sorry')]));
    expect(events[1]).toMatchObject({ type: 'tool_results', results: [{ callId: 'c9', isError: true }] });
  });

  it('emits show_results with the results so far and answers "shown"', async () => {
    const model = scripted([
      [callChunk('c1', 'searchHotels', { city: 'Lisboa' })],
      [callChunk('s1', 'show_results', { panel: 'hotels', items: [validItem] })],
      textChunks('ok'),
    ]);
    const events = await collect(model);
    const shown = events.find((e) => e.type === 'show_results');
    expect(shown).toMatchObject({ type: 'show_results', input: { panel: 'hotels' }, results: [{ callId: 'c1' }] });
    const reply = model.seen[2].at(-1) as ToolMessage;
    expect(reply.content).toBe('shown');
  });

  it('feeds invalid show_results arguments back and keeps going', async () => {
    const model = scripted([[callChunk('s1', 'show_results', { panel: 'hotels', items: [{ title: 3 }] })], textChunks('ok')]);
    const events = await collect(model);
    expect(events.some((e) => e.type === 'show_results')).toBe(false);
    expect(String((model.seen[1].at(-1) as ToolMessage).content)).toMatch(/^Invalid show_results arguments/);
    expect(events.at(-1)).toEqual({ type: 'text', delta: 'ok' });
  });

  it('stops after MAX_TOOL_ROUNDS', async () => {
    const model = scripted([[callChunk('c1', 'searchHotels', { city: 'x' })]]);
    await collect(model);
    expect(model.seen).toHaveLength(MAX_TOOL_ROUNDS);
  });

  it('stops when aborted', async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(collect(scripted([textChunks('x')]), controller.signal)).rejects.toThrow();
  });
});
