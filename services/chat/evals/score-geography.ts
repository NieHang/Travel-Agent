import { config } from 'dotenv';
import { writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { LangfuseClient } from '@langfuse/client';
import { readRuns } from './comparison.js';
import { fillGeocache, geoKey, geographyDays, GoogleCoordinates, gradeGeography, readGeocache } from './geocoding.js';
import { readCassette } from './replay/cassette.js';
import { requireLangfuse } from './langfuse-health.js';

config({ path: fileURLToPath(new URL('../.env.eval', import.meta.url)), override: true });
const args = process.argv.slice(2);
const mode = args.shift();
const approved = mode === '--fill' || mode === '--score' ? Number(args.shift()) : 0;
if (!['--plan', '--fill', '--score'].includes(mode ?? '') || !args.length || !Number.isSafeInteger(approved) || approved < 0) throw new Error('Usage: score-geography.ts --plan <run-prefix>... | --fill <approved-searches> <prefix>... | --score <approved-details> <prefix>...');
const runs = (await Promise.all(args.map((prefix) => readRuns(fileURLToPath(new URL('./results/', import.meta.url)), prefix)))).flat();
const cache = await readGeocache();
const prepared = await Promise.all(runs.map(async (run) => {
  if (run.suite !== 'itinerary') throw new Error('Geography scoring requires itinerary runs');
  return { run, items: await Promise.all(run.items.map(async (item) => ({ item, cassette: await readCassette(fileURLToPath(new URL(`./cassettes/l3/${item.id}.json`, import.meta.url))) }))) };
}));
const targets = prepared.flatMap(({ items }) => items.flatMap(({ item, cassette }) => item.output?.effect === 'itinerary' ? geographyDays(item.output, cassette, item.id).flatMap((d) => d.targets) : []));
const unique = [...new Map(targets.map((target) => [geoKey(target), target])).values()];
const missing = unique.filter((target) => !cache.entries[geoKey(target)]);
const pendingSources = unique.filter((target) => cache.entries[geoKey(target)]?.sourcesPending);
const ids = new Set(unique.flatMap((target) => cache.entries[geoKey(target)]?.placeId ? [cache.entries[geoKey(target)].placeId!] : []));
console.log(`Google cache plan: up to ${missing.length * 2} Text Search Essentials (IDs Only), places.id; 0 Place Details (${missing.length} uncached stops, one empty-result retry each)`);
console.log(`Google scoring plan after cache fill: ${ids.size} Place Details Essentials, location; 0 Text Search. Re-run --plan after filling cache for the final count.`);
console.log(`Existence checks pending for ${pendingSources.length} saved IDs-only entries (no Google requests needed for these checks).`);
if (mode === '--fill') await fillGeocache(cache, unique, approved);
if (mode === '--score') {
  if (missing.length || pendingSources.length) throw new Error('Complete the cache fill before scoring');
  if (approved !== ids.size) throw new Error(`Approval must cover exactly ${ids.size} Place Details Essentials requests`);
  await requireLangfuse();
  const client = new LangfuseClient();
  const google = new GoogleCoordinates(approved);
  try {
    for (const { run, items } of prepared) {
      for (const { item, cassette } of items) {
        if (!item.output || item.output.effect !== 'itinerary') continue;
        if (!item.traceId) throw new Error(`Missing Langfuse trace ID: ${item.id}`);
        const remote = await client.api.scores.getMany({ traceId: item.traceId, limit: 100 });
        const scoreIds = new Map(remote.data.map((s) => [s.name, s.id]));
        const scores = await gradeGeography(item.output, cassette, cache, google, item.id).catch(async (error: unknown) => {
          item.error = `geography: ${error instanceof Error ? error.message : String(error)}`;
          item.scores = [...item.scores.filter((s) => s.name !== 'task_error'), { name: 'task_error', value: 1 }];
          client.score.create({ id: scoreIds.get('task_error') ?? `${item.traceId}-task_error`, traceId: item.traceId, name: 'task_error', value: 1, dataType: 'NUMERIC' });
          await writeFile(new URL(`./results/${run.runName.replace('#', '_')}.json`, import.meta.url), JSON.stringify(run, null, 2) + '\n');
          throw error;
        });
        const names = new Set([...scores.map((s) => s.name), 'geography_pending']);
        item.scores = [...item.scores.filter((s) => !names.has(s.name)), ...scores, { name: 'geography_pending', value: 0 }];
        if (item.error?.startsWith('geography:')) {
          delete item.error;
          item.scores = [...item.scores.filter((s) => s.name !== 'task_error'), { name: 'task_error', value: 0 }];
          scores.push({ name: 'task_error', value: 0 });
        }
        for (const score of [...scores, { name: 'geography_pending', value: 0 }]) client.score.create({ id: scoreIds.get(score.name) ?? `${item.traceId}-${score.name}`, traceId: item.traceId, ...score, dataType: 'NUMERIC' });
      }
      const path = new URL(`./results/${run.runName.replace('#', '_')}.json`, import.meta.url);
      await writeFile(path, JSON.stringify(run, null, 2) + '\n');
    }
  } finally { await client.flush(); }
}
