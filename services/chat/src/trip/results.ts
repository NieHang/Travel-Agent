import { z } from 'zod';
import {
  LocalizedTextSchema,
  PanelSchema,
  type LocalizedText,
  type ResultGroup,
  type ResultItem,
} from '@autix/contracts';

export interface ToolResult {
  /** Short per-turn id (t1, t2…), not the provider's tool_call_id; show_results items cite it as `source`. */
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

// Copied fields are optional: for a hotel with a hotelId the server fills them from the tool result.
const ResultItemInputSchema = z.object({
  source: z.string().describe('source of the tool result that contains this item, e.g. "t1"'),
  id: z.string().nullable().describe('provider ID, e.g. hotelId, copied exactly'),
  title: LocalizedTextSchema,
  address: LocalizedTextSchema.nullish(),
  price: z.object({ amount: z.number().nonnegative(), currency: z.string().max(10) }).nullish(),
  rating: z.number().min(0).max(10).nullish(),
  url: z.string().url().nullish(),
  image: z.string().url().nullish(),
  details: z.array(z.object({ label: z.string().max(50), value: LocalizedTextSchema })).max(6).default([]),
  amenities: z.array(LocalizedTextSchema).max(MAX_AMENITIES).default([]),
  summary: z.string().max(500).nullable(),
});
export const ShowResultsInputSchema = z.object({
  panel: PanelSchema.nullable(),
  items: z.array(ResultItemInputSchema).max(10),
});
export type ShowResultsInput = z.infer<typeof ShowResultsInputSchema>;
type ResultItemInput = ShowResultsInput['items'][number];

export const SHOW_RESULTS_RULES = `Show items from tool results as cards.
- A hotel with a hotelId: send only source, id, title, amenities and summary. The server fills its address,
  price, rating, url and image from the cited result; do not send them or details.
- Any other item: also copy address, price, rating, url, image and details from the cited result.
- Copy id, url, image, currency and every \`original\` exactly as they appear in the cited tool result:
  same characters, no units, no translation, no reformatting.
- Put a \`translation\` next to an original only when it is not in the user's language; otherwise null.
  Never put translated text in \`original\`.
- A hotel's title.original is its name in the user's language: name for Chinese, nameEn (when present) for English.
- Put units and the user's language in the label instead, e.g. { label: "Distance (m)", value: { original: "850", translation: null } }.
- price.amount and rating are numbers taken from the result, not converted.
- amenities: at most ${MAX_AMENITIES} facilities or amenities the result lists for the item (e.g. hotelAmenities,
  facilities, tags that name a facility), one entry each, only those that matter for the user's
  request (e.g. family facilities for a family trip). Do not add amenities the result does not list.
- Comparisons and opinions go only in summary.
- source is the \`source\` of the tool result that contains the item, e.g. "t1" (not the tool name).`;

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

function localized(original: string, translation: string | null): LocalizedText {
  const text = translation?.trim() ? translation : null;
  return { original, translation: text === original ? null : text };
}

function groundText(text: LocalizedText, content: string): LocalizedText | null {
  return appears(content, text.original) ? localized(text.original, text.translation) : null;
}

type GroundedItem = Omit<ResultItem, 'ref'>;

/**
 * Builds cards from the cited, successful tool result. A hotel found by id takes its facts from the
 * hotel's record; any other item keeps only the copied fields whose values occur in the result.
 */
export function groundResults(input: ShowResultsInput, results: ToolResult[]): ResultGroup {
  const contentByCall = new Map(results.filter((r) => !r.isError).map((r) => [r.callId, r.content]));
  const items: ResultItem[] = [];
  for (const item of input.items) {
    const content = contentByCall.get(item.source);
    if (content === undefined) continue;
    const hotel = findHotel(content, item.id);
    const grounded = hotel ? fromHotel(item, hotel) : fromCopy(item, content);
    if (grounded) items.push({ ref: `r${items.length + 1}`, ...grounded });
  }
  return { panel: input.panel, items };
}

// The hotel shape compactToolContent emits; a record that does not fit falls back to copy-and-check.
const CompactHotelSchema = z.object({
  hotelId: z.number(),
  name: z.string().min(1).max(300),
  nameEn: z.string().min(1).max(300).nullish(),
  address: z.string().min(1).max(300).optional(),
  starRating: z.number().min(0).max(10).optional(),
  lowestPrice: z.string().nullable(),
  hotelAmenities: z.array(z.string()),
  tags: z.array(z.string()),
  imageUrl: z.string().url().nullable(),
  bookingUrl: z.string().url().optional(),
});
type CompactHotel = z.infer<typeof CompactHotelSchema>;
const CompactHotelsSchema = z.object({ hotels: z.array(z.unknown()) });
/** compactToolContent writes lowestPrice as `${amount} ${currency}`. */
const LOWEST_PRICE = /^(\d+(?:\.\d+)?) (\S{1,10})$/;

function findHotel(content: string, id: string | null): CompactHotel | null {
  if (id === null) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    return null;
  }
  const list = CompactHotelsSchema.safeParse(parsed);
  if (!list.success) return null;
  for (const raw of list.data.hotels) {
    const hotel = CompactHotelSchema.safeParse(raw);
    if (hotel.success && String(hotel.data.hotelId) === id) return hotel.data;
  }
  return null;
}

/**
 * The title must name the hotel the id points at, so a mixed-up id drops the card. English titles use nameEn and
 * Chinese ones name (SHOW_RESULTS_RULES), so the card keeps the provider name the title matched, an exact match first.
 */
function fromHotel(item: ResultItemInput, hotel: CompactHotel): GroundedItem | null {
  const names = [hotel.name, hotel.nameEn].filter((n): n is string => Boolean(n));
  const title = normalize(item.title.original);
  const name = names.find((n) => normalize(n) === title) ?? names.find((n) => appears(n, item.title.original));
  if (!name) return null;
  const price = hotel.lowestPrice?.match(LOWEST_PRICE);
  const listed = [...hotel.hotelAmenities, ...hotel.tags];
  return {
    id: item.id,
    title: localized(name, item.title.translation),
    address: hotel.address ? { original: hotel.address, translation: null } : null,
    price: price ? { amount: Number(price[1]), currency: price[2] } : null,
    rating: hotel.starRating ?? null,
    url: hotel.bookingUrl ?? null,
    image: hotel.imageUrl,
    details: [],
    amenities: item.amenities.flatMap((a) =>
      listed.some((entry) => appears(entry, a.original)) ? [localized(a.original, a.translation)] : [],
    ),
    summary: item.summary,
  };
}

function fromCopy(item: ResultItemInput, content: string): GroundedItem | null {
  const title = groundText(item.title, content);
  if (!title) return null;
  const exact = (value: string | null | undefined) => (value && appears(content, value) ? value : null);
  return {
    id: exact(item.id),
    title,
    address: item.address ? groundText(item.address, content) : null,
    price:
      item.price && hasNumber(content, item.price.amount) && appears(content, item.price.currency)
        ? item.price
        : null,
    rating: typeof item.rating === 'number' && hasNumber(content, item.rating) ? item.rating : null,
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
  };
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
