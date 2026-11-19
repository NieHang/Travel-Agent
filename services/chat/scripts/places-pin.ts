import { config } from 'dotenv';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { unpinnedPlaces } from '../src/places/index.js';

// Proposes a Google place ID for each unpinned record; a person pastes the agreed ones into records/ and reviews the diff.
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

for (const { slug, query } of unpinnedPlaces()) {
  // The same query can return different IDs between runs, so an ID is proposed only when two searches agree.
  const [first, second] = [await search(query), await search(query)];
  console.log(first && first === second ? `${slug}\t${first}` : `${slug}\tno agreement (${first ?? 'none'} / ${second ?? 'none'})`);
}
