import { z } from 'zod';
import {
  LocalizedTextSchema,
  PanelSchema,
  type LocalizedText,
  type ResultGroup,
  type ResultItem,
} from '@autix/contracts';

export interface ToolResult {
  /** tool_call_id of the call; show_results items cite it as `source`. */
  callId: string;
  tool: string;
  args: Record<string, unknown>;
  content: string;
  isError: boolean;
}
export const ToolResultSchema = z.object({
  callId: z.string(),
  tool: z.string(),
  args: z.record(z.unknown()),
  content: z.string(),
  isError: z.boolean(),
});

export const SHOW_RESULTS = 'show_results';
/** Keeps show_results short: long payloads made DeepSeek emit malformed JSON. */
export const MAX_AMENITIES = 8;

const ResultItemInputSchema = z.object({
  source: z.string().describe('callId of the tool result that contains this item, copied exactly'),
  id: z.string().nullable().describe('provider ID, e.g. hotelId, copied exactly'),
  title: LocalizedTextSchema,
  address: LocalizedTextSchema.nullable(),
  price: z.object({ amount: z.number().nonnegative(), currency: z.string().max(10) }).nullable(),
  rating: z.number().min(0).max(10).nullable(),
  url: z.string().url().nullable(),
  image: z.string().url().nullable(),
  details: z.array(z.object({ label: z.string().max(50), value: LocalizedTextSchema })).max(6),
  amenities: z.array(LocalizedTextSchema).max(MAX_AMENITIES),
  summary: z.string().max(500).nullable(),
});
export const ShowResultsInputSchema = z.object({
  panel: PanelSchema.nullable(),
  items: z.array(ResultItemInputSchema).max(10),
});
export type ShowResultsInput = z.infer<typeof ShowResultsInputSchema>;

export const SHOW_RESULTS_RULES = `Show items from tool results as cards.
- Copy id, url, image, currency and every \`original\` exactly as they appear in the cited tool result:
  same characters, no units, no translation, no reformatting.
- Put a \`translation\` next to an original only when it is not in the user's language; otherwise null.
  Never put translated text in \`original\`.
- Put units and the user's language in the label instead, e.g. { label: "Distance (m)", value: { original: "850", translation: null } }.
- price.amount and rating are numbers taken from the result, not converted.
- amenities: at most ${MAX_AMENITIES} facilities or amenities the result lists for the item (e.g. hotelAmenities,
  facilities, tags that name a facility), one entry each, preferring those that matter for the user's
  request (e.g. family facilities for a family trip). Do not add amenities the result does not list.
- Comparisons and opinions go only in summary.
- source is the callId of the tool result that contains the item, copied exactly (not the tool name).`;

const normalize = (value: string) => value.replace(/\s+/g, ' ').trim();

function leaves(value: unknown): string[] {
  if (typeof value === 'string') return [value];
  if (typeof value === 'number') return [String(value)];
  if (Array.isArray(value)) return value.flatMap(leaves);
  if (value && typeof value === 'object') return Object.values(value).flatMap(leaves);
  return [];
}

/** The tool content's string and number values, unescaped, one per line. */
function decoded(content: string): string | null {
  try {
    return leaves(JSON.parse(content)).join('\n');
  } catch {
    return null;
  }
}

/** True when `value` occurs in the tool content as raw, JSON-escaped or JSON-decoded text. */
export function appears(content: string, value: string): boolean {
  const needle = normalize(value);
  if (!needle) return false;
  const escaped = normalize(JSON.stringify(value).slice(1, -1));
  return [content, decoded(content) ?? '']
    .map(normalize)
    .some((haystack) => haystack.includes(needle) || haystack.includes(escaped));
}

export function hasNumber(content: string, n: number): boolean {
  for (const match of content.matchAll(/-?\d+(?:\.\d+)?/g))
    if (Number(match[0]) === n) return true;
  return false;
}

function groundText(text: LocalizedText, content: string): LocalizedText | null {
  if (!appears(content, text.original)) return null;
  const translation = text.translation?.trim() ? text.translation : null;
  return { original: text.original, translation: translation === text.original ? null : translation };
}

/** Keeps only fields whose values occur in the cited, successful tool result. */
export function groundResults(input: ShowResultsInput, results: ToolResult[]): ResultGroup {
  const contentByCall = new Map(results.filter((r) => !r.isError).map((r) => [r.callId, r.content]));
  const items: ResultItem[] = [];
  for (const item of input.items) {
    const content = contentByCall.get(item.source);
    if (content === undefined) continue;
    const title = groundText(item.title, content);
    if (!title) continue;
    const exact = (value: string | null) => (value !== null && appears(content, value) ? value : null);
    items.push({
      ref: `r${items.length + 1}`,
      id: exact(item.id),
      title,
      address: item.address ? groundText(item.address, content) : null,
      price:
        item.price && hasNumber(content, item.price.amount) && appears(content, item.price.currency)
          ? item.price
          : null,
      rating: item.rating !== null && hasNumber(content, item.rating) ? item.rating : null,
      url: exact(item.url),
      image: exact(item.image),
      details: item.details.flatMap((d) => {
        const value = groundText(d.value, content);
        return value ? [{ label: d.label, value }] : [];
      }),
      amenities: item.amenities.flatMap((a) => {
        const text = groundText(a, content);
        return text ? [text] : [];
      }),
      summary: item.summary,
    });
  }
  return { panel: input.panel, items };
}

/** Itinerary hotels from several show_results calls, renumbered h1… so days can reference them. */
export function mergeStays(stays: ResultGroup | null, group: ResultGroup): ResultGroup {
  const items = [...(stays?.items ?? []), ...group.items]
    .slice(0, 20)
    .map((item, i) => ({ ...item, ref: `h${i + 1}` }));
  return { panel: 'hotels', items };
}

/** A day can only point at a verified hotel. */
export function linkStays<T extends { stayRef: string | null }>(days: T[], stays: ResultGroup | null): T[] {
  const refs = new Set(stays?.items.map((i) => i.ref) ?? []);
  return days.map((d) => ({ ...d, stayRef: d.stayRef && refs.has(d.stayRef) ? d.stayRef : null }));
}
