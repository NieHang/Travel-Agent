import { FakeTripLlm } from '../src/trip/fake-llm.js';
import { getLlmTotals } from '../src/observability/trace-context.js';
import { executeItem, runName } from './experiment.js';
import type { ClassifyEntry, ExtractDaysEntry } from './schemas.js';

const entry: ClassifyEntry = {
  id: 'cls-zh-partial-01', category: 'partial', locale: 'zh', today: '2026-10-30',
  state: { stage: 'idle', requirements: {} }, history: [{ role: 'assistant', text: '想去哪里？' }], text: '去杭州',
  expected: { intent: 'plan', patch: { destination: '杭州' }, clarifyField: null },
};

it('runs a real fake-LLM classify task through grading and metering', async () => {
  const result = await executeItem(entry, new FakeTripLlm());
  expect(result.output).toEqual({
    intent: 'plan', locale: 'zh', clarify: null,
    patch: { destination: '杭州', tripType: null, departureDate: null, returnDate: null, travelers: null, preferences: null, budget: null, budgetCurrency: null },
  });
  expect(result.scores).toContainEqual({ name: 'patch_exact', value: 1 });
  expect(result.scores).toContainEqual({ name: 'input_tokens', value: 0 });
  expect(result.scores).toContainEqual({ name: 'cost_usd', value: 0 });
  expect(result.scores.find((score) => score.name === 'latency_ms')?.value).toBeGreaterThanOrEqual(0);
});

it('waits for in-flight metering before reading totals', async () => {
  const llm = new FakeTripLlm();
  const classify = llm.classify.bind(llm);
  vi.spyOn(llm, 'classify').mockImplementation(async (input) => {
    const totals = getLlmTotals()!;
    totals.beginCall();
    setTimeout(() => {
      totals.add({ inputTokens: 12, cachedInputTokens: 0, outputTokens: 4, costUsd: 0.03, usageSource: 'provider' });
      totals.endCall();
    }, 5);
    return classify(input);
  });
  const result = await executeItem(entry, llm);
  expect(result.scores).toContainEqual({ name: 'input_tokens', value: 12 });
  expect(result.scores).toContainEqual({ name: 'output_tokens', value: 4 });
  expect(result.scores).toContainEqual({ name: 'cost_usd', value: 0.03 });
});

it('keeps a failed task as a zero-scored item with its error', async () => {
  const llm = new FakeTripLlm();
  vi.spyOn(llm, 'classify').mockRejectedValue(new Error('Failed to parse'));
  const result = await executeItem(entry, llm);
  expect(result).toMatchObject({ id: 'cls-zh-partial-01', output: null, error: 'Failed to parse' });
  expect(result.scores.slice(0, 5)).toEqual([
    { name: 'intent_acc', value: 0 }, { name: 'patch_exact', value: 0 },
    { name: 'patch_field_destination', value: 0 }, { name: 'clarify_match', value: 0 },
    { name: 'task_error', value: 1 },
  ]);
});

it('summarizes fake extraction as stop names and stays', async () => {
  const extraction: ExtractDaysEntry = {
    id: 'ext-zh-01', category: 'single_city', locale: 'zh', today: '2026-10-30',
    draft: '## 杭州行程草稿', stays: null,
    expected: { days: [{ stops: ['杭州市区漫步'], stayRef: null }] },
  };
  const result = await executeItem(extraction, new FakeTripLlm());
  expect(result.output).toEqual([{ stops: ['杭州市区漫步'], stayRef: null }]);
  expect(result.scores).toContainEqual({ name: 'stop_f1', value: 1 });
});

it('names clean and dirty tagged trials', () => {
  expect(runName('classify', 'abc1234', false, undefined, 1)).toBe('classify@abc1234#1');
  expect(runName('extract-days', 'abc1234', true, 'test', 3)).toBe('extract-days@abc1234-dirty-test#3');
});
