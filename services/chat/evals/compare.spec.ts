import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { FakeTripLlm } from '../src/trip/fake-llm.js';
import { executeItem } from './experiment.js';
import { compareRuns, noiseGates, readRuns } from './comparison.js';
import type { RunResult } from './schemas.js';

const run = (name: string, scores: { name: string; value: number }[], id = 'one'): RunResult => ({
  suite: 'extract-days', runName: name, metadata: {}, scores: [],
  items: [{ id, category: 'single_city', output: [], scores }],
});

it('averages trials per item before metrics and reports category means, regressions and flakes', () => {
  const base = [run('base#1', [{ name: 'stop_f1', value: 1 }]), run('base#2', [{ name: 'stop_f1', value: 1 }])];
  const candidate = [run('cand#1', [{ name: 'stop_f1', value: 0 }]), run('cand#2', [{ name: 'stop_f1', value: 1 }])];
  const report = compareRuns(base, candidate, { stop_f1: { maxDrop: 0.02 } });
  expect(report.metrics).toEqual([{ metric: 'stop_f1', base: 1, candidate: 0.5, delta: -0.5 }]);
  expect(report.categories).toEqual([{ category: 'single_city', metric: 'stop_f1', base: 1, candidate: 0.5, delta: -0.5 }]);
  expect(report.regressed).toEqual(['one']);
  expect(report.flaky).toEqual([{ run: 'candidate', id: 'one', metric: 'stop_f1', values: [0, 1] }]);
  expect(report.violations).toEqual(['stop_f1 dropped by 0.5000 (max 0.02)']);
});

it('flags any candidate intent failure only when every base trial passed, and gates rising bad metrics', () => {
  const classify = (name: string, intent: number, hallucination: number): RunResult => ({
    suite: 'classify', runName: name, metadata: {}, scores: [{ name: 'clarify_recall', value: 1 }],
    items: [{ id: 'cls-01', category: 'partial', output: {
      intent: 'plan', locale: 'en', clarify: null,
      patch: { destination: null, tripType: null, departureDate: null, returnDate: null, travelers: null, preferences: null, budget: null, budgetCurrency: null },
    }, scores: [{ name: 'intent_acc', value: intent }, { name: 'patch_exact', value: 1 }, { name: 'patch_hallucination', value: hallucination }] }],
  });
  const base = [classify('b#1', 1, 0), classify('b#2', 1, 0)];
  const candidate = [classify('c#1', 1, 0), classify('c#2', 0, 0.5)];
  const report = compareRuns(base, candidate, { patch_hallucination: { maxRise: 0.02 } });
  expect(report.regressed).toEqual(['cls-01']);
  expect(report.violations).toEqual(['patch_hallucination rose by 0.2500 (max 0.02)']);
  expect(report.metrics).toContainEqual({ metric: 'clarify_recall', base: 1, candidate: 1, delta: 0 });
  expect(compareRuns([classify('b#1', 0, 0)], candidate, {}).regressed).toEqual([]);
});

it('lists a classify item that stopped asking as regressed', () => {
  const asked = (name: string, value: number): RunResult => ({
    suite: 'classify', runName: name, metadata: {}, scores: [],
    items: [{ id: 'one', category: 'vague', output: null, scores: [{ name: 'patch_exact', value: 1 }, { name: 'clarify_match', value }] }],
  });
  expect(compareRuns([asked('b#1', 1), asked('b#2', 1)], [asked('c#1', 1), asked('c#2', 0)], {}).regressed).toEqual(['one']);
});

it('sizes gates at 3 standard deviations of A/A noise and never lists cost or speed as flaky', () => {
  const trial = (name: string, flaky: number, recall: number): RunResult => ({
    suite: 'extract-days', runName: name, metadata: {}, scores: [{ name: 'clarify_recall', value: recall }],
    items: [
      { id: 'one', category: 'single_city', output: [], scores: [{ name: 'stop_f1', value: 1 }, { name: 'day_count_exact', value: 1 }] },
      { id: 'two', category: 'single_city', output: [], scores: [{ name: 'stop_f1', value: flaky }, { name: 'day_count_exact', value: 1 }, { name: 'latency_ms', value: flaky * 100 }] },
    ],
  });
  const a = [trial('a#1', 1, 0), trial('a#2', 0, 1)];
  const b = [trial('b#1', 1, 1), trial('b#2', 1, 1)];
  expect(noiseGates(a, b)).toEqual([
    { metric: 'stop_f1', sd: 0.25, gate: 0.75 },
    { metric: 'day_count_exact', sd: 0, gate: 0.02 },
    { metric: 'latency_ms', sd: 50, gate: 150 },
    { metric: 'clarify_recall', sd: 0.5, gate: 1.5 },
  ]);
  expect(compareRuns(a, b, {}).flaky.map(({ metric }) => metric)).toEqual(['stop_f1']);
});

it('reads prefix-matched results from disk and compares a fake-LLM extraction end to end', async () => {
  const folder = await mkdtemp(join(tmpdir(), 'eval-compare-'));
  try {
    const item = await executeItem({
      id: 'ext-01', category: 'single_city', locale: 'zh', today: '2026-10-30',
      draft: '## 杭州行程草稿', stays: null, expected: { days: [{ stops: ['杭州市区漫步'], stayRef: null }] },
    }, new FakeTripLlm());
    const result = { suite: 'extract-days', runName: 'extract-days@abc1234#1', metadata: {}, scores: [], items: [item] };
    await writeFile(join(folder, 'extract-days@abc1234_1.json'), JSON.stringify(result));
    await writeFile(join(folder, 'extract-days@def5678_1.json'), JSON.stringify({ ...result, runName: 'extract-days@def5678#1' }));
    await writeFile(join(folder, 'extract-days@abc1234-retry_1.json'), JSON.stringify({ ...result, runName: 'extract-days@abc1234-retry#1' }));
    const base = await readRuns(folder, 'extract-days@abc1234');
    const candidate = await readRuns(folder, 'extract-days@def5678');
    expect(base.map((run) => run.runName)).toEqual(['extract-days@abc1234#1']);
    expect(compareRuns(base, candidate, { stop_f1: { maxDrop: 0.02 } }).violations).toEqual([]);
    await writeFile(join(folder, 'broken_1.json'), '{}');
    await expect(readRuns(folder, 'broken')).rejects.toThrow();
    await expect(readRuns(folder, 'missing')).rejects.toThrow('No result files');
    expect(JSON.parse(await readFile(join(folder, 'extract-days@abc1234_1.json'), 'utf8')).items[0].output)
      .toEqual([{ stops: ['杭州市区漫步'], stayRef: null }]);
  } finally {
    await rm(folder, { recursive: true, force: true });
  }
});

it('does not weight an item with more trials more heavily than other items', () => {
  const base = [run('b#1', [{ name: 'stop_f1', value: 1 }]), run('b#2', [{ name: 'stop_f1', value: 1 }]), run('b#1', [{ name: 'stop_f1', value: 0 }], 'two')];
  expect(compareRuns(base, base, {}).metrics).toEqual([{ metric: 'stop_f1', base: 0.5, candidate: 0.5, delta: 0 }]);
});

it('the compare CLI exits 1 and names a regression, and exits 0 for identical runs', async () => {
  const prefix = `compare-test-${randomUUID()}`;
  const folder = fileURLToPath(new URL('./results/', import.meta.url));
  const paths = [join(folder, `${prefix}-base_1.json`), join(folder, `${prefix}-cand_1.json`)];
  await mkdir(folder, { recursive: true });
  try {
    await writeFile(paths[0], JSON.stringify(run('base#1', [{ name: 'stop_f1', value: 1 }])));
    await writeFile(paths[1], JSON.stringify(run('cand#1', [{ name: 'stop_f1', value: 0 }])));
    const script = fileURLToPath(new URL('./compare.ts', import.meta.url));
    const failed = spawnSync('bun', [script, `${prefix}-base`, `${prefix}-cand`], { encoding: 'utf8' });
    expect(failed.status).toBe(1);
    expect(failed.stdout).toContain('one');
    expect(failed.stderr).toContain('stop_f1 dropped by 1.0000');
    const passed = spawnSync('bun', [script, `${prefix}-base`, `${prefix}-base`], { encoding: 'utf8' });
    expect(passed.status).toBe(0);
  } finally {
    await Promise.all(paths.map((path) => rm(path, { force: true })));
  }
});
