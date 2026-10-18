import { AIMessage, AIMessageChunk, HumanMessage, type BaseMessage } from '@langchain/core/messages';
import type { Classified } from './commands.js';

const model = vi.hoisted(() => ({ seen: [] as BaseMessage[][], classify: vi.fn() }));
vi.mock('../llm/model.factory.js', () => ({
  createChatModel: () => ({
    withStructuredOutput: () => ({ invoke: model.classify }),
    bindTools: () => ({
      async stream(messages: BaseMessage[]) {
        model.seen.push([...messages]);
        return (async function* () {
          yield new AIMessageChunk({ content: 'ok' });
        })();
      },
    }),
  }),
}));

import { ModelTripLlm } from './llm.js';
import { initialState } from './state.js';

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
