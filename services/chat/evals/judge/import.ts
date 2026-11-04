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
  // Langfuse overwrites a score only when both id and timestamp match, so a re-import reuses the earlier timestamps and
  // deletes judge scores the new verdicts no longer produce (a criterion now n/a).
  const { data } = await client.api.scores.getMany({ traceId, limit: 100 });
  const earlier = new Map(data.filter((s) => s.name.startsWith('judge_')).map((s) => [s.id, s.timestamp]));
  const body = scores.map((score) => {
    const id = `${traceId}-${score.name}`;
    return { id, timestamp: earlier.get(id), traceId, ...score, dataType: 'NUMERIC' as const, metadata: { judge: file.judge, rubric: RUBRIC_HASH } };
  });
  // The batch endpoint, not the queued score.create: that queue drops every score added during an automatic 10-score flush.
  const response = await client.api.scores.create(body);
  if ('rejected' in response && response.rejected) throw new Error(`${item.id}: Langfuse rejected ${response.rejected} scores: ${response.errors.map((e) => e.message).join('; ')}`);
  for (const id of earlier.keys()) if (!body.some((s) => s.id === id)) await client.api.scores.delete(id);
}
await writeFile(resultPath, JSON.stringify(run, null, 2) + '\n');
const checklist = scored.map((s) => s.scores.find((x) => x.name === 'judge_checklist')?.value ?? 1);
console.log(`${scored.length} items judged by ${file.judge}; mean judge_checklist ${(checklist.reduce((a, b) => a + b, 0) / checklist.length).toFixed(3)}`);
