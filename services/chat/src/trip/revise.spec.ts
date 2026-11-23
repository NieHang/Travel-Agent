import { readFileSync } from 'node:fs';
import { AIMessageChunk, ToolMessage, type BaseMessage } from '@langchain/core/messages';
import { ResultGroupSchema } from '@autix/contracts';

const model = vi.hoisted(() => ({ rounds: [] as unknown[][], seen: [] as BaseMessage[][] }));
vi.mock('../llm/model.factory.js', () => ({
  createChatModel: vi.fn(() => ({
    bindTools: () => ({
      async stream(messages: BaseMessage[]) {
        model.seen.push([...messages]);
        const round = model.rounds.shift() ?? [];
        return (async function* () {
          yield* round;
        })();
      },
    }),
  })),
}));

import { runEffect } from './effect.js';
import { parseDraft } from './itinerary.js';
import { ModelTripLlm } from './llm.js';
import { initialState, type TripState } from './state.js';

const fixture = (name: string) => readFileSync(new URL(`../../test/fixtures/drafts/${name}`, import.meta.url), 'utf8');
const stays = ResultGroupSchema.parse(JSON.parse(fixture('kyoto.stays.json')));
const call = (id: string, name: string, args: unknown) =>
  new AIMessageChunk({ content: '', tool_call_chunks: [{ id, name, args: JSON.stringify(args), index: 0, type: 'tool_call_chunk' }] });

const hotel = (hotelId: number, name: string, price: string) => ({
  hotelId, name, lowestPrice: price, hotelAmenities: [], tags: [], imageUrl: null,
});
// The draft's search found a cheaper hotel (Kyoto Budget Inn) that the draft did not show.
const draftSearch = {
  callId: 't1',
  tool: 'searchHotels',
  args: { cityName: 'Kyoto' },
  content: JSON.stringify({ hotels: [hotel(1549991, 'hotel MONday Kyoto Marutamachi', '1093.33 CNY'), hotel(777, 'Kyoto Budget Inn', '420 CNY')] }),
  isError: false,
};

function drafted(): TripState {
  const draft = parseDraft(fixture('kyoto.en.md'), stays);
  return {
    ...initialState(4, 'en'), stage: 'review', stays, toolResults: [draftSearch],
    preamble: draft.preamble, footer: draft.footer, days: draft.days.map((d) => ({ ...d, stops: [] })),
  };
}

describe('revise: a cheaper hotel from an earlier turn', () => {
  it('shows and uses a hotel cited from a stored search without searching again', async () => {
    const budgetInn = {
      source: 't1', id: '777', title: { original: 'Kyoto Budget Inn', translation: null }, amenities: [], summary: null,
    };
    model.rounds = [
      [call('c1', 'show_results', { panel: 'hotels', items: [budgetInn] })],
      [call('c2', 'use_stay', { hotelId: '777', days: [1, 2, 3] })],
      [new AIMessageChunk({ content: 'You now stay at Kyoto Budget Inn.' })],
    ];
    const state = drafted();
    const events = runEffect(new ModelTripLlm(), { type: 'revise', target: { days: [], nights: [0, 1, 2] } }, { text: 'Can we stay somewhere cheaper?', state, history: [] }, new AbortController().signal);
    for (let step = await events.next(); !step.done; step = await events.next());

    const useStayReply = model.seen[2].at(-1) as ToolMessage;
    expect(useStayReply.content).toBe('ok');
    const inn = state.stays?.items.find((h) => h.id === '777');
    expect(inn?.price).toEqual({ amount: 420, currency: 'CNY' });
    expect(state.days.map((d) => d.stayRef)).toEqual([inn?.ref, inn?.ref, inn?.ref, null]);
  });
});
