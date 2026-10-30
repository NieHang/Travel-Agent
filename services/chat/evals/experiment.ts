import { AIMessage, HumanMessage } from '@langchain/core/messages';
import { createLlmTotals, newTraceId, runWithTrace } from '../src/observability/trace-context.js';
import type { TripLlm } from '../src/trip/llm.js';
import { initialState } from '../src/trip/state.js';
import { gradeClassify } from './evaluators/classify.js';
import { gradeExtractDays } from './evaluators/extract-days.js';
import type { Entry, RunResult, Score, Suite } from './schemas.js';

export type ItemResult = RunResult['items'][number];

export async function executeItem(item: Entry, llm: TripLlm): Promise<ItemResult> {
  const totals = createLlmTotals();
  return runWithTrace(newTraceId(), async () => {
    const started = performance.now();
    const signal = AbortSignal.timeout(180_000);
    const result = await runItem(item, llm, signal).catch((error: unknown): ItemResult => {
      if (signal.aborted) throw error;
      return { id: item.id, category: item.category, output: null, error: error instanceof Error ? error.message : String(error), scores: failedScores(item) };
    });
    await totals.whenIdle();
    return { ...result, scores: [
      ...result.scores,
      { name: 'task_error', value: Number(result.output === null) },
      { name: 'cost_usd', value: totals.costUsd },
      { name: 'input_tokens', value: totals.inputTokens },
      { name: 'output_tokens', value: totals.outputTokens },
      { name: 'latency_ms', value: performance.now() - started },
    ] };
  }, totals);
}

async function runItem(item: Entry, llm: TripLlm, signal: AbortSignal): Promise<ItemResult> {
  if ('text' in item) {
    const state = { ...initialState(0, item.locale), ...item.state };
    const history = item.history.map((message) => message.role === 'user' ? new HumanMessage(message.text) : new AIMessage(message.text));
    const output = await llm.classify({ text: item.text, state, history }, signal);
    return { id: item.id, category: item.category, output, scores: gradeClassify(output, item.expected) };
  }
  const days = await llm.extractDays(item.draft, item.stays, item.locale, signal);
  return {
    id: item.id, category: item.category,
    output: days.map((day) => ({ stops: day.stops.map((stop) => stop.name), stayRef: day.stayRef })),
    scores: gradeExtractDays(days, item.expected),
  };
}

// A failed task scores zero on every accuracy metric, so it still counts against the run. Rate metrics
// (patch_hallucination, leg_as_stop) have no meaningful value without an output and are left out.
function failedScores(item: Entry): Score[] {
  if ('text' in item)
    return [
      { name: 'intent_acc', value: 0 },
      { name: 'patch_exact', value: 0 },
      ...Object.keys(item.expected.patch).map((key) => ({ name: `patch_field_${key}`, value: 0 })),
      { name: 'clarify_match', value: 0 },
    ];
  return ['day_count_exact', 'stop_f1', 'stay_ref_acc'].map((name) => ({ name, value: 0 }));
}

export function runName(suite: Suite, sha: string, dirty: boolean, tag: string | undefined, trial: number): string {
  return `${suite}@${sha}${dirty ? '-dirty' : ''}${tag ? `-${tag}` : ''}#${trial}`;
}
