import { z } from 'zod';
import { loadLibrary, READ_WIKI } from '../../src/knowledge/index.js';
import type { Score } from '../schemas.js';
import type { TurnOutput } from '../turn.js';

const wiki = loadLibrary();
const key = (name: string) => name.normalize('NFKC').toLowerCase().replace(/[\s\p{P}\p{S}]/gu, '');
const ReadArgsSchema = z.object({ pages: z.array(z.string()) });

/**
 * How a turn used the wiki. `wiki_miss` and `rounds_exhausted` are scored on every turn that ran the model;
 * the other three only on itineraries, and a rate with no denominator is left out.
 */
export function gradeWiki(out: Pick<TurnOutput, 'next' | 'effect' | 'toolCalls' | 'roundsExhausted'>, library = wiki): Score[] {
  if (out.effect === null) return [];
  const requested = out.toolCalls.filter((call) => call.name === READ_WIKI).flatMap((call) => {
    const args = ReadArgsSchema.safeParse(call.args);
    return args.success ? args.data.pages : [];
  });
  const scores: Score[] = [
    { name: 'wiki_miss', value: requested.filter((id) => !library.has(id)).length },
    { name: 'rounds_exhausted', value: Number(out.roundsExhausted) },
  ];
  if (out.effect !== 'itinerary') return scores;
  const pages = [...library.values()].map((page) => ({ ...page, keys: [page.title, page.names.zh, page.names.ja, ...page.aliases].map(key) }));
  const read = pages.filter((page) => requested.includes(page.id));
  // A multi-city trip's destination is just "Japan"; its cities are in the day titles ("Day 3 | Tokyo → Osaka").
  const cities = key([out.next.requirements.destination ?? '', ...out.next.days.map((day) => day.title)].join(' '));
  if (pages.some((page) => page.type === 'city' && page.keys.some((name) => cities.includes(name))))
    scores.push({ name: 'wiki_read', value: Number(read.length > 0) });
  scores.push({ name: 'wiki_depth', value: read.filter((page) => page.type === 'place').length });
  // A city name as a stop is an arrival, and topic pages are not places.
  const known = new Set(pages.filter((page) => page.type === 'place' || page.type === 'area').flatMap((page) => page.keys));
  const stops = out.next.days.flatMap((day) => day.stops);
  if (stops.length) scores.push({ name: 'wiki_stop_share', value: stops.filter((stop) => known.has(key(stop.name))).length / stops.length });
  return scores;
}
