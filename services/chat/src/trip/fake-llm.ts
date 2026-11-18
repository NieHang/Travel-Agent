import type { BaseMessage } from '@langchain/core/messages';
import type { Classified, Place } from './commands.js';
import type { PlanDay, Stop } from './itinerary.js';
import type { LlmTask, RespondInput, TripLlm } from './llm.js';
import type { Locale, TripState } from './state.js';
import type { LoopEvent } from './tool-loop.js';

const FAKE_REPLY_CHUNKS = ['好的，', '这是一段', '用于测试的回复。'];
const CITIES = ['杭州', '里斯本'];
const NULL_PATCH: Classified['patch'] = {
  destination: null, tripType: null, departureDate: null, returnDate: null,
  travelers: null, preferences: null, budget: null, budgetCurrency: null,
};

/** Deterministic stand-in for LLM_FAKE (dev, e2e). Never used in production (loadAuthConfig enforces it). */
export class FakeTripLlm implements TripLlm {
  // Treat every destination as Japan so existing dev/e2e flows with 杭州 / 里斯本 keep working.
  async locate(destination: string, _signal?: AbortSignal): Promise<Place> {
    return { japan: destination, outside: [] };
  }

  async classify(
    input: { text: string; state: TripState; history: BaseMessage[] },
    _signal?: AbortSignal,
  ): Promise<Classified> {
    const city = CITIES.find((c) => input.text.includes(c)) ?? null;
    return {
      intent: city ? 'plan' : 'chat',
      locale: input.state.locale,
      patch: { ...NULL_PATCH, destination: city },
      clarify: null,
      revise: null,
    };
  }

  async *respond(task: LlmTask, input: RespondInput, signal: AbortSignal): AsyncIterable<LoopEvent> {
    if (task === 'revise') {
      // Rewrites the first target day and replies with a one-line summary.
      const day = (input.target?.days[0] ?? 0) + 1;
      yield { type: 'edit', call: { name: 'write_day', args: { day, markdown: `**第 ${day} 天 | 慢节奏**\n- 10:00 市区散步` } }, results: [] };
      yield { type: 'text', delta: `已调整第 ${day} 天。` };
      return;
    }
    const chunks =
      task === 'answer'
        ? FAKE_REPLY_CHUNKS
        : [`## ${input.state.requirements.destination ?? ''}行程草稿\n\n**总览**：轻松\n\n`, '**第 1 天 | 市区漫步（轻松）**\n- 10:00 市区漫步'];
    for (const delta of chunks) {
      signal.throwIfAborted();
      yield { type: 'text', delta };
    }
  }

  async extractStops(day: Pick<PlanDay, 'title' | 'body'>, _locale: Locale, _signal?: AbortSignal): Promise<Stop[]> {
    const name = day.title.split('|')[1]?.replace(/（.*）/, '').trim() || day.title;
    return [{ name, note: null, time: null }];
  }
}
