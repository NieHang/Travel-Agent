// Lets a subagent screen the spot-check queue before a person reviews it, so the person sees only the calls the
// screener found wrong plus a small sample of the ones it upheld.
// Usage: bun run eval:spot-screen            writes results/judge/spot-screen.md and an empty spot-screen.verdicts.json
//        bun run eval:spot-screen --import   writes the filled verdicts into spot-checks.json
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { applyScreen, reviewed, SCREEN_QUESTION, ScreenFileSchema, SPOT_QUEUE, SpotFileSchema, spotKey, type Spot } from './spot-checks.js';

const SHEET = new URL('../results/judge/spot-screen.md', import.meta.url);
const VERDICTS = new URL('../results/judge/spot-screen.verdicts.json', import.meta.url);

const queue = SpotFileSchema.parse(JSON.parse(await readFile(SPOT_QUEUE, 'utf8')));
if (process.argv[2] === '--import') {
  const file = ScreenFileSchema.parse(JSON.parse(await readFile(VERDICTS, 'utf8')));
  const items = applyScreen(queue.items, file);
  await writeFile(SPOT_QUEUE, JSON.stringify({ items }, null, 2) + '\n');
  const screened = items.filter((s) => file.items.some((f) => spotKey(f) === spotKey(s)));
  const count = (test: (s: Spot) => boolean) => screened.filter(test).length;
  console.log(`${screened.length} screened by ${file.screener}: ${count((s) => s.screen!.verdict === 'wrong')} judge wrong, ${count((s) => s.screen!.verdict === 'right')} upheld (${count((s) => s.screen!.audit)} kept for you as an audit) → bun run eval:spot`);
} else {
  const todo = queue.items.filter((s) => !s.screen && !reviewed(s));
  if (!todo.length) throw new Error('Nothing to screen: every queued item is screened or reviewed');
  await writeFile(SHEET, [`# Spot-check screening sheet\n\n${SCREEN_QUESTION}`, ...todo.map(renderSpot)].join('\n\n') + '\n');
  await writeFile(VERDICTS, JSON.stringify({ screener: '', items: todo.map((s) => ({ source: s.source, id: s.id, verdict: '', reason: '' })) }, null, 2) + '\n');
  console.log(`${todo.length} items → ${fileURLToPath(SHEET)}; fill ${fileURLToPath(VERDICTS)}, then run eval:spot-screen --import`);
}

function renderSpot(s: Spot): string {
  return [`## ${s.source} ${s.id}`, `Kind: ${s.kind}`, `Why queued: ${s.why}`, 'Judge:', ...s.judge.map((line) => `- ${line}`), '', s.text].join('\n');
}
