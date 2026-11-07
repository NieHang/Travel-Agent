// eval:compare --pairwise <base run with trial> <candidate run with trial>
// First call: writes two sheets for the same items with the drafts swapped, their empty verdict files and a key saying
// which run is draft A. The sheets and verdict files name no run. Once both are filled, the same call imports them:
// pairwise_vs_base goes to each candidate item (result file and Langfuse trace) and the win rate is printed.
import { config } from 'dotenv';
import { createHash, randomInt } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { LangfuseClient } from '@langfuse/client';
import { requireLangfuse } from '../langfuse-health.js';
import { readDataset, ResultSchema, type ItineraryEntry } from '../schemas.js';
import { outcomeValue, PAIRWISE_QUESTION, pairwiseOutcomes, PairwiseFileSchema, PairwiseKeySchema, type PairwiseKey } from './pairwise.js';
import { criteriaFor, RUBRIC_HASH } from './rubric.js';
import { judgedItems, renderOutput, renderRequest } from './sheet.js';
import { replaceTraceScores } from './trace-scores.js';

config({ path: fileURLToPath(new URL('../../.env.eval', import.meta.url)), override: true });

export async function comparePairwise(baseName: string, candidateName: string) {
  const [base, candidate] = await Promise.all([baseName, candidateName].map(readRun));
  const folder = new URL('../results/judge/pairwise/', import.meta.url);
  // A neutral stem, so no file the judge opens names the runs (a tag like "worse" would give the answer away).
  const stem = `pw-${createHash('sha256').update(`${base.runName}~${candidate.runName}`).digest('hex').slice(0, 8)}`;
  const at = (suffix: string) => new URL(`${stem}${suffix}`, folder);
  if (!existsSync(at('.key.json'))) return pack(base, candidate, folder, at);

  const key = PairwiseKeySchema.parse(JSON.parse(await readFile(at('.key.json'), 'utf8')));
  if (key.rubricHash !== RUBRIC_HASH) throw new Error(`The sheets use rubric ${key.rubricHash}, the current one is ${RUBRIC_HASH}; delete ${stem}.* and pack again`);
  const [first, second] = await Promise.all([1, 2].map(async (order) => PairwiseFileSchema.parse(JSON.parse(await readFile(at(`.${order}.verdicts.json`), 'utf8')))));
  const report = pairwiseOutcomes(key, first, second);
  await requireLangfuse();
  const client = new LangfuseClient();
  for (const outcome of report.items) {
    const item = candidate.items.find((i) => i.id === outcome.id)!;
    if (!item.traceId) throw new Error(`Missing Langfuse trace ID: ${item.id}`);
    const score = { name: 'pairwise_vs_base', value: outcomeValue(outcome.result), comment: `vs ${base.runName}\norder 1: ${outcome.reasons[0]}\norder 2: ${outcome.reasons[1]}` };
    item.scores = [...item.scores.filter((s) => s.name !== score.name), score];
    await replaceTraceScores(client, item.id, item.traceId, [score], (name) => name === score.name, { judge: first.judge, base: base.runName, rubric: RUBRIC_HASH });
  }
  await writeFile(resultPath(candidateName), JSON.stringify(candidate, null, 2) + '\n');
  await client.flush();
  console.table(report.items.map((i) => ({ id: i.id, result: i.result, 'order 1': i.reasons[0], 'order 2': i.reasons[1] })));
  console.log(`${candidate.runName} vs ${base.runName}: ${report.wins} wins, ${report.losses} losses, ${report.ties} ties; win rate ${(report.winRate * 100).toFixed(0)}%`);
}

async function pack(base: Run, candidate: Run, folder: URL, at: (suffix: string) => URL) {
  const entries = new Map((await readDataset('itinerary') as ItineraryEntry[]).map((e) => [e.id, e]));
  const candidates = new Map(judgedItems(candidate.items, entries).map((i) => [i.entry.id, i.output]));
  const items = judgedItems(base.items, entries).flatMap(({ entry, output }) => {
    const other = candidates.get(entry.id);
    return other ? [{ entry, base: output, candidate: other }] : [];
  });
  const skipped = [...new Set([...base.items, ...candidate.items].map((i) => i.id))].filter((id) => criteriaFor(entries.get(id)!).length && !items.some((i) => i.entry.id === id));
  const key: PairwiseKey = { base: base.runName, candidate: candidate.runName, rubricHash: RUBRIC_HASH, aIsBase: Object.fromEntries(items.map((i) => [i.entry.id, randomInt(2) === 0])) };
  await mkdir(folder, { recursive: true });
  for (const order of [1, 2] as const) {
    const sheet = [
      `# Pairwise sheet, order ${order} of 2 (rubric ${RUBRIC_HASH})`,
      `For every item, compare draft A with draft B and fill in the verdict file. ${PAIRWISE_QUESTION}`,
      ...items.map(({ entry, base: b, candidate: c }) => {
        const aIsBase = key.aIsBase[entry.id] === (order === 1);
        return [...renderRequest(entry), '### Draft A', ...renderOutput(aIsBase ? b : c), '### Draft B', ...renderOutput(aIsBase ? c : b),
          'Criteria to weigh:', ...criteriaFor(entry).map((cr) => `- ${cr.name}: ${cr.question}`)].join('\n');
      }),
    ].join('\n\n');
    await writeFile(at(`.${order}.md`), sheet + '\n');
    await writeFile(at(`.${order}.verdicts.json`), JSON.stringify({ order, judge: '', items: items.map((i) => ({ id: i.entry.id, winner: '', reason: '' })) }, null, 2) + '\n');
  }
  await writeFile(at('.key.json'), JSON.stringify(key, null, 2) + '\n');
  const stem = fileURLToPath(at(''));
  console.log(`${items.length} items → ${stem}.1.md and ${stem}.2.md; fill ${stem}.{1,2}.verdicts.json (judge each order apart, without opening the key), then run this again`);
  if (skipped.length) console.log(`Left out, missing an output in one run: ${skipped.join(', ')}`);
}

type Run = Awaited<ReturnType<typeof readRun>>;

async function readRun(name: string) {
  const run = ResultSchema.parse(JSON.parse(await readFile(resultPath(name), 'utf8')));
  if (run.suite !== 'itinerary') throw new Error(`${name} is not an itinerary run`);
  return run;
}

const resultPath = (name: string) => new URL(`../results/${name.replace('#', '_')}.json`, import.meta.url);
