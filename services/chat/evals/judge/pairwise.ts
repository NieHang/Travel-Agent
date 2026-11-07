import { z } from 'zod';

export const PAIRWISE_QUESTION =
  'Which draft serves this user better overall, weighing the criteria listed? Answer A, B or tie, with a one-sentence reason naming the difference that decided it. Check facts with a web search, never from memory. Length earns no credit; prefer tie over a pick that rests on taste.';

// Order 1 shows each item with the drafts placed by `aIsBase`; order 2 swaps them, so a pick that follows the position flips.
export const PairwiseKeySchema = z.object({
  base: z.string(), candidate: z.string(), rubricHash: z.string(), aIsBase: z.record(z.boolean()),
}).strict();
export type PairwiseKey = z.infer<typeof PairwiseKeySchema>;

// The verdict files name no run, so the judge cannot tell which draft is the baseline.
export const PairwiseFileSchema = z.object({
  order: z.union([z.literal(1), z.literal(2)]), judge: z.string().min(1),
  items: z.array(z.object({ id: z.string(), winner: z.enum(['A', 'B', 'tie']), reason: z.string().min(1) }).strict()),
}).strict();
export type PairwiseFile = z.infer<typeof PairwiseFileSchema>;

type RunPick = 'base' | 'candidate' | 'tie';
export type Outcome = { id: string; result: 'win' | 'loss' | 'tie'; picks: [RunPick, RunPick]; reasons: [string, string] };

/**
 * The candidate's result per item: a win or a loss only when both orders pick the same run, otherwise a tie.
 * The win rate counts a tie as half a win, so a judge that cannot tell the drafts apart lands near 50%.
 */
export function pairwiseOutcomes(key: PairwiseKey, first: PairwiseFile, second: PairwiseFile) {
  const ids = Object.keys(key.aIsBase);
  for (const [file, order] of [[first, 1], [second, 2]] as const) {
    if (file.order !== order) throw new Error(`Expected the order ${order} verdicts, got order ${file.order}`);
    const given = file.items.map((i) => i.id);
    if (given.length !== ids.length || ids.some((id) => !given.includes(id))) throw new Error(`Order ${order} verdicts must cover exactly: ${ids.join(', ')}`);
  }
  const items = ids.map((id): Outcome => {
    const a = first.items.find((i) => i.id === id)!;
    const b = second.items.find((i) => i.id === id)!;
    const picks: Outcome['picks'] = [runPicked(a.winner, key.aIsBase[id]), runPicked(b.winner, !key.aIsBase[id])];
    const result = picks[0] === picks[1] && picks[0] !== 'tie' ? (picks[0] === 'candidate' ? 'win' : 'loss') : 'tie';
    return { id, result, picks, reasons: [a.reason, b.reason] };
  });
  const count = (result: Outcome['result']) => items.filter((i) => i.result === result).length;
  const [wins, losses, ties] = [count('win'), count('loss'), count('tie')];
  return { items, wins, losses, ties, winRate: (wins + ties / 2) / items.length };
}

function runPicked(winner: 'A' | 'B' | 'tie', aIsBase: boolean): RunPick {
  if (winner === 'tie') return 'tie';
  return (winner === 'A') === aIsBase ? 'base' : 'candidate';
}

export const outcomeValue = (result: Outcome['result']) => (result === 'win' ? 1 : result === 'tie' ? 0.5 : 0);
