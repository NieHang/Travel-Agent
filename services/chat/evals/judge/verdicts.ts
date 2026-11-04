import { z } from 'zod';
import type { ItineraryEntry, Score } from '../schemas.js';
import { criteriaFor } from './rubric.js';

const VerdictSchema = z.object({ criterion: z.string(), verdict: z.enum(['pass', 'fail', 'na']), reason: z.string().min(1) }).strict();
export type Verdict = z.infer<typeof VerdictSchema>;
export const VerdictFileSchema = z.object({
  runName: z.string(), rubricHash: z.string(), judge: z.string().min(1),
  items: z.array(z.object({ id: z.string(), verdicts: z.array(VerdictSchema) }).strict()),
}).strict();
export type VerdictFile = z.infer<typeof VerdictFileSchema>;

/**
 * judge_<criterion> per general question, judge_must for the item's own `must` lines (their meaning differs per
 * item, so only the share that pass is comparable), and judge_checklist over everything. n/a counts nowhere.
 */
export function judgeScores(entry: ItineraryEntry, verdicts: Verdict[]): Score[] {
  const expected = criteriaFor(entry).map((c) => c.name);
  const given = verdicts.map((v) => v.criterion);
  if (given.length !== expected.length || expected.some((name) => !given.includes(name))) {
    throw new Error(`${entry.id}: verdicts must cover exactly ${expected.join(', ')}`);
  }
  const applicable = verdicts.filter((v) => v.verdict !== 'na');
  const share = (list: Verdict[]) => list.filter((v) => v.verdict === 'pass').length / list.length;
  const must = applicable.filter((v) => v.criterion.startsWith('must_'));
  return [
    ...applicable.filter((v) => !v.criterion.startsWith('must_')).map((v) => ({ name: `judge_${v.criterion}`, value: Number(v.verdict === 'pass'), comment: v.reason })),
    ...must.length ? [{ name: 'judge_must', value: share(must), comment: must.map((v) => `${v.criterion} ${v.verdict}: ${v.reason}`).join('\n') }] : [],
    ...applicable.length ? [{ name: 'judge_checklist', value: share(applicable) }] : [],
  ];
}
