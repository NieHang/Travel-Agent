// Imports a filled verdict file: checks it against the current rubric, then writes the judge_* scores into the
// run's result file and onto each item's Langfuse trace, with the judge and rubric in the score metadata.
// Usage: bun run eval:judge-import <run name with trial>
import { config } from 'dotenv';
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { LangfuseClient } from '@langfuse/client';
import { requireLangfuse } from '../langfuse-health.js';
import { readDataset, ResultSchema, type ItineraryEntry } from '../schemas.js';
import { criteriaFor, RUBRIC_HASH } from './rubric.js';
import { replaceTraceScores } from './trace-scores.js';
import { judgeScores, VerdictFileSchema } from './verdicts.js';

config({ path: fileURLToPath(new URL('../../.env.eval', import.meta.url)), override: true });
const name = process.argv[2]?.replace('#', '_');
if (!name) throw new Error('Usage: eval:judge-import <run name with trial>');
const file = VerdictFileSchema.parse(JSON.parse(await readFile(new URL(`../results/judge/${name}.verdicts.json`, import.meta.url), 'utf8')));
if (file.rubricHash !== RUBRIC_HASH) throw new Error(`Verdicts use rubric ${file.rubricHash}, the current one is ${RUBRIC_HASH}; pack and judge again`);
const resultPath = new URL(`../results/${name}.json`, import.meta.url);
const run = ResultSchema.parse(JSON.parse(await readFile(resultPath, 'utf8')));
if (run.suite !== 'itinerary' || run.runName !== file.runName) throw new Error(`Verdicts are for ${file.runName}, not ${run.runName}`);
const entries = new Map((await readDataset('itinerary') as ItineraryEntry[]).map((e) => [e.id, e]));
const expected = run.items.filter((item) => item.output && criteriaFor(entries.get(item.id)!).length).map((item) => item.id);
const given = file.items.map((item) => item.id);
if (given.length !== expected.length || expected.some((id) => !given.includes(id))) throw new Error(`Verdicts must cover exactly: ${expected.join(', ')}`);

const scored = file.items.map(({ id, verdicts }) => {
  const item = run.items.find((i) => i.id === id)!;
  if (!item.traceId) throw new Error(`Missing Langfuse trace ID: ${id}`);
  return { item, traceId: item.traceId, scores: judgeScores(entries.get(id)!, verdicts) };
});
await requireLangfuse();
const client = new LangfuseClient();
for (const { item, traceId, scores } of scored) {
  item.scores = [...item.scores.filter((s) => !s.name.startsWith('judge_')), ...scores];
  await replaceTraceScores(client, item.id, traceId, scores, (name) => name.startsWith('judge_'), { judge: file.judge, rubric: RUBRIC_HASH });
}
await writeFile(resultPath, JSON.stringify(run, null, 2) + '\n');
const checklist = scored.map((s) => s.scores.find((x) => x.name === 'judge_checklist')?.value ?? 1);
console.log(`${scored.length} items judged by ${file.judge}; mean judge_checklist ${(checklist.reduce((a, b) => a + b, 0) / checklist.length).toFixed(3)}`);
