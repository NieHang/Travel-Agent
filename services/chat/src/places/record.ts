import { z } from 'zod';

const iso = z.string().date();
const clock = z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/);
const monthDay = z.string().refine((day) => iso.safeParse('2000-' + day).success);
const name = z.object({ en: z.string().min(1).max(100), zh: z.string().min(1).max(100), ja: z.string().min(1).max(100) });
const sourced = z.object({
  source: z.string().url().startsWith('https://'), checkedOn: iso, quote: z.string().trim().min(1).max(300),
});
const range = z.object({ type: z.literal('range'), from: iso, until: iso });
const closure = sourced.extend({
  when: z.discriminatedUnion('type', [
    range, z.object({ type: z.literal('holidays') }), z.object({ type: z.literal('dates'), dates: iso.array() }),
    z.object({ type: z.literal('weekly'), days: z.number().int().min(0).max(6).array().nonempty(), holidayShift: z.boolean() }),
  ]),
  scope: z.discriminatedUnion('type', [
    z.object({ type: z.literal('whole') }), z.object({ type: z.literal('most_shops') }),
    z.object({ type: z.literal('part'), name, aliases: z.string().min(1).array() }),
  ]),
}).refine(({ when }) => when.type !== 'range' || when.from <= when.until, 'Works must start on or before their end date');
const period = z.object({ from: monthDay, to: monthDay, open: clock, close: z.union([clock, z.literal('24:00')]) })
  .refine((p) => p.open < p.close, 'Opening must precede closing');
type Period = z.infer<typeof period>;
export function inSeason(day: string, p: Period) {
  return p.from <= p.to ? day >= p.from && day <= p.to : day >= p.from || day <= p.to;
}
const year = Array.from({ length: 366 }, (_, i) => new Date(Date.UTC(2000, 0, i + 1)).toISOString().slice(5, 10));
export function seasonDay(day: string, periods: Period[]) {
  // A season ending February 28 runs through leap day unless February 29 is explicitly covered.
  return day === '02-29' && !periods.some((p) => inSeason(day, p)) ? '02-28' : day;
}
const schedule = sourced.extend({ type: z.literal('schedule'), periods: period.array().nonempty() });
const schema = z.object({
  slug: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/), city: z.enum(['kyoto', 'tokyo', 'osaka', 'nara']),
  pin: z.discriminatedUnion('status', [
    z.object({ status: z.literal('pinned'), placeId: z.string().min(1), pinnedOn: iso }),
    z.object({ status: z.literal('unpinned'), query: z.string().min(1) }),
  ]),
  name, aliases: z.string().min(1).array(), visitMinutes: z.number().int().positive(),
  hours: z.discriminatedUnion('type', [schedule, sourced.extend({ type: z.literal('always_open') }), z.object({ type: z.literal('not_recorded') })]),
  closures: closure.array(), access: sourced.extend({ rail: z.enum(['subway', 'jr', 'private_rail']).array() }).nullable(),
}).strict().refine(({ hours }) => hours.type !== 'schedule' || year.every((day) =>
  hours.periods.filter((p) => inSeason(seasonDay(day, hours.periods), p)).length === 1), 'Each calendar day needs exactly one hours period');

export type PlaceRecordInput = z.input<typeof schema>;
export type Sourced = z.infer<typeof sourced>;
export const normalize = (value: string) => value.normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
export const aliasesOf = (place: PlaceRecordInput) => [...Object.values(place.name), ...place.aliases].map(normalize);

export const librarySchema = schema.array().superRefine((records, ctx) => {
  const aliases = new Set<string>();
  const slugs = new Set<string>();
  for (const [i, record] of records.entries()) {
    if (slugs.has(record.slug)) ctx.addIssue({ code: 'custom', path: [i, 'slug'], message: 'Duplicate slug' });
    slugs.add(record.slug);
    for (const key of new Set(aliasesOf(record))) {
      if (!key || aliases.has(key)) ctx.addIssue({ code: 'custom', path: [i, 'aliases'], message: 'Empty or duplicate normalized alias: ' + key });
      aliases.add(key);
    }
  }
});
