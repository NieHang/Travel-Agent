// After each compare, queues items for a person to check the judge on: where a code check and the judge disagree,
// where the two pairwise orders disagree, and a few random ones. The queue keeps a snapshot of each item, so
// eval:spot can show it without the runs; reviewed items stay, unreviewed ones from the same source are replaced.
import { randomInt } from 'node:crypto';
import { existsSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { z } from 'zod';
import { readDataset, type ItineraryEntry, type RunResult, type Score } from '../schemas.js';
import type { TurnOutput } from '../turn.js';
import type { Outcome } from './pairwise.js';
import { renderItem, renderOutput, renderRequest } from './sheet.js';

// Code checks and the judge criteria that cover the same ground. A failed check whose criterion the judge passed means
// the judge missed the problem or the check is too strict. The other way round is expected: the judge looks deeper.
const OVERLAPS: Record<string, string[]> = {
  pacing_ok: ['realistic_days', 'fits_party'], invented_hotel: ['no_unsupported_claims'], osaka_stays: ['hotel_fit'], budget_ok: ['hotel_fit'],
};
const RANDOM_PICKS = 3;
export const RANDOM_WHY = 'random pick';

// A screener (a subagent) reviews the queue before the person does; `audit` marks the upheld calls the person
// checks anyway, to keep an eye on the screener. `verdict` and `note` stay the person's own.
const ScreenSchema = z.object({ verdict: z.enum(['right', 'wrong']), reason: z.string().min(1), screener: z.string().min(1), audit: z.boolean() }).strict();
const SpotSchema = z.object({
  kind: z.enum(['checklist', 'pairwise']), source: z.string(), id: z.string(), why: z.string(), text: z.string(), judge: z.array(z.string()),
  screen: ScreenSchema.optional(), verdict: z.enum(['right', 'wrong']).nullable().optional(), note: z.string().optional(),
}).strict();
export type Spot = z.infer<typeof SpotSchema>;
export const SpotFileSchema = z.object({ items: z.array(SpotSchema) }).strict();
export const SPOT_QUEUE = new URL('../results/judge/spot-checks.json', import.meta.url);

export type Pick = (n: number) => number;
type ItineraryRun = { runName: string; items: { id: string; output: TurnOutput | null; scores: Score[] }[] };

export const spotKey = (s: { source: string; id: string }) => `${s.source} ${s.id}`;
export const reviewed = (s: Spot) => Boolean(s.verdict || s.note);
/** Unscreened items, those the screener found wrong, and the audit sample of those it upheld. */
export const forPerson = (s: Spot) => !s.screen || s.screen.verdict === 'wrong' || s.screen.audit;
const trialName = (runName: string) => runName.replace('#', '_');

/** Judged items whose code checks and judge verdicts disagree, plus random others; `skip` holds items already reviewed. */
export function checklistSpots(runs: ItineraryRun[], entries: Map<string, ItineraryEntry>, skip: Set<string>, pick: Pick = randomInt): Spot[] {
  const spots = runs.flatMap((run) => run.items.flatMap((item): Spot[] => {
    const entry = entries.get(item.id);
    if (!entry || !item.output || !item.scores.some((s) => s.name === 'judge_checklist')) return [];
    const value = (name: string) => item.scores.find((s) => s.name === name)?.value;
    const missed = Object.entries(OVERLAPS).flatMap(([check, criteria]) => {
      const v = value(check);
      const failed = v !== undefined && (check === 'invented_hotel' ? v > 0 : v < 1);
      const passed = criteria.filter((c) => value(`judge_${c}`) === 1);
      return failed && passed.length ? [`${check} failed, judge passed ${passed.join(', ')}`] : [];
    });
    return [{
      kind: 'checklist', source: trialName(run.runName), id: item.id, why: missed.join('; ') || RANDOM_WHY,
      text: renderItem(entry, item.output).split('\nCriteria:')[0], judge: judgeLines(item.scores),
    }];
  }));
  return withRandom(spots.filter((s) => !skip.has(spotKey(s))), pick);
}

/** Pairwise items whose two orders picked differently, plus random others. `aIsBase` is draft A's run in order 1. */
export function pairwiseSpots(stem: string, items: { entry: ItineraryEntry; base: TurnOutput; candidate: TurnOutput; aIsBase: boolean }[], outcomes: Outcome[], skip: Set<string>, pick: Pick = randomInt): Spot[] {
  const spots = items.map(({ entry, base, candidate, aIsBase }): Spot => {
    const { picks, reasons, result } = outcomes.find((o) => o.id === entry.id)!;
    // The reasons name drafts A and B, and order 2 swaps them.
    const draftA = (order: 1 | 2) => ((order === 1) === aIsBase ? 'base' : 'candidate');
    return {
      kind: 'pairwise', source: stem, id: entry.id, why: picks[0] === picks[1] ? RANDOM_WHY : `orders disagree: ${picks[0]} vs ${picks[1]}`,
      text: [...renderRequest(entry), '### Base', ...renderOutput(base), '### Candidate', ...renderOutput(candidate)].join('\n'),
      judge: [`order 1 (A = ${draftA(1)}) picked ${picks[0]}: ${reasons[0]}`, `order 2 (A = ${draftA(2)}) picked ${picks[1]}: ${reasons[1]}`, `outcome: ${result}`],
    };
  });
  return withRandom(spots.filter((s) => !skip.has(spotKey(s))), pick);
}

// Upheld calls the person still checks per import: enough to notice a screener that waves everything through.
const AUDIT_PICKS = 2;

export const SCREEN_QUESTION = `You are checking an LLM judge's calls, so look for what it got wrong rather than reasons to agree. For each item, answer right when the judge's call holds and wrong when it does not, with a one-sentence reason naming the evidence.
- Code check vs judge: the item failed a code check while the judge passed a criterion covering the same ground. Decide which is right. pacing_ok allows at most 4 places a day (3 for elderly or family trips), counting restaurants and shops but not stations, airports, meals "nearby", a place repeated the same day or an area named inside another of its places ("奈良" next to "奈良公园"), and no first or last day busier than the busiest middle day. Wrong means the judge missed a real problem; right means the check is too strict here.
- Pairwise orders disagree: the two orders picked differently, so the outcome is a tie. Right when the drafts really are about even; wrong when one is clearly better (say which).
- Random pick: check every verdict (or the pairwise outcome) shown.
Check every fact a verdict rests on with a web search, never from memory, and cite the source. Hotel facts must match the shown results.`;

export const ScreenFileSchema = z.object({
  screener: z.string().min(1),
  items: z.array(z.object({ source: z.string(), id: z.string(), verdict: z.enum(['right', 'wrong']), reason: z.string().min(1) }).strict()),
}).strict();
export type ScreenFile = z.infer<typeof ScreenFileSchema>;

/** Writes the screener's verdicts onto the queue and marks a random few of the upheld ones for the person to audit. */
export function applyScreen(queue: Spot[], file: ScreenFile, pick: Pick = randomInt): Spot[] {
  const keys = new Set(queue.map(spotKey));
  const unknown = file.items.filter((f) => !keys.has(spotKey(f)));
  if (unknown.length) throw new Error(`Not in the queue: ${unknown.map(spotKey).join(', ')}`);
  const audit = new Set(sample(file.items.filter((f) => f.verdict === 'right'), AUDIT_PICKS, pick).map(spotKey));
  return queue.map((s) => {
    const f = file.items.find((i) => spotKey(i) === spotKey(s));
    return f ? { ...s, screen: { verdict: f.verdict, reason: f.reason, screener: file.screener, audit: audit.has(spotKey(f)) } } : s;
  });
}

/** Reviewed spots stay; unreviewed ones from these sources make way for the new picks. */
export function mergeQueue(queue: Spot[], sources: string[], fresh: Spot[]): Spot[] {
  return [...queue.filter((s) => !sources.includes(s.source) || reviewed(s)), ...fresh];
}

export async function queueChecklistSpots(runs: RunResult[]) {
  const itinerary = runs.flatMap((run) => (run.suite === 'itinerary' ? [run] : []));
  if (!itinerary.some((run) => run.items.some((i) => i.scores.some((s) => s.name === 'judge_checklist')))) {
    console.log('Spot checks: no candidate trial is judged yet (eval:judge-pack, then eval:judge-import)');
    return;
  }
  const entries = new Map((await readDataset('itinerary') as ItineraryEntry[]).map((e) => [e.id, e]));
  await queueSpots(itinerary.map((run) => trialName(run.runName)), (skip) => checklistSpots(itinerary, entries, skip));
}

export async function queueSpots(sources: string[], build: (skip: Set<string>) => Spot[]) {
  const queue = existsSync(SPOT_QUEUE) ? SpotFileSchema.parse(JSON.parse(await readFile(SPOT_QUEUE, 'utf8'))).items : [];
  const fresh = build(new Set(queue.filter(reviewed).map(spotKey)));
  await writeFile(SPOT_QUEUE, JSON.stringify({ items: mergeQueue(queue, sources, fresh) }, null, 2) + '\n');
  console.log(`\nSpot checks: ${fresh.length} queued → bun run eval:spot`);
  for (const s of fresh) console.log(`  ${s.source} ${s.id}: ${s.why}`);
}

function withRandom(spots: Spot[], pick: Pick): Spot[] {
  return [...spots.filter((s) => s.why !== RANDOM_WHY), ...sample(spots.filter((s) => s.why === RANDOM_WHY), RANDOM_PICKS, pick)];
}

export function sample<T>(list: T[], n: number, pick: Pick): T[] {
  const pool = [...list];
  const picked: T[] = [];
  while (picked.length < n && pool.length) picked.push(pool.splice(pick(pool.length), 1)[0]);
  return picked;
}

// judge_must holds one line per must criterion in its comment; judge_checklist is the share and has no reason.
function judgeLines(scores: Score[]): string[] {
  return scores.flatMap((s) => {
    if (s.name === 'judge_must') return (s.comment ?? '').split('\n');
    if (!s.name.startsWith('judge_') || s.name === 'judge_checklist') return [];
    return [`${s.name.slice('judge_'.length)} ${s.value === 1 ? 'pass' : 'fail'}: ${s.comment ?? ''}`];
  });
}
