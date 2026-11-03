// Writes one trial of an itinerary run as a judging sheet plus an empty verdict file for the judge to fill.
// Usage: bun run eval:judge-pack <run name with trial>, e.g. itinerary@507790f-dirty-osakastays2-a_1
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { readDataset, ResultSchema, type ItineraryEntry } from '../schemas.js';
import { criteriaFor, RUBRIC_HASH } from './rubric.js';
import { judgedItems, renderItem } from './sheet.js';

const name = process.argv[2]?.replace('#', '_');
if (!name) throw new Error('Usage: eval:judge-pack <run name with trial>, e.g. itinerary@abc1234-base-a_1');
const run = ResultSchema.parse(JSON.parse(await readFile(new URL(`../results/${name}.json`, import.meta.url), 'utf8')));
if (run.suite !== 'itinerary') throw new Error('Judging needs an itinerary run');
const entries = new Map((await readDataset('itinerary') as ItineraryEntry[]).map((e) => [e.id, e]));
const judged = judgedItems(run.items, entries);

const folder = new URL('../results/judge/', import.meta.url);
const verdictPath = fileURLToPath(new URL(`${name}.verdicts.json`, folder));
// A filled verdict file is the judge's work; never overwrite it.
if (existsSync(verdictPath)) throw new Error(`${verdictPath} exists; delete it to start over`);
await mkdir(folder, { recursive: true });
const sheet = [
  `# Judging ${run.runName} (rubric ${RUBRIC_HASH})`,
  'Answer every criterion with pass, fail or na and a one-sentence reason in the verdict file. Judge from what is shown plus web searches, never from memory, and name the source of any real-world fact a reason rests on. Length earns no credit.',
  ...judged.map(({ entry, output }) => renderItem(entry, output)),
].join('\n\n');
await writeFile(new URL(`${name}.md`, folder), sheet + '\n');
const template = {
  runName: run.runName, rubricHash: RUBRIC_HASH, judge: '',
  items: judged.map(({ entry }) => ({ id: entry.id, verdicts: criteriaFor(entry).map((c) => ({ criterion: c.name, verdict: '', reason: '' })) })),
};
await writeFile(verdictPath, JSON.stringify(template, null, 2) + '\n');
console.log(`${judged.length} items → results/judge/${name}.md and ${name}.verdicts.json`);
