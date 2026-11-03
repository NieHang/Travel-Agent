import { syncDataset } from './sync-dataset.js';
import type { ClassifyEntry } from './schemas.js';

const entry: ClassifyEntry = {
  id: 'cls-en-partial-01', category: 'partial', locale: 'en', today: '2026-10-30',
  text: 'Plan Kyoto', state: { stage: 'idle', requirements: {} }, history: [],
  expected: { intent: 'plan', patch: { destination: 'Kyoto' }, clarifyField: null },
};

it('upserts source entries, archives removed active items, and preserves archived items', async () => {
  const createItem = vi.fn().mockResolvedValue({});
  const client = {
    api: { datasets: { create: vi.fn().mockResolvedValue({}) } },
    dataset: { createItem, get: vi.fn().mockResolvedValue({ items: [
      { id: entry.id, status: 'ARCHIVED' }, { id: 'old', status: 'ACTIVE', input: { text: 'old' }, expectedOutput: {}, metadata: { category: 'old' } },
      { id: 'already-archived', status: 'ARCHIVED' },
    ] }) },
  };
  expect(await syncDataset(client, 'classify', [entry, { ...entry, id: 'new' }])).toEqual({ created: 1, updated: 1, archived: 1 });
  expect(client.api.datasets.create).toHaveBeenCalledWith({ name: 'trip-classify' });
  const { expected, ...input } = entry;
  expect(createItem.mock.calls).toEqual([
    [{ datasetName: 'trip-classify', id: entry.id, input, expectedOutput: expected, metadata: { category: 'partial', locale: 'en' }, status: 'ACTIVE' }],
    [{ datasetName: 'trip-classify', id: 'new', input: { ...input, id: 'new' }, expectedOutput: expected, metadata: { category: 'partial', locale: 'en' }, status: 'ACTIVE' }],
    [{ datasetName: 'trip-classify', id: 'old', input: { text: 'old' }, expectedOutput: {}, metadata: { category: 'old' }, status: 'ARCHIVED' }],
  ]);
});
