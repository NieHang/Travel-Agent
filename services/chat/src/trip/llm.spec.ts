import { AIMessage, AIMessageChunk, HumanMessage, type BaseMessage } from '@langchain/core/messages';
import type { Classified } from './commands.js';
import { BaseCallbackHandler } from '@langchain/core/callbacks/base';

// The checks run against fixture records only, so the real library can change without touching these expectations.
vi.mock('../places/records/kyoto.js', async () => ({ kyoto: (await import('../../test/fixtures/place-records.js')).records }));
vi.mock('../places/records/nara.js', () => ({ nara: [] }));
vi.mock('../places/records/osaka.js', () => ({ osaka: [] }));
vi.mock('../places/records/tokyo.js', () => ({ tokyo: [] }));

const model = vi.hoisted(() => ({ seen: [] as BaseMessage[][], streamOptions: [] as { runName?: string }[], bound: [] as string[], classify: vi.fn() }));
vi.mock('../llm/model.factory.js', () => ({
  createChatModel: vi.fn(() => ({
    withStructuredOutput: () => ({ invoke: model.classify }),
    bindTools: (tools: { name: string }[]) => {
      model.bound = tools.map((t) => t.name);
      return {
      async stream(messages: BaseMessage[], options: { runName?: string }) {
        model.seen.push([...messages]);
        model.streamOptions.push(options);
        return (async function* () {
          yield new AIMessageChunk({ content: 'ok' });
        })();
      },
      };
    },
  })),
}));

import { CLASSIFY_PROMPT, LOCATE_PROMPT, countNights, ModelTripLlm } from './llm.js';
import { initialState } from './state.js';
import type { Skill } from '../skills/registry.js';
import { createChatModel } from '../llm/model.factory.js';

const core: Skill = { name: 'japan-travel', description: 'Japan rules', always: true, body: 'JAPAN-RULES' };
const tokyo: Skill = { name: 'japan-tokyo', description: 'Tokyo (东京)', always: false, body: 'TOKYO-NOTES' };
const signal = () => new AbortController().signal;
const systemText = (messages: BaseMessage[]) => messages[0].text;

async function respond(llm: ModelTripLlm, task: 'answer' | 'itinerary') {
  model.seen = [];
  for await (const _ of llm.respond(task, { text: 'next', state: initialState(), history: [] }, signal()));
  return systemText(model.seen[0]);
}

const history = Array.from({ length: 30 }, (_, i) => (i % 2 ? new AIMessage(`m${i}`) : new HumanMessage(`m${i}`)));
const chatted: Classified = {
  intent: 'chat', locale: 'zh', clarify: null, revise: null,
  patch: { destination: null, tripType: null, departureDate: null, returnDate: null, travelers: null, preferences: null, budget: null, budgetCurrency: null },
};

describe('ModelTripLlm', () => {
  beforeEach(() => {
    model.seen = [];
    model.streamOptions = [];
    model.classify.mockReset().mockResolvedValue(chatted);
  });

  it.each([
    [{ japan: ' Fukuoka ', outside: [' Seoul ', '', '   '] }, { japan: 'Fukuoka', outside: ['Seoul'] }],
    [{ japan: '   ', outside: [' 成都 '] }, { japan: null, outside: ['成都'] }],
    [{ japan: null, outside: [] }, { japan: null, outside: [] }],
  ])('locates a destination with the dedicated prompt and normalises %j', async (output, expected) => {
    model.classify.mockResolvedValue(output);
    const abort = signal();
    expect(await new ModelTripLlm().locate('Seoul then Fukuoka', abort)).toEqual(expected);
    const [sent, options] = model.classify.mock.calls[0] as [BaseMessage[], { signal: AbortSignal }];
    expect(sent.map((message) => message.text)).toEqual([LOCATE_PROMPT, 'Seoul then Fukuoka']);
    expect(options).toEqual({ signal: abort, runName: 'trip.locate' });
    expect(createChatModel).toHaveBeenCalledWith({ operation: 'trip.locate', callbacks: undefined });
  });

  it('limits suggested destinations and answers to Japan', async () => {
    expect(CLASSIFY_PROMPT).toContain('Suggested destinations (clarify options only) are places in Japan');
    expect(await respond(new ModelTripLlm(), 'answer')).toContain('Hilda covers travel in Japan only. If the user asks about visiting a place outside Japan, say briefly that Hilda only plans trips in Japan, and call no tools.');
  });

  it('tells both tasks that a hotel price is per night', async () => {
    for (const task of ['answer', 'itinerary'] as const)
      expect(await respond(new ModelTripLlm(), task)).toContain("A hotel's lowestPrice is per night, not for the whole stay.");
  });

  it('uses the injected date in the system prompt sent by respond', async () => {
    expect(await respond(new ModelTripLlm(undefined, [], { today: '2026-01-15' }), 'answer'))
      .toContain('Today is 2026-01-15.');
  });

  it('passes callbacks to classify, respond and extractStops', async () => {
    class ExtraHandler extends BaseCallbackHandler { name = 'extra'; }
    const callbacks = [new ExtraHandler()];
    const llm = new ModelTripLlm(undefined, [], { callbacks });
    const input = { text: 'next', state: initialState(), history: [] };
    vi.mocked(createChatModel).mockClear();
    await llm.classify(input, signal());
    await respond(llm, 'answer');
    model.classify.mockResolvedValue({ stops: [] });
    await llm.extractStops({ title: 'Day 1', body: '' }, 'zh', signal());
    expect(vi.mocked(createChatModel).mock.calls).toEqual([
      [{ operation: 'trip.classify', callbacks }],
      [{ operation: 'trip.respond', callbacks }],
      [{ operation: 'trip.extract_stops', callbacks }],
    ]);
  });

  it('names each generation for the Langfuse trace', async () => {
    const llm = new ModelTripLlm();
    await llm.classify({ text: 'next', state: initialState(), history: [] }, signal());
    expect(model.classify.mock.calls.at(-1)?.[1]).toMatchObject({ runName: 'trip.classify' });
    model.classify.mockResolvedValue({ japan: 'Kyoto', outside: [] });
    await llm.locate('Kyoto', signal());
    expect(model.classify.mock.calls.at(-1)?.[1]).toMatchObject({ runName: 'trip.locate' });
    await respond(llm, 'answer');
    expect(model.streamOptions.at(-1)).toMatchObject({ runName: 'trip.respond' });
    model.classify.mockResolvedValue({ stops: [] });
    await llm.extractStops({ title: 'Day 1', body: '' }, 'en', signal());
    expect(model.classify.mock.calls.at(-1)?.[1]).toMatchObject({ runName: 'trip.extract_stops' });
  });

  it('answers with every message of the context, not only the last 20', async () => {
    const input = { text: 'next', state: initialState(), history };
    for await (const _ of new ModelTripLlm().respond('answer', input, new AbortController().signal));
    expect(model.seen[0].slice(1, 31)).toEqual(history);
  });

  it('keeps the first clarify options when the model returns too many', async () => {
    model.classify.mockResolvedValue({ ...chatted, clarify: { field: 'destination', question: '去哪？', options: ['北京', '上海', '广州', '深圳', '成都', '杭州'] } });
    const classified = await new ModelTripLlm().classify({ text: '想出去玩', state: initialState(), history: [] }, signal());
    expect(classified.clarify?.options).toEqual(['北京', '上海', '广州', '深圳', '成都']);
  });

  it('gives classify the date to resolve relative dates', async () => {
    await new ModelTripLlm(undefined, [], { today: '2026-10-30' }).classify({ text: '12月1号出发', state: initialState(), history: [] }, signal());
    const [sent] = model.classify.mock.calls[0] as [BaseMessage[]];
    expect(systemText(sent)).toContain('Today is 2026-10-30.');
  });

  it('classifies with every message of the context', async () => {
    await new ModelTripLlm().classify({ text: 'next', state: initialState(), history }, new AbortController().signal);
    const [sent] = model.classify.mock.calls[0] as [BaseMessage[]];
    expect(sent.slice(1, 31)).toEqual(history);
  });
});

describe('ModelTripLlm skills', () => {
  beforeEach(() => {
    model.seen = [];
    model.bound = [];
    model.classify.mockReset().mockResolvedValue(chatted);
  });

  it.each(['answer', 'itinerary'] as const)('puts always skills into the %s prompt', async (task) => {
    const system = await respond(new ModelTripLlm(undefined, [core, tokyo]), task);
    expect(system).toContain('JAPAN-RULES');
    expect(system).toContain('approx');
    expect(system).not.toContain('TOKYO-NOTES');
  });

  it('lists on-demand skills and binds load_skill', async () => {
    const system = await respond(new ModelTripLlm(undefined, [core, tokyo]), 'itinerary');
    expect(system).toContain('japan-tokyo: Tokyo (东京)');
    expect(model.bound).toContain('load_skill');
  });

  it('keeps the prompt and tools unchanged without skills', async () => {
    const system = await respond(new ModelTripLlm(undefined, []), 'itinerary');
    expect(system).toContain('Never invent prices, availability, addresses or distances');
    for (const text of ['Skill ', 'load_skill', 'approx']) expect(system).not.toContain(text);
    expect(model.bound).toEqual(['show_results']);
  });

  it('does not bind load_skill when every skill is always', async () => {
    const system = await respond(new ModelTripLlm(undefined, [core]), 'answer');
    expect(system).toContain('JAPAN-RULES');
    expect(model.bound).not.toContain('load_skill');
  });

  it('never gives skills to classify', async () => {
    await new ModelTripLlm(undefined, [core, tokyo]).classify({ text: 'next', state: initialState(), history: [] }, signal());
    const [sent] = model.classify.mock.calls[0] as [BaseMessage[]];
    expect(systemText(sent)).not.toContain('JAPAN-RULES');
    expect(systemText(sent)).not.toContain('japan-tokyo');
  });
});

describe('countNights', () => {
  it('counts nights between the trip dates, 0 for a same-day trip', () => {
    expect(countNights({ departureDate: '2026-12-01', returnDate: '2026-12-03' })).toBe(2);
    expect(countNights({ departureDate: '2026-12-01', returnDate: '2026-12-01' })).toBe(0);
    expect(countNights({ departureDate: '2026-12-01' })).toBeNull();
  });
});

describe('extractStops', () => {
  it('reads one day, header and body, and returns its stops', async () => {
    model.classify.mockReset().mockResolvedValue({ stops: [{ name: 'Nijo Castle', note: null, time: '09:30' }] });
    const stops = await new ModelTripLlm().extractStops({ title: 'Day 3 | Nijo Castle (light)', body: '- 09:30 Nijo Castle' }, 'en', signal());
    expect(stops).toEqual([{ name: 'Nijo Castle', note: null, time: '09:30' }]);
    const [sent] = model.classify.mock.calls[0] as [BaseMessage[]];
    expect(sent[1].text).toBe('Day 3 | Nijo Castle (light)\n- 09:30 Nijo Castle');
  });

  it('tells extraction that travel legs are not stops', async () => {
    model.classify.mockReset().mockResolvedValue({ stops: [] });
    await new ModelTripLlm().extractStops({ title: 'Day 1', body: '' }, 'en', signal());
    const [sent] = model.classify.mock.calls[0] as [BaseMessage[]];
    expect(sent[0].text).toContain('Travel legs');
    // Lines like "Narita Airport → Ueno (Skyliner)" were extracted as stops in live runs, and eval drafts
    // had hotels and transfer stations extracted as stops.
    expect(sent[0].text).toContain('never a route or an arrow');
    expect(sent[0].text).toContain('The hotel is never a stop');
    expect(sent[0].text).toContain('A station is a stop only where');
    // ...and walks like "清水寺 → 三年坂 → 八坂神社" became one stop.
    expect(sent[0].text).toContain('make each place its own stop');
  });
});

describe('revise', () => {
  const drafted = () => ({
    ...initialState(3, 'en'),
    stage: 'review' as const,
    preamble: '**Overview**: 2 nights',
    requirements: { destination: 'Kyoto', departureDate: '2026-11-30', returnDate: '2026-12-01' },
    days: [
      { title: 'Day 1 | A (light)', body: '- 10:00 A', stops: [], stayRef: null },
      { title: 'Day 2 | B (light)', body: '- 10:00 B', stops: [{ name: '兴福寺', time: null, note: null }, { name: '东本愿寺', time: '16:00', note: null }], stayRef: null },
    ],
  });

  it('binds the edit tools only for revise, and gives the model the numbered plan and 1-based target', async () => {
    const llm = new ModelTripLlm();
    for await (const _ of llm.respond('revise', { text: 'day 2 lighter', state: drafted(), history: [], target: { days: [1], nights: [] } }, signal()));
    expect(model.bound).toEqual(['show_results', 'write_day', 'write_preamble', 'use_stay']);
    const context = JSON.parse(model.seen[0].at(-2)?.text ?? '{}') as { serverContext: { plan: string; target: unknown } };
    expect(context.serverContext.plan).toContain('[D2] **Day 2 | B (light)**');
    expect(context.serverContext).toMatchObject({
      placeFacts: ['Higashi Hongan-ji (东本愿寺): open 06:20–16:30 on your dates', 'Fushimi Inari Taisha (伏见稻荷大社): rail access: JR, private rail'],
      placeChecks: ['[D2] 兴福寺: The five-storey pagoda is closed through 2031-03-31.',
        '[D2] 东本愿寺 (16:00): At the estimated visit duration, the visit runs past closing at 16:30.'],
    });
    expect(context.serverContext.target).toEqual({ days: [2], nights: [] });
    expect(systemText(model.seen[0])).toContain('Task: change only part of the itinerary draft');
    await respond(llm, 'answer');
    expect(model.bound).toEqual(['show_results']);
  });
});
