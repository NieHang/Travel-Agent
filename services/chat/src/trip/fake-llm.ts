import type { ResultGroup } from '@autix/contracts';
import { FAKE_REPLY_CHUNKS } from '../llm/chat-reply/fakes.js';
import type { Classified } from './commands.js';
import type { HistoryMessage, LlmTask, TripLlm } from './llm.js';
import type { Locale, TripDay, TripState } from './state.js';
import type { LoopEvent } from './tool-loop.js';

const CITIES = ['杭州', '里斯本'];
const NULL_PATCH: Classified['patch'] = {
  destination: null, tripType: null, departureDate: null, returnDate: null,
  travelers: null, preferences: null, budget: null, budgetCurrency: null,
};

/** Deterministic stand-in for LLM_FAKE (dev, e2e). Never used in production (loadAuthConfig enforces it). */
export class FakeTripLlm implements TripLlm {
  async classify(
    input: { text: string; state: TripState; history: HistoryMessage[] },
    _signal?: AbortSignal,
  ): Promise<Classified> {
    const city = CITIES.find((c) => input.text.includes(c)) ?? null;
    return {
      intent: city ? 'plan' : 'chat',
      locale: input.state.locale,
      patch: { ...NULL_PATCH, destination: city },
      clarify: null,
    };
  }

  async *respond(
    task: LlmTask,
    input: { text: string | null; state: TripState; history: HistoryMessage[] },
    signal: AbortSignal,
  ): AsyncIterable<LoopEvent> {
    const chunks =
      task === 'answer'
        ? FAKE_REPLY_CHUNKS
        : [`## ${input.state.requirements.destination ?? ''}行程草稿\n\n`, '第 1 天：市区漫步。'];
    for (const delta of chunks) {
      signal.throwIfAborted();
      yield { type: 'text', delta };
    }
  }

  async extractDays(
    draft: string,
    _stays: ResultGroup | null,
    _locale: Locale,
    _signal?: AbortSignal,
  ): Promise<TripDay[]> {
    const city = draft.match(/## (.+)行程草稿/)?.[1] ?? '';
    return [{ title: '第 1 天', stops: [{ name: `${city}市区漫步`, note: null, time: null }], stayRef: null }];
  }
}
