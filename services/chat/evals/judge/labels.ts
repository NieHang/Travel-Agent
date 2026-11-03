import { z } from 'zod';
import type { Verdict, VerdictFile } from './verdicts.js';

// A note without a verdict means the labeller is undecided; it is listed, not counted.
const LabelSchema = z.object({ criterion: z.string(), verdict: z.enum(['pass', 'fail', 'na']).nullable(), note: z.string().optional() }).strict();
export type Label = z.infer<typeof LabelSchema>;
export const LabelFileSchema = z.object({
  runName: z.string(), rubricHash: z.string(),
  items: z.array(z.object({ id: z.string(), labels: z.array(LabelSchema) }).strict()),
}).strict();
export type LabelFile = z.infer<typeof LabelFileSchema>;

export type Agreement = { criterion: string; n: number; agreed: number };
export type Disagreement = { runName: string; id: string; criterion: string; judge: Verdict['verdict']; human: Label['verdict']; reason: string; note?: string };

/**
 * How often the judge's verdict equals a person's label, per general criterion and for the `must` lines together
 * (their wording differs per item). Only labelled criteria count, so a half-labelled trial is fine. Undecided
 * labels (a note, no verdict) come back with the judge's verdict beside them.
 */
export function agreement(pairs: { verdicts: VerdictFile; labels: LabelFile }[]): { rows: Agreement[]; disagreements: Disagreement[]; undecided: Disagreement[] } {
  const rows = new Map<string, Agreement>();
  const disagreements: Disagreement[] = [];
  const undecided: Disagreement[] = [];
  for (const { verdicts, labels } of pairs) {
    for (const item of labels.items) {
      const judged = new Map(verdicts.items.find((i) => i.id === item.id)?.verdicts.map((v) => [v.criterion, v]));
      for (const label of item.labels) {
        const verdict = judged.get(label.criterion);
        if (!verdict) throw new Error(`${labels.runName} ${item.id}: no judge verdict for ${label.criterion}`);
        if (!label.verdict) {
          undecided.push({ runName: labels.runName, id: item.id, criterion: label.criterion, judge: verdict.verdict, human: null, reason: verdict.reason, ...label.note ? { note: label.note } : {} });
          continue;
        }
        const criterion = label.criterion.startsWith('must_') ? 'must' : label.criterion;
        const row = rows.get(criterion) ?? { criterion, n: 0, agreed: 0 };
        rows.set(criterion, { criterion, n: row.n + 1, agreed: row.agreed + Number(verdict.verdict === label.verdict) });
        if (verdict.verdict !== label.verdict) {
          disagreements.push({ runName: labels.runName, id: item.id, criterion: label.criterion, judge: verdict.verdict, human: label.verdict, reason: verdict.reason, ...label.note ? { note: label.note } : {} });
        }
      }
    }
  }
  return { rows: [...rows.values()], disagreements, undecided };
}
