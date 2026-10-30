import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { noiseGates, readRuns, ThresholdsSchema } from './comparison.js';

try {
  const [aPrefix, bPrefix] = process.argv.slice(2);
  if (!aPrefix || !bPrefix || process.argv.length !== 4) throw new Error('Usage: eval:noise <a-prefix> <b-prefix> (two runs of the same code)');
  const folder = fileURLToPath(new URL('./results/', import.meta.url));
  const [a, b, rawThresholds] = await Promise.all([
    readRuns(folder, aPrefix), readRuns(folder, bPrefix), readFile(new URL('./thresholds.json', import.meta.url), 'utf8'),
  ]);
  const gates = ThresholdsSchema.parse(JSON.parse(rawThresholds))[a[0].suite] ?? {};
  console.table(noiseGates(a, b).filter(({ metric }) => metric in gates).map(({ metric, sd, gate }) => ({
    metric, sd, suggested: gate, current: gates[metric].maxDrop ?? gates[metric].maxRise,
  })));
} catch (error) {
  console.error(error);
  process.exitCode = 1;
}
