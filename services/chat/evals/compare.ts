import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { compareRuns, readRuns, ThresholdsSchema } from './comparison.js';

try {
  const args = process.argv.slice(2);
  if (args[0] === '--pairwise') await pairwise(args.slice(1));
  else await metrics(args);
} catch (error) {
  console.error(error);
  process.exitCode = 1;
}

async function pairwise([baseRun, candidateRun, ...rest]: string[]) {
  if (!baseRun || !candidateRun || rest.length) throw new Error('Usage: eval:compare --pairwise <base run with trial> <cand run with trial>');
  const { comparePairwise } = await import('./judge/compare-pairwise.js');
  await comparePairwise(baseRun, candidateRun);
}

async function metrics([basePrefix, candidatePrefix, ...rest]: string[]) {
  if (!basePrefix || !candidatePrefix || rest.length) throw new Error('Usage: eval:compare <base-prefix> <cand-prefix>');
  const folder = fileURLToPath(new URL('./results/', import.meta.url));
  const [base, candidate, rawThresholds] = await Promise.all([
    readRuns(folder, basePrefix), readRuns(folder, candidatePrefix), readFile(new URL('./thresholds.json', import.meta.url), 'utf8'),
  ]);
  const thresholds = ThresholdsSchema.parse(JSON.parse(rawThresholds));
  const report = compareRuns(base, candidate, thresholds[base[0].suite]);
  console.table(report.metrics);
  console.log('Per category:');
  console.table(report.categories);
  console.log('Regressed items:', report.regressed);
  console.log('Flaky items:', report.flaky);
  for (const violation of report.violations) console.error(violation);
  if (report.violations.length) process.exitCode = 1;
}
