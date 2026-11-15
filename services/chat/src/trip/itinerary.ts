import { z } from 'zod';
import type { NightRange, ResultGroup, ResultItem } from '@autix/contracts';

type Locale = 'zh' | 'en';

export const StopSchema = z.object({
  name: z.string().min(1).max(200),
  note: z.string().max(500).nullable(),
  time: z.string().max(50).nullable(),
});
export type Stop = z.infer<typeof StopSchema>;

/** One day of the draft as the model wrote it, minus its hotel line (rendered from stayRef). */
export const PlanDaySchema = z.object({
  /** "Day 3 | Nijo Castle · Nishiki Market (light)", without markdown decoration. */
  title: z.string().min(1).max(300),
  body: z.string().max(6000),
  stops: z.array(StopSchema).max(20),
  /** The hotel for the night after this day: a ref into `stays`, or null. */
  stayRef: z.string().nullable(),
});
export type PlanDay = z.infer<typeof PlanDaySchema>;

/**
 * The itinerary part of TripState. The full markdown is never stored: renderPlan derives it.
 * `preamble` is null until there is a draft. Every non-null stayRef names an item in `stays`.
 */
export type Plan = { preamble: string | null; days: PlanDay[]; footer: string; stays: ResultGroup | null };

type DraftDay = Omit<PlanDay, 'stops'>;
export type Draft = { preamble: string; days: DraftDay[]; footer: string };

/** A day header: the skill's "Day 3 | …" / "**第3天 | …**", and older drafts' "## Day 3" or "Day 3: …". */
const DAY_HEADER = /^[#*\s]*(?:Day\s*\d+|第\s*\d+\s*天)(?=\s*(?:[|｜:：*]|$))/i;
/** The hotel line the itinerary task asks for under each overnight day. */
const STAY_LINE = /^[-*\s]*(?:Tonight|今晚|住宿)[^:：\n]{0,6}[:：]/i;
const LIST_LINE = /^\s*(?:[-*+]|\d+[.)])\s/;

/**
 * Splits model markdown into preamble, days and footer, and takes each day's hotel line out of its body.
 * The hotel is found by name, so a day can only point at a grounded stay; a hotel line that names none
 * stays in the body as text.
 */
export function parseDraft(markdown: string, stays: ResultGroup | null): Draft {
  const lines = markdown.replace(/\r\n/g, '\n').split('\n');
  const starts = lines.flatMap((line, i) => (DAY_HEADER.test(line) ? [i] : []));
  if (!starts.length) return { preamble: markdown.trim(), days: [], footer: '' };
  const sections = starts.map((start, n) => lines.slice(start, starts[n + 1] ?? lines.length));
  const last = sections[sections.length - 1];
  const tail = trailingProse(last);
  sections[sections.length - 1] = last.slice(0, last.length - tail.length);
  return {
    preamble: lines.slice(0, starts[0]).join('\n').trim(),
    days: sections.map(([header, ...body]) => toDay(header, body, stays?.items ?? [])),
    footer: tail.join('\n').trim(),
  };
}

function toDay(header: string, body: string[], stays: ResultItem[]): DraftDay {
  const at = body.findLastIndex((line) => STAY_LINE.test(line));
  const item = at < 0 ? undefined : namedStay(body[at], stays);
  return {
    title: header.replace(/^[#*\s]+/, '').replace(/[*\s]+$/, ''),
    body: (item ? body.filter((_, i) => i !== at) : body).join('\n').trim(),
    stayRef: item?.ref ?? null,
  };
}

/** The longest stay title the line contains, so "Hotel X Annex" wins over "Hotel X". */
function namedStay(line: string, stays: ResultItem[]): ResultItem | undefined {
  const text = line.toLowerCase();
  return stays
    .filter((s) => [s.title.original, s.title.translation].some((t) => t && text.includes(t.toLowerCase())))
    .sort((a, b) => b.title.original.length - a.title.original.length)[0];
}

/** Paragraphs after the last day's list that are not part of it ("prices may change…"). */
function trailingProse(section: string[]): string[] {
  const end = section.findLastIndex((line) => line.trim() !== '');
  const lastList = section.findLastIndex((line) => LIST_LINE.test(line) || DAY_HEADER.test(line));
  const gap = section.findIndex((line, i) => i > lastList && line.trim() === '');
  return gap < 0 || gap > end ? [] : section.slice(gap);
}

/** The text extractStops reads for one day. */
export const dayText = (day: Pick<PlanDay, 'title' | 'body'>) => `${day.title}\n${day.body}`;

/**
 * The markdown everyone else reads: the panel fallback and the model's serverContext.plan.
 * With `numbered`, each day starts with "[D3]" so the model can cite it without counting.
 */
export function renderPlan(plan: Plan, locale: Locale, options: { numbered?: boolean } = {}): string | null {
  if (plan.preamble === null) return null;
  const days = plan.days.map((day, i) => {
    const stay = plan.stays?.items.find((s) => s.ref === day.stayRef);
    return [`${options.numbered ? `[D${i + 1}] ` : ''}**${day.title}**`, day.body, stay && stayLine(stay, locale)]
      .filter(Boolean)
      .join('\n');
  });
  return [plan.preamble, ...days, plan.footer].filter(Boolean).join('\n\n');
}

function stayLine(item: ResultItem, locale: Locale): string {
  const name = item.title.original;
  const price = item.price ? `${item.price.amount} ${item.price.currency}` : null;
  if (locale === 'zh') return `- 今晚：${name}${price ? `（每晚 ${price} 起）` : ''}`;
  return `- Tonight: ${name}${price ? ` (from ${price} per night)` : ''}`;
}

/** Runs of consecutive nights on the same stay (or on none); night n is the night after day n + 1. */
export function segments(plan: Pick<Plan, 'days'>): { nights: NightRange; stayRef: string | null }[] {
  const out: { nights: NightRange; stayRef: string | null }[] = [];
  for (let night = 0; night < plan.days.length - 1; night++) {
    const stayRef = plan.days[night].stayRef;
    const prev = out.at(-1);
    if (prev && prev.stayRef === stayRef) prev.nights = { from: prev.nights.from, to: night };
    else out.push({ nights: { from: night, to: night }, stayRef });
  }
  return out;
}

/** What one edit replaces. Day and night indices are 0-based and already checked against the plan. */
export type Rewrites = {
  days?: ReadonlyMap<number, Pick<PlanDay, 'title' | 'body' | 'stops'>>;
  preamble?: string;
  /** Night index → stay ref. */
  nights?: ReadonlyMap<number, string>;
};

/**
 * The only way an existing plan's days change. Days not in `rewrites` come back as the same objects, so
 * a test can assert "untouched" with toBe. A rewritten day keeps its stay unless its night is rewritten.
 */
export function splice(plan: Plan, rewrites: Rewrites): Pick<Plan, 'preamble' | 'days'> {
  const days = plan.days.map((day, i) => {
    const text = rewrites.days?.get(i);
    const stayRef = rewrites.nights?.get(i);
    if (!text && stayRef === undefined) return day;
    return { ...day, ...text, stayRef: stayRef ?? day.stayRef };
  });
  return { preamble: rewrites.preamble ?? plan.preamble, days };
}

/** Every night of a range, mapped to one stay. */
export function nightsOf(range: NightRange, stayRef: string): Map<number, string> {
  return new Map(Array.from({ length: range.to - range.from + 1 }, (_, i) => [range.from + i, stayRef]));
}

/** The draft's overview line, used as the chat reply for a fresh draft. */
export function overviewLine(preamble: string | null): string | null {
  const paragraph = preamble?.split(/\n\s*\n/).find((p) => /overview|总览/i.test(p));
  const text = paragraph?.replace(/\*\*|^#+\s*/gm, '').replace(/^\s*(?:Overview|总览)\s*[:：]?\s*/i, '').trim();
  return text || null;
}

/** Hotels from several show_results calls. Refs never change, because days point at them. */
export function mergeStays(stays: ResultGroup | null, group: ResultGroup, inUse: ReadonlySet<string> = new Set()): ResultGroup {
  const items = [...(stays?.items ?? [])];
  let next = Math.max(0, ...items.map((i) => Number(i.ref.slice(1)) || 0)) + 1;
  for (const item of group.items) {
    const at = item.id ? items.findIndex((i) => i.id === item.id) : -1;
    if (at >= 0) items[at] = { ...item, ref: items[at].ref };
    else items.push({ ...item, ref: `h${next++}` });
  }
  // Over the cap, drop the oldest stays no day uses.
  while (items.length > 20) {
    const drop = items.findIndex((i) => !inUse.has(i.ref));
    if (drop < 0) break;
    items.splice(drop, 1);
  }
  return { panel: 'hotels', items: items.slice(0, 20) };
}
