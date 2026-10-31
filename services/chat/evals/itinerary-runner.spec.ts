import { itineraryContext } from './itinerary-runner.js';
import { compareRuns, noiseGates } from './comparison.js';
import { ResultSchema } from './schemas.js';

it('requires explicit Google approval or deferred geography before running L3', async () => {
  await expect(itineraryContext(undefined)).rejects.toThrow('operator approval');
  await expect(itineraryContext(undefined, true)).resolves.toHaveProperty('replay');
});

it('records the L3 replay profile and the frozen cassette hash in run metadata', async () => {
  const context = await itineraryContext(undefined, true);
  expect(context.metadata).toMatchObject({ replayProfile: 'itinerary-hybrid-v1', cassetteHash: expect.stringMatching(/^[0-9a-f]{12}$/) });
});

it('refuses comparison of pending geography results', () => {
  const run = ResultSchema.parse({ suite: 'itinerary', runName: 'itinerary@a#1', metadata: {}, scores: [], items: [{ id: 'x', category: 'family', output: null, scores: [{ name: 'geography_pending', value: 1 }] }] });
  expect(() => compareRuns([run], [run], {})).toThrow('Geography is pending');
});

it('refuses noise calibration when L3 tasks failed', () => {
  const run = ResultSchema.parse({ suite: 'itinerary', runName: 'itinerary@a#1', metadata: {}, scores: [], items: [{ id: 'x', category: 'family', output: null, scores: [{ name: 'task_error', value: 1 }] }] });
  expect(() => noiseGates([run], [run])).toThrow('failed L3 tasks');
});
