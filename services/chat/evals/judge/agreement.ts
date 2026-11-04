// Compares hand labels from eval:label with the judge's verdicts for the same trials: agreement per criterion, then
// every disagreement with the judge's reason and the person's note; then, once eval:check has been used, the facts
// whose sources were found not to support them.
// Usage: bun run eval:agreement
import { existsSync } from 'node:fs';
import { readdir, readFile } from 'node:fs/promises';
import { CheckFileSchema, factCheck, FactFileSchema } from './facts.js';
import { agreement, LabelFileSchema } from './labels.js';
import { VerdictFileSchema } from './verdicts.js';

// Below this many labels a criterion's agreement is too noisy to decide whether it counts.
const MIN_LABELS = 10;
const folder = new URL('../results/judge/', import.meta.url);
const trials = (await readdir(folder)).filter((f) => f.endsWith('.labels.json')).sort().map((f) => f.replace(/\.labels\.json$/, ''));
if (!trials.length) throw new Error('No labels yet; run eval:label first');
const pairs = await Promise.all(trials.map(async (trial) => {
  const labels = LabelFileSchema.parse(JSON.parse(await readFile(new URL(`${trial}.labels.json`, folder), 'utf8')));
  const verdicts = VerdictFileSchema.parse(JSON.parse(await readFile(new URL(`${trial}.verdicts.json`, folder), 'utf8')));
  if (labels.runName !== verdicts.runName || labels.rubricHash !== verdicts.rubricHash) {
    throw new Error(`${trial}: labels are for ${labels.runName} under rubric ${labels.rubricHash}, verdicts for ${verdicts.runName} under ${verdicts.rubricHash}`);
  }
  return { verdicts, labels };
}));

const { rows, disagreements, undecided } = agreement(pairs);
console.log(`Rubric ${pairs[0].labels.rubricHash}, judge ${[...new Set(pairs.map((p) => p.verdicts.judge))].join(', ')}, ${trials.length} trials`);
console.table(rows.map(({ criterion, n, agreed }) => ({
  criterion, labelled: n, agreement: `${Math.round((agreed / n) * 100)}%`,
  status: n < MIN_LABELS ? `too few (< ${MIN_LABELS})` : agreed / n >= 0.8 ? 'counts' : 'below 80%: rewrite the criterion',
})));
for (const [title, list] of [['Disagreements', disagreements], ['Undecided (note only)', undecided]] as const) {
  if (list.length) console.log(`\n## ${title}`);
  for (const d of list) {
    console.log(`\n${d.runName} ${d.id} ${d.criterion}: judge ${d.judge}, human ${d.human ?? 'undecided'}\n  judge: ${d.reason}${d.note ? `\n  human: ${d.note}` : ''}`);
  }
}

const checksPath = new URL('facts.checks.json', folder);
if (existsSync(checksPath)) {
  const facts = FactFileSchema.parse(JSON.parse(await readFile(new URL('facts.json', folder), 'utf8')));
  const { checked, supported, doubts } = factCheck(facts, CheckFileSchema.parse(JSON.parse(await readFile(checksPath, 'utf8'))));
  console.log(`\n## Source check (eval:check)\n\n${supported} of ${checked} checked facts supported by their sources, ${facts.facts.length - checked} not checked`);
  for (const d of doubts) {
    console.log(`\n${d.fact} ${d.verdict ?? 'undecided'}: ${d.claim}${d.note ? `\n  human: ${d.note}` : ''}\n  cited by: ${d.cites.map((c) => `${c.trial} ${c.id} ${c.criterion}`).join(', ')}`);
  }
}
