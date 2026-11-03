import { z } from 'zod';
import type { LocalizedText, ResultItem } from '@autix/contracts';
import type { ItineraryEntry } from '../schemas.js';
import type { TurnOutput } from '../turn.js';
import { criteriaFor } from './rubric.js';

/** The items of a run the judge scores: those with an output and at least one criterion. */
export function judgedItems(items: { id: string; output: TurnOutput | null }[], entries: Map<string, ItineraryEntry>) {
  return items.flatMap((item) => {
    const entry = entries.get(item.id);
    return entry && item.output && criteriaFor(entry).length ? [{ entry, output: item.output }] : [];
  });
}

/** One item of the judging sheet: what the user asked, what the tools returned and what the model wrote. */
export function renderItem(entry: ItineraryEntry, out: TurnOutput): string {
  const shown = [...new Map([...out.next.results.flatMap((g) => g.items), ...out.next.stays?.items ?? []].map((h) => [h.ref, h])).values()];
  const calls = out.toolCalls.filter((c) => c.name !== 'load_skill');
  // Room types are only in the hotel search's tags, and a card may leave out or misquote the distance, so both come from the raw result.
  const raw = new Map(out.toolResults.flatMap((r) => searchedHotels(r.content)));
  const describe = (h: ResultItem) => {
    const hotel = raw.get(h.title.original);
    if (!hotel) return describeCard(h);
    return [describeCard(h), ...hotel.distanceInMeters == null ? [] : [`searched distance ${hotel.distanceInMeters} m`], ...hotel.tags.length ? [`tags: ${hotel.tags.join(', ')}`] : []].join('; ');
  };
  return [
    `## ${entry.id}`,
    `User (${entry.locale}, today ${entry.today}): ${entry.text}`,
    ...entry.history.length ? [`History: ${entry.history.map((m) => `${m.role}: ${m.text}`).join(' | ')}`] : [],
    `Requirements: ${JSON.stringify(out.next.requirements)}`,
    `Skills loaded: ${out.loaded.join(', ') || 'none'}`,
    `Tool calls: ${calls.map((c) => `${c.name} ${JSON.stringify(c.args)}`).join('; ') || 'none'}`,
    'Shown results:', ...shown.length ? shown.map(describe) : ['(none)'],
    'Days:', ...out.next.days.length ? out.next.days.map((d) => `- ${d.title}${d.stayRef ? ` (stay ${d.stayRef})` : ''}: ${d.stops.map((s) => s.name).join(', ')}`) : ['(none)'],
    'Draft:', '````', out.draft, '````',
    'Criteria:', ...criteriaFor(entry).map((c) => `- ${c.name}: ${c.question}`),
  ].join('\n');
}

const text = (t: LocalizedText | null) => (t ? [t.original, t.translation].filter(Boolean).join(' / ') : '');

const HotelsSchema = z.object({ hotels: z.array(z.object({ name: z.string(), distanceInMeters: z.number().nullish(), tags: z.array(z.string()).default([]) })) });
type SearchedHotel = z.infer<typeof HotelsSchema>['hotels'][number];

function searchedHotels(content: unknown): [string, SearchedHotel][] {
  try {
    const parsed = HotelsSchema.safeParse(JSON.parse(String(content)));
    return parsed.success ? parsed.data.hotels.map((h) => [h.name, h]) : [];
  } catch {
    return [];
  }
}

// Only fields grounded in the tool output; the model-written summary is left out.
function describeCard(h: ResultItem): string {
  const price = h.price ? `${h.price.amount} ${h.price.currency}` : 'no price';
  const facts = [...h.rating === null ? [] : [`rating ${h.rating}`], ...h.details.map((d) => `${d.label} ${text(d.value)}`)];
  return `- ${h.ref}: ${text(h.title)} | ${price} | ${text(h.address) || 'no address'} | ${[...facts, ...h.amenities.map(text)].join(', ')}`;
}
