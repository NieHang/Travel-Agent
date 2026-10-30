import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';
import { metricMeans, USAGE_METRICS } from './metrics.js';
import { ResultSchema, type RunResult, type Score } from './schemas.js';

export const ThresholdsSchema = z.record(z.record(z.object({ maxDrop: z.number().nonnegative().optional(), maxRise: z.number().nonnegative().optional() }).strict()));
type Gates = z.infer<typeof ThresholdsSchema>[string];

export async function readRuns(folder: string, prefix: string): Promise<RunResult[]> {
  // Exact run name plus trial number: a plain prefix would let `-vague` also read `-vague-fix` trials.
  const names = (await readdir(folder)).filter((name) => name.startsWith(`${prefix}_`) && /^\d+\.json$/.test(name.slice(prefix.length + 1))).sort();
  if (!names.length) throw new Error(`No result files matching ${prefix}`);
  return Promise.all(names.map(async (name) => ResultSchema.parse(JSON.parse(await readFile(join(folder, name), 'utf8')))));
}

export function compareRuns(base: RunResult[], candidate: RunResult[], gates: Gates) {
  const suite = base[0].suite;
  if ([...base, ...candidate].some((run) => run.suite !== suite)) throw new Error('Cannot compare different suites');
  const baseline = averageItems(base);
  const next = averageItems(candidate);
  if (baseline.size !== next.size || [...baseline.keys()].some((id) => !next.has(id))) throw new Error('Cannot compare different item sets; sync and rerun both variants');
  const metrics = metricTable(aggregate(baseline, base), aggregate(next, candidate));
  const categories = [...new Set([...baseline.values()].map((item) => item.category))].flatMap((category) =>
    metricTable(
      metricMeans([...baseline.values()].filter((item) => item.category === category).flatMap((item) => item.scores)),
      metricMeans([...next.values()].filter((item) => item.category === category).flatMap((item) => item.scores)),
    ).map((row) => ({ category, ...row })),
  );
  // clarify_match too: a request for suggestions that stops asking keeps patch_exact at 1.
  const regressionMetrics = suite === 'classify' ? ['patch_exact', 'clarify_match'] : ['stop_f1'];
  const regressed = [...baseline].filter(([id, item]) => {
    const after = next.get(id)!;
    const dropped = regressionMetrics.some((metric) => {
      const beforeScore = item.scores.find((score) => score.name === metric)?.value;
      const afterScore = after.scores.find((score) => score.name === metric)?.value;
      return beforeScore !== undefined && afterScore !== undefined && beforeScore - afterScore >= 0.5;
    });
    if (dropped) return true;
    const baseIntent = base.flatMap((run) => run.items.filter((entry) => entry.id === id).flatMap((entry) => entry.scores.filter((score) => score.name === 'intent_acc')));
    const candidateIntent = candidate.flatMap((run) => run.items.filter((entry) => entry.id === id).flatMap((entry) => entry.scores.filter((score) => score.name === 'intent_acc')));
    return baseIntent.length > 0 && baseIntent.every((score) => score.value === 1) && candidateIntent.some((score) => score.value === 0);
  }).map(([id]) => id);
  const flaky = ([['base', base], ['candidate', candidate]] as const).flatMap(([label, runs]) =>
    [...averageItems(runs)].flatMap(([id, item]) => item.scores.filter((score) => !USAGE_METRICS.has(score.name)).flatMap((score) => {
      const values = runs.flatMap((run) => run.items.filter((entry) => entry.id === id).flatMap((entry) => entry.scores.filter((entryScore) => entryScore.name === score.name).map((entryScore) => entryScore.value)));
      return new Set(values).size > 1 ? [{ run: label, id, metric: score.name, values }] : [];
    })),
  );
  const violations = metrics.flatMap(({ metric, delta }) => {
    const gate = gates[metric];
    if (gate?.maxDrop !== undefined && -delta > gate.maxDrop + 1e-12) return [`${metric} dropped by ${(-delta).toFixed(4)} (max ${gate.maxDrop})`];
    if (gate?.maxRise !== undefined && delta > gate.maxRise + 1e-12) return [`${metric} rose by ${delta.toFixed(4)} (max ${gate.maxRise})`];
    return [];
  });
  return { metrics, categories, regressed, flaky, violations };
}

/**
 * Gate sizes from an A/A test: two run sets of the same code. Each item's spread across all trials gives
 * the noise in the difference of two run means; the gate is 3 standard deviations of that noise, rounded
 * up to 0.01 and at least 0.02. Run-level scores use the spread of their per-trial values.
 */
export function noiseGates(a: RunResult[], b: RunResult[]) {
  const trials = 1 / a.length + 1 / b.length;
  const itemValues = new Map<string, Map<string, number[]>>();
  for (const run of [...a, ...b]) for (const item of run.items) for (const score of item.scores) {
    const items = itemValues.get(score.name) ?? new Map<string, number[]>();
    items.set(item.id, [...(items.get(item.id) ?? []), score.value]);
    itemValues.set(score.name, items);
  }
  const itemNoise = [...itemValues].map(([metric, items]) => ({
    metric, sd: Math.sqrt([...items.values()].reduce((sum, values) => sum + variance(values), 0) * trials) / items.size,
  }));
  const runMetrics = new Set([...a, ...b].flatMap((run) => run.scores.map((score) => score.name)));
  const runNoise = [...runMetrics].map((metric) => ({
    metric, sd: Math.sqrt(variance([...a, ...b].flatMap((run) => run.scores.filter((score) => score.name === metric).map((score) => score.value))) * trials),
  }));
  return [...itemNoise, ...runNoise].map(({ metric, sd }) => ({ metric, sd, gate: Math.max(0.02, Math.ceil(3 * sd * 100) / 100) }));
}

function variance(values: number[]): number {
  if (values.length < 2) return 0;
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  return values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (values.length - 1);
}

function averageItems(runs: RunResult[]): Map<string, { category: string; scores: Score[] }> {
  const items = new Map<string, { category: string; scores: Score[] }>();
  for (const run of runs) for (const item of run.items) {
    items.set(item.id, { category: item.category, scores: [...(items.get(item.id)?.scores ?? []), ...item.scores] });
  }
  return new Map([...items].map(([id, item]) => [id, {
    category: item.category, scores: metricMeans(item.scores).map(([name, value]) => ({ name, value })),
  }]));
}

function aggregate(items: ReturnType<typeof averageItems>, runs: RunResult[]): [string, number][] {
  return [...metricMeans([...items.values()].flatMap((item) => item.scores)), ...metricMeans(runs.flatMap((run) => run.scores))];
}

function metricTable(base: [string, number][], candidate: [string, number][]) {
  const next = new Map(candidate);
  return base.filter(([metric]) => next.has(metric)).map(([metric, value]) => ({
    metric, base: value, candidate: next.get(metric)!, delta: next.get(metric)! - value,
  }));
}
