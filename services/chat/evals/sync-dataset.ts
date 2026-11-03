import type { LangfuseClient } from '@langfuse/client';
import type { Entry, Suite } from './schemas.js';

type RemoteItem = Awaited<ReturnType<LangfuseClient['dataset']['get']>>['items'][number];
type SyncClient = {
  api: { datasets: { create: (request: { name: string }) => Promise<unknown> } };
  dataset: {
    get: (name: string) => Promise<{ items: Pick<RemoteItem, 'id' | 'status' | 'input' | 'expectedOutput' | 'metadata'>[] }>;
    createItem: (request: Parameters<LangfuseClient['dataset']['createItem']>[0]) => Promise<unknown>;
  };
};

export async function syncDataset(client: SyncClient, suite: Suite, entries: Entry[]): Promise<{ created: number; updated: number; archived: number }> {
  const name = `trip-${suite}`;
  // Dataset creation is itself an upsert by name in the installed SDK/API.
  await client.api.datasets.create({ name });
  const dataset = await client.dataset.get(name);
  const existing = new Set(dataset.items.map((item) => item.id));
  const ids = new Set(entries.map((entry) => entry.id));
  for (const entry of entries) {
    const { expected, ...input } = entry;
    await client.dataset.createItem({
      datasetName: name, id: entry.id, input, expectedOutput: expected,
      metadata: { category: entry.category, locale: entry.locale }, status: 'ACTIVE',
    });
  }
  const removed = dataset.items.filter((item) => item.status === 'ACTIVE' && !ids.has(item.id));
  for (const item of removed) {
    await client.dataset.createItem({
      datasetName: name, id: item.id, input: item.input, expectedOutput: item.expectedOutput,
      metadata: item.metadata, status: 'ARCHIVED',
    });
  }
  const updated = entries.filter((entry) => existing.has(entry.id)).length;
  return { created: entries.length - updated, updated, archived: removed.length };
}
