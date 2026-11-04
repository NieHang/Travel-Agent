import { z } from 'zod';

// The web facts the judge's verdicts rest on, each with the source it was checked against and the verdicts citing it.
// A person checks the sources instead of labelling the fact criteria blind, which needs knowledge of the place.
const CiteSchema = z.object({ trial: z.string(), id: z.string(), criterion: z.string() }).strict();
export const FactFileSchema = z.object({
  rubricHash: z.string(), checked: z.string(),
  facts: z.array(z.object({
    id: z.string(), claim: z.string(), note: z.string().optional(),
    sources: z.array(z.object({ url: z.string().url(), look: z.string() }).strict()).min(1),
    cites: z.array(CiteSchema).min(1),
  }).strict()),
}).strict();
export type FactFile = z.infer<typeof FactFileSchema>;

// A note without a verdict means the checker is undecided, as with labels.
const CheckSchema = z.object({ fact: z.string(), verdict: z.enum(['supported', 'unsupported']).nullable(), note: z.string().optional() }).strict();
export const CheckFileSchema = z.object({ rubricHash: z.string(), checks: z.array(CheckSchema) }).strict();
export type CheckFile = z.infer<typeof CheckFileSchema>;

export type Doubt = { fact: string; claim: string; verdict: 'unsupported' | null; note?: string; cites: z.infer<typeof CiteSchema>[] };

/** How many checked facts their sources support, and every fact found unsupported or left undecided, with the verdicts resting on it. */
export function factCheck(facts: FactFile, checks: CheckFile): { checked: number; supported: number; doubts: Doubt[] } {
  const byId = new Map(facts.facts.map((f) => [f.id, f]));
  const doubts: Doubt[] = [];
  for (const check of checks.checks) {
    const fact = byId.get(check.fact);
    if (!fact) throw new Error(`Checked fact ${check.fact} is not in facts.json`);
    if (check.verdict !== 'supported') doubts.push({ fact: fact.id, claim: fact.claim, verdict: check.verdict, ...check.note ? { note: check.note } : {}, cites: fact.cites });
  }
  const checked = checks.checks.filter((c) => c.verdict).length;
  return { checked, supported: checks.checks.filter((c) => c.verdict === 'supported').length, doubts };
}
