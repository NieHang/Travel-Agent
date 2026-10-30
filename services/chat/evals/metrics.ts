import type { Score } from './schemas.js';

/** Cost and speed vary on every call; they are reported, never gated or listed as flaky. */
export const USAGE_METRICS = new Set(['cost_usd', 'input_tokens', 'output_tokens', 'latency_ms']);

export function metricMeans(scores: Score[]): [string, number][] {
  const groups = new Map<string, number[]>();
  for (const score of scores) groups.set(score.name, [...(groups.get(score.name) ?? []), score.value]);
  return [...groups].map(([name, values]) => [name, values.reduce((sum, value) => sum + value, 0) / values.length]);
}
