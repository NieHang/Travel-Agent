// Serves a local page for labelling judged trials by hand. The page never shows the judge's verdicts, so the labels
// stay blind; each click saves to results/judge/<trial>.labels.json, which eval:agreement compares with the verdicts.
// Usage: bun run eval:label [run names with trial]; with none, every trial judged under the current rubric.
import { existsSync } from 'node:fs';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { z } from 'zod';
import { readDataset, ResultSchema, type ItineraryEntry } from '../schemas.js';
import { LabelFileSchema, type LabelFile } from './labels.js';
import { readJson } from './read-json.js';
import { criteriaFor, RUBRIC_HASH } from './rubric.js';
import { judgedItems, renderItem } from './sheet.js';

const PORT = 4311;
const folder = new URL('../results/judge/', import.meta.url);
const names = process.argv.slice(2).map((n) => n.replace('#', '_'));
const trials = names.length ? names : await judgedTrials();
if (!trials.length) throw new Error(`No trial is judged under rubric ${RUBRIC_HASH}; run eval:judge-pack and judge one first`);
const entries = new Map((await readDataset('itinerary') as ItineraryEntry[]).map((e) => [e.id, e]));

const labels = new Map<string, LabelFile>();
const queue: { trial: string; id: string; sheet: string; criteria: { name: string; question: string }[] }[] = [];
for (const trial of trials) {
  const run = ResultSchema.parse(JSON.parse(await readFile(new URL(`../results/${trial}.json`, import.meta.url), 'utf8')));
  if (run.suite !== 'itinerary') throw new Error(`${trial} is not an itinerary run`);
  labels.set(trial, await readLabels(trial, run.runName));
  for (const { entry, output } of judgedItems(run.items, entries)) {
    // The sheet's criteria list becomes the form, so it is cut from the text.
    const sheet = renderItem(entry, output).split('\nCriteria:')[0];
    queue.push({ trial, id: entry.id, sheet, criteria: criteriaFor(entry) });
  }
}

const PostSchema = z.object({ trial: z.string(), id: z.string(), criterion: z.string(), verdict: z.enum(['pass', 'fail', 'na']).nullable(), note: z.string() });
createServer(async (req, res) => {
  if (req.method === 'GET' && req.url === '/') return res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }).end(page());
  if (req.method !== 'POST' || req.url !== '/label') return res.writeHead(404).end('Not found');
  const parsed = PostSchema.safeParse(await readJson(req));
  if (!parsed.success || !labels.has(parsed.data.trial)) return res.writeHead(400).end('Bad label');
  await save(parsed.data);
  res.writeHead(200, { 'content-type': 'application/json' }).end('{"ok":true}');
}).listen(PORT, '127.0.0.1');
console.log(`${queue.length} items from ${trials.join(', ')} → http://127.0.0.1:${PORT}`);

async function save({ trial, id, criterion, verdict, note }: z.infer<typeof PostSchema>) {
  const file = labels.get(trial)!;
  const item = file.items.find((i) => i.id === id) ?? { id, labels: [] };
  const others = item.labels.filter((l) => l.criterion !== criterion);
  const updated = { id, labels: verdict || note ? [...others, { criterion, verdict, ...note ? { note } : {} }] : others };
  file.items = [...file.items.filter((i) => i.id !== id), ...updated.labels.length ? [updated] : []];
  await writeFile(new URL(`${trial}.labels.json`, folder), JSON.stringify(file, null, 2) + '\n');
}

async function judgedTrials(): Promise<string[]> {
  const files = (await readdir(folder)).filter((f) => f.endsWith('.verdicts.json')).sort();
  const current = await Promise.all(files.map(async (f) => JSON.parse(await readFile(new URL(f, folder), 'utf8')).rubricHash === RUBRIC_HASH));
  return files.filter((_, i) => current[i]).map((f) => f.replace(/\.verdicts\.json$/, ''));
}

async function readLabels(trial: string, runName: string): Promise<LabelFile> {
  const path = new URL(`${trial}.labels.json`, folder);
  if (!existsSync(path)) return { runName, rubricHash: RUBRIC_HASH, items: [] };
  const file = LabelFileSchema.parse(JSON.parse(await readFile(path, 'utf8')));
  if (file.rubricHash !== RUBRIC_HASH) throw new Error(`${trial}.labels.json uses rubric ${file.rubricHash}, the current one is ${RUBRIC_HASH}; move it aside to label again`);
  return file;
}

function page(): string {
  const data = JSON.stringify({ queue, labels: Object.fromEntries(labels) }).replaceAll('<', '\\u003c');
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Judge Labels</title>
<style>
:root { color-scheme: light dark; --bg: #fafaf9; --panel: #fff; --line: #e7e5e4; --muted: #78716c; --ink: #1c1917; --accent: #2563eb; --pass: #15803d; --fail: #b91c1c; --na: #57534e; }
@media (prefers-color-scheme: dark) { :root { --bg: #1c1917; --panel: #292524; --line: #44403c; --muted: #a8a29e; --ink: #f5f5f4; --accent: #60a5fa; --pass: #4ade80; --fail: #f87171; --na: #d6d3d1; } }
* { box-sizing: border-box; }
body { margin: 0; background: var(--bg); color: var(--ink); font: 14px/1.5 system-ui, sans-serif; display: grid; grid-template-columns: 260px 1fr; height: 100vh; }
nav { border-right: 1px solid var(--line); overflow-y: auto; padding: 12px 0; }
nav h1 { font-size: 13px; margin: 0 16px 8px; color: var(--muted); font-weight: 600; }
nav button { all: unset; box-sizing: border-box; display: flex; justify-content: space-between; gap: 8px; width: 100%; padding: 6px 16px; cursor: pointer; font-size: 13px; }
nav button[aria-current="true"] { background: var(--panel); box-shadow: inset 3px 0 var(--accent); }
nav .count { color: var(--muted); font-variant-numeric: tabular-nums; }
nav .done .count { color: var(--pass); }
main { overflow-y: auto; padding: 20px 28px 80px; }
header { display: flex; align-items: center; gap: 12px; margin-bottom: 12px; }
header h2 { margin: 0; font-size: 16px; flex: 1; }
header button { padding: 6px 12px; border: 1px solid var(--line); background: var(--panel); color: var(--ink); border-radius: 6px; cursor: pointer; }
pre { white-space: pre-wrap; word-break: break-word; background: var(--panel); border: 1px solid var(--line); border-radius: 8px; padding: 16px; font: 13px/1.55 ui-monospace, monospace; }
.criterion { background: var(--panel); border: 1px solid var(--line); border-radius: 8px; padding: 12px 16px; margin-top: 10px; }
.criterion p { margin: 0 0 8px; }
.criterion b { font-family: ui-monospace, monospace; }
.row { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; }
.row button { padding: 4px 14px; border-radius: 999px; border: 1px solid var(--line); background: transparent; color: var(--ink); cursor: pointer; }
.row button[aria-pressed="true"][data-v="pass"] { background: var(--pass); border-color: var(--pass); color: var(--panel); }
.row button[aria-pressed="true"][data-v="fail"] { background: var(--fail); border-color: var(--fail); color: var(--panel); }
.row button[aria-pressed="true"][data-v="na"] { background: var(--na); border-color: var(--na); color: var(--panel); }
.row input { flex: 1; min-width: 200px; padding: 5px 8px; border: 1px solid var(--line); border-radius: 6px; background: transparent; color: var(--ink); }
@media (max-width: 760px) { body { grid-template-columns: 1fr; height: auto; } nav { border-right: 0; border-bottom: 1px solid var(--line); max-height: 40vh; } main { padding: 16px; } }
</style></head>
<body><nav><h1 id="progress"></h1><div id="list"></div></nav><main id="main"></main>
<script>
const { queue, labels } = ${data};
let index = 0;
try { index = Math.min(Number(localStorage.getItem('label-index')) || 0, queue.length - 1); } catch {}
const labelOf = (q, criterion) => labels[q.trial].items.find((i) => i.id === q.id)?.labels.find((l) => l.criterion === criterion);
const doneCount = (q) => q.criteria.filter((c) => labelOf(q, c.name)?.verdict).length;

function renderList() {
  const done = queue.filter((q) => doneCount(q) === q.criteria.length).length;
  document.getElementById('progress').textContent = done + ' / ' + queue.length + ' items labelled';
  const list = document.getElementById('list');
  list.replaceChildren(...queue.map((q, i) => {
    const b = document.createElement('button');
    b.setAttribute('aria-current', String(i === index));
    if (doneCount(q) === q.criteria.length) b.className = 'done';
    b.innerHTML = '<span></span><span class="count"></span>';
    b.children[0].textContent = q.trial.replace(/^.*-([ab]_\\d+)$/, '$1') + ' · ' + q.id.replace(/^l3-/, '');
    b.children[1].textContent = doneCount(q) + '/' + q.criteria.length;
    b.onclick = () => go(i);
    return b;
  }));
}

function renderItem() {
  const q = queue[index];
  const main = document.getElementById('main');
  main.innerHTML = '<header><h2></h2><button id="prev">← Prev</button><button id="next">Next →</button></header><pre></pre><div id="criteria"></div>';
  main.querySelector('h2').textContent = q.trial + ' · ' + q.id;
  main.querySelector('pre').textContent = q.sheet;
  main.querySelector('#prev').onclick = () => go(index - 1);
  main.querySelector('#next').onclick = () => go(index + 1);
  main.querySelector('#criteria').replaceChildren(...q.criteria.map((c) => {
    const box = document.createElement('div');
    box.className = 'criterion';
    box.innerHTML = '<p><b></b> <span></span></p><div class="row"></div>';
    box.querySelector('b').textContent = c.name;
    box.querySelector('span').textContent = c.question;
    const row = box.querySelector('.row');
    const note = document.createElement('input');
    note.placeholder = 'Note (a note alone means undecided)';
    note.value = labelOf(q, c.name)?.note ?? '';
    const buttons = ['pass', 'fail', 'na'].map((v) => {
      const b = document.createElement('button');
      b.dataset.v = v;
      b.textContent = v;
      b.onclick = () => send(q, c.name, labelOf(q, c.name)?.verdict === v ? null : v, note.value, buttons);
      return b;
    });
    note.onchange = () => send(q, c.name, labelOf(q, c.name)?.verdict ?? null, note.value, buttons);
    press(buttons, labelOf(q, c.name)?.verdict);
    row.replaceChildren(...buttons, note);
    return box;
  }));
  main.scrollTop = 0;
}

const press = (buttons, verdict) => buttons.forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.v === verdict)));

// Updates only this criterion's buttons, so notes typed elsewhere on the page are kept.
async function send(q, criterion, verdict, note, buttons) {
  const res = await fetch('/label', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ trial: q.trial, id: q.id, criterion, verdict, note }) });
  if (!res.ok) { document.querySelector('header h2').textContent = 'Not saved (HTTP ' + res.status + '); reload and try again'; return; }
  const file = labels[q.trial];
  const item = file.items.find((i) => i.id === q.id) ?? { id: q.id, labels: [] };
  item.labels = [...item.labels.filter((l) => l.criterion !== criterion), ...verdict || note ? [{ criterion, verdict, ...note ? { note } : {} }] : []];
  file.items = [...file.items.filter((i) => i.id !== q.id), ...item.labels.length ? [item] : []];
  press(buttons, verdict);
  renderList();
}

function go(i) {
  if (i < 0 || i >= queue.length) return;
  index = i;
  try { localStorage.setItem('label-index', String(i)); } catch {}
  renderList();
  renderItem();
}
go(index);
</script></body></html>`;
}
