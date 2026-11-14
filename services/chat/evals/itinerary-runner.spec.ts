import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { itineraryContext } from './itinerary-runner.js';
import type { Geocache } from './geocoding.js';
import { compareRuns, noiseGates } from './comparison.js';
import { ResultSchema } from './schemas.js';

const folder = mkdtempSync(join(tmpdir(), 'itinerary-runner-'));
afterAll(() => rmSync(folder, { recursive: true, force: true }));
writeFileSync(join(folder, 'fixture.json'), '{"tools":[],"calls":[]}');
const cache: Geocache = { attribution: '© OpenStreetMap contributors', entries: {} };
const dependencies = {
  loadGeocache: async () => cache,
  cassetteFolder: pathToFileURL(`${folder}/`),
};

it('requires explicit Google approval or deferred geography before running L3', async () => {
  await expect(itineraryContext(undefined, false, dependencies)).rejects.toThrow('operator approval');
  await expect(itineraryContext(undefined, true, dependencies)).resolves.toHaveProperty('replay');
});

it('records the L3 replay profile and the frozen cassette hash in run metadata', async () => {
  const context = await itineraryContext(undefined, true, dependencies);
  expect(context.metadata).toEqual({ replayProfile: 'itinerary-hybrid-v2', cassetteHash: '07a69b21ef07' });
});

it('refuses comparison of pending geography results', () => {
  const run = ResultSchema.parse({ suite: 'itinerary', runName: 'itinerary@a#1', metadata: {}, scores: [], items: [{ id: 'x', category: 'family', output: null, scores: [{ name: 'geography_pending', value: 1 }] }] });
  expect(() => compareRuns([run], [run], {})).toThrow('Geography is pending');
});

it('refuses noise calibration when L3 tasks failed', () => {
  const run = ResultSchema.parse({ suite: 'itinerary', runName: 'itinerary@a#1', metadata: {}, scores: [], items: [{ id: 'x', category: 'family', output: null, scores: [{ name: 'task_error', value: 1 }] }] });
  expect(() => noiseGates([run], [run])).toThrow('failed L3 tasks');
});
