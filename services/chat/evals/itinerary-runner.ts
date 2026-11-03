import { readFile, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import type { BaseCallbackHandler } from '@langchain/core/callbacks/base';
import type { Skill } from '../src/skills/registry.js';
import type { TurnOutput } from './turn.js';
import { GoogleCoordinates, gradeGeography, readGeocache } from './geocoding.js';
import { readCassette } from './replay/cassette.js';
import { ReplayMcp } from './replay/replay.js';
import { itineraryReplayKey } from './replay/itinerary.js';

export async function itineraryContext(rawBudget: string | undefined, defer = false) {
  if (!defer && (rawBudget === undefined || !/^\d+$/.test(rawBudget))) throw new Error('L3 requires --google-details N after operator approval (Place Details Essentials, field mask location), or --defer-geography to collect trials without Google');
  const google = new GoogleCoordinates(Number(rawBudget ?? 0));
  const cache = await readGeocache();
  const folder = new URL('./cassettes/l3/', import.meta.url);
  const files = (await readdir(folder)).filter((name) => name.endsWith('.json')).sort();
  const cassettes = new Map(await Promise.all(files.map(async (name) => [name.slice(0, -5), await readCassette(fileURLToPath(new URL(name, folder)))] as const)));
  return {
    metadata: { replayProfile: 'itinerary-hybrid-v2', cassetteHash: createHash('sha256').update(JSON.stringify([...cassettes])).digest('hex').slice(0, 12) },
    async replay(id: string, callbacks: BaseCallbackHandler[]) {
      const cassette = cassettes.get(id);
      if (!cassette) throw new Error(`Missing L3 cassette for ${id}; run eval:record-itinerary first`);
      const mcp = new ReplayMcp(cassette, callbacks, itineraryReplayKey);
      return { mcp, grade: (out: TurnOutput) => defer ? Promise.resolve(out.effect === 'itinerary' ? [{ name: 'geography_pending', value: 1 }] : []) : gradeGeography(out, cassette, cache, google, id) };
    },
  };
}

export async function itineraryPromptHashInput(skills: Skill[]): Promise<string> {
  // Include all turn prompts and loaded skill bodies, rather than only extraction's prompt.
  const llm = await readFile(new URL('../src/trip/llm.ts', import.meta.url), 'utf8');
  return JSON.stringify({ llm, skills });
}
