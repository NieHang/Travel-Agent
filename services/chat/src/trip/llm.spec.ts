import { AIMessage, AIMessageChunk, HumanMessage, type BaseMessage } from '@langchain/core/messages';
import type { Classified } from './commands.js';
import { BaseCallbackHandler } from '@langchain/core/callbacks/base';

const model = vi.hoisted(() => ({ seen: [] as BaseMessage[][], bound: [] as string[], classify: vi.fn() }));
vi.mock('../llm/model.factory.js', () => ({
  createChatModel: vi.fn(() => ({
    withStructuredOutput: () => ({ invoke: model.classify }),
    bindTools: (tools: { name: string }[]) => {
      model.bound = tools.map((t) => t.name);
      return {
      async stream(messages: BaseMessage[]) {
        model.seen.push([...messages]);
        return (async function* () {
          yield new AIMessageChunk({ content: 'ok' });
        })();
      },
      };
    },
  })),
}));

import { countNights, ModelTripLlm } from './llm.js';
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
  intent: 'chat', locale: 'zh', clarify: null,
  patch: { destination: null, tripType: null, departureDate: null, returnDate: null, travelers: null, preferences: null, budget: null, budgetCurrency: null },
};

describe('ModelTripLlm', () => {
  beforeEach(() => {
    model.seen = [];
    model.classify.mockReset().mockResolvedValue(chatted);
  });

  it('passes callbacks to classify, respond and extractDays', async () => {
    class ExtraHandler extends BaseCallbackHandler { name = 'extra'; }
    const callbacks = [new ExtraHandler()];
    const llm = new ModelTripLlm(undefined, [], { callbacks });
    const input = { text: 'next', state: initialState(), history: [] };
    vi.mocked(createChatModel).mockClear();
    await llm.classify(input, signal());
    await respond(llm, 'answer');
    model.classify.mockResolvedValue({ days: [] });
    await llm.extractDays('Day 1', null, 'zh', signal());
    expect(vi.mocked(createChatModel).mock.calls).toEqual([
      [{ operation: 'trip.classify', callbacks }],
      [{ operation: 'trip.respond', callbacks }],
      [{ operation: 'trip.extract_days', callbacks }],
    ]);
  });

  it('answers with every message of the context, not only the last 20', async () => {
    const input = { text: 'next', state: initialState(), history };
    for await (const _ of new ModelTripLlm().respond('answer', input, new AbortController().signal));
    expect(model.seen[0].slice(1, 31)).toEqual(history);
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

describe('extractDays', () => {
  it('reads a day without stayRef as no hotel that night', async () => {
    model.classify.mockReset().mockResolvedValue({ days: [{ title: 'Day 1', stops: [] }] });
    const days = await new ModelTripLlm().extractDays('Day 1', null, 'en', new AbortController().signal);
    expect(days).toEqual([{ title: 'Day 1', stops: [], stayRef: null }]);
  });

  it('tells extraction that travel legs are not stops', async () => {
    model.classify.mockReset().mockResolvedValue({ days: [] });
    await new ModelTripLlm().extractDays('Day 1', null, 'en', new AbortController().signal);
    const [sent] = model.classify.mock.calls[0] as [BaseMessage[]];
    expect(sent[0].text).toContain('Travel legs');
    // Lines like "Narita Airport → Ueno (Skyliner)" were extracted as stops in live runs.
    expect(sent[0].text).toContain('name the stop after where the leg ends');
    // ...and walks like "清水寺 → 三年坂 → 八坂神社" became one stop.
    expect(sent[0].text).toContain('make each place its own stop');
  });
});
