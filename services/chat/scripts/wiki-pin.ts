import { config } from 'dotenv';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { loadLibrary } from '../src/knowledge/index.js';

// Proposes a Google place ID for each unpinned place page; a person adds the agreed placeId to its frontmatter and reviews the diff.
// The search asks for IDs only (Text Search Essentials, IDs Only), which Google does not charge for and allows storing.
config({ path: fileURLToPath(new URL('../.env.eval', import.meta.url)), override: true, quiet: true });
const key = process.env.GOOGLE_MAPS_API_KEY;
if (!key) throw new Error('GOOGLE_MAPS_API_KEY is required in services/chat/.env.eval');

async function search(query: string): Promise<string | null> {
  const response = await fetch('https://places.googleapis.com/v1/places:searchText', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Goog-Api-Key': key!, 'X-Goog-FieldMask': 'places.id' },
    body: JSON.stringify({ textQuery: query, regionCode: 'JP', languageCode: 'ja', pageSize: 1 }),
    signal: AbortSignal.timeout(30_000),
  });
  // Keep Google's response body and the request out of the error: either can echo the key.
  if (!response.ok) throw new Error(`Place search failed: HTTP ${response.status}`);
  const { places } = z.object({ places: z.array(z.object({ id: z.string() })).default([]) }).parse(await response.json());
  return places[0]?.id ?? null;
}

for (const page of loadLibrary().values()) {
  if (page.type !== 'place' || page.placeId) continue;
  const query = page.names.ja + ' ' + page.id.split('/')[0];
  // The same query can return different IDs between runs, so an ID is proposed only when two searches agree.
  const [first, second] = [await search(query), await search(query)];
  console.log(first && first === second ? `${page.id}\t${first}` : `${page.id}\tno agreement (${first ?? 'none'} / ${second ?? 'none'})`);
}
