// Serves a local page for the spot-check queue that eval:compare fills: each item as the judge saw it, why it was
// queued, and the judge's verdicts or pairwise picks. Not blind; it asks whether the judge's call holds. Each click
// saves to results/judge/spot-checks.json, and reviewed items stay in the queue when later compares refill it.
// Usage: bun run eval:spot
import { existsSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { z } from 'zod';
import { readJson } from './read-json.js';
import { SPOT_QUEUE, SpotFileSchema } from './spot-checks.js';

const PORT = 4313;
if (!existsSync(SPOT_QUEUE)) throw new Error('The spot-check queue is empty; run eval:compare first');
const file = SpotFileSchema.parse(JSON.parse(await readFile(SPOT_QUEUE, 'utf8')));

const PostSchema = z.object({ source: z.string(), id: z.string(), verdict: z.enum(['right', 'wrong']).nullable(), note: z.string() });
createServer(async (req, res) => {
  if (req.method === 'GET' && req.url === '/') return res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }).end(page());
  if (req.method !== 'POST' || req.url !== '/spot') return res.writeHead(404).end('Not found');
  const parsed = PostSchema.safeParse(await readJson(req));
  const spot = parsed.success ? file.items.find((s) => s.source === parsed.data.source && s.id === parsed.data.id) : undefined;
  if (!parsed.success || !spot) return res.writeHead(400).end('Bad review');
  spot.verdict = parsed.data.verdict;
  if (parsed.data.note) spot.note = parsed.data.note;
  else delete spot.note;
  await writeFile(SPOT_QUEUE, JSON.stringify(file, null, 2) + '\n');
  res.writeHead(200, { 'content-type': 'application/json' }).end('{"ok":true}');
}).listen(PORT, '127.0.0.1');
const count = (verdict: 'right' | 'wrong') => file.items.filter((s) => s.verdict === verdict).length;
console.log(`${file.items.length} spot checks, ${count('right')} judge right, ${count('wrong')} judge wrong → http://127.0.0.1:${PORT}`);

function page(): string {
  const data = JSON.stringify(file.items).replaceAll('<', '\\u003c');
  return `<!doctype html>
<html lang="zh"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Spot Checks</title>
<style>
:root { color-scheme: light dark; --bg: #fafaf9; --panel: #fff; --line: #e7e5e4; --muted: #78716c; --ink: #1c1917; --accent: #2563eb; --pass: #15803d; --fail: #b91c1c; --warn: #b45309; }
@media (prefers-color-scheme: dark) { :root { --bg: #1c1917; --panel: #292524; --line: #44403c; --muted: #a8a29e; --ink: #f5f5f4; --accent: #60a5fa; --pass: #4ade80; --fail: #f87171; --warn: #fbbf24; } }
* { box-sizing: border-box; }
body { margin: 0; background: var(--bg); color: var(--ink); font: 14px/1.6 system-ui, sans-serif; display: grid; grid-template-columns: 280px 1fr; height: 100vh; }
nav { border-right: 1px solid var(--line); overflow-y: auto; padding: 12px 0; }
nav h1 { font-size: 13px; margin: 0 16px 8px; color: var(--muted); font-weight: 600; }
nav button { all: unset; box-sizing: border-box; display: flex; justify-content: space-between; gap: 8px; width: 100%; padding: 6px 16px; cursor: pointer; font-size: 13px; }
nav button[aria-current="true"] { background: var(--panel); box-shadow: inset 3px 0 var(--accent); }
nav .mark { color: var(--muted); }
nav .right .mark { color: var(--pass); }
nav .wrong .mark { color: var(--fail); }
main { overflow-y: auto; padding: 20px 28px 80px; }
header { display: flex; align-items: center; gap: 12px; margin-bottom: 12px; }
header h2 { margin: 0; font-size: 16px; flex: 1; }
header button { padding: 6px 12px; border: 1px solid var(--line); background: var(--panel); color: var(--ink); border-radius: 6px; cursor: pointer; }
section { background: var(--panel); border: 1px solid var(--line); border-radius: 8px; padding: 12px 16px; margin-top: 12px; }
section h3 { margin: 0 0 8px; font-size: 13px; color: var(--muted); font-weight: 600; }
.why { border-color: var(--warn); }
.why p, .judge p { margin: 0 0 6px; }
pre { white-space: pre-wrap; word-break: break-word; background: var(--panel); border: 1px solid var(--line); border-radius: 8px; padding: 16px; margin: 12px 0 0; font: 13px/1.55 ui-monospace, monospace; }
.row { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; }
.row button { padding: 6px 16px; border-radius: 999px; border: 1px solid var(--line); background: transparent; color: var(--ink); cursor: pointer; }
.row button[aria-pressed="true"][data-v="right"] { background: var(--pass); border-color: var(--pass); color: var(--panel); }
.row button[aria-pressed="true"][data-v="wrong"] { background: var(--fail); border-color: var(--fail); color: var(--panel); }
.row input { flex: 1; min-width: 200px; padding: 6px 8px; border: 1px solid var(--line); border-radius: 6px; background: transparent; color: var(--ink); }
@media (max-width: 760px) { body { grid-template-columns: 1fr; height: auto; } nav { border-right: 0; border-bottom: 1px solid var(--line); max-height: 40vh; } main { padding: 16px; } }
</style></head>
<body><nav><h1 id="progress"></h1><div id="list"></div></nav><main id="main"></main>
<script>
const queue = ${data};
let index = 0;
try { index = Math.min(Number(localStorage.getItem('spot-index')) || 0, queue.length - 1); } catch {}
const MARK = { right: '✓', wrong: '✗' };
const short = (s) => s.source.replace(/^itinerary@[^-]+-(dirty-)?/, '') + ' · ' + s.id.replace(/^l3-/, '');

function renderList() {
  const done = queue.filter((s) => s.verdict).length;
  document.getElementById('progress').textContent = done + ' / ' + queue.length + ' 条已复核';
  document.getElementById('list').replaceChildren(...queue.map((s, i) => {
    const b = document.createElement('button');
    b.setAttribute('aria-current', String(i === index));
    if (s.verdict) b.className = s.verdict;
    b.innerHTML = '<span></span><span class="mark"></span>';
    b.children[0].textContent = short(s);
    b.children[1].textContent = s.verdict ? MARK[s.verdict] : s.note ? '?' : '';
    b.onclick = () => go(i);
    return b;
  }));
}

function renderSpot() {
  const s = queue[index];
  const main = document.getElementById('main');
  main.innerHTML = '<header><h2></h2><button id="prev">← 上一条</button><button id="next">下一条 →</button></header>'
    + '<section class="why"><h3>为什么抽到</h3><p></p></section>'
    + '<section class="judge"><h3></h3></section>'
    + '<section id="ask"><h3></h3><div class="row"></div></section><pre></pre>';
  main.querySelector('h2').textContent = (s.kind === 'pairwise' ? 'pairwise · ' : '') + s.source + ' · ' + s.id;
  main.querySelector('.why p').textContent = s.why;
  main.querySelector('.judge h3').textContent = s.kind === 'pairwise' ? '两个顺序的判定' : '判官的判定';
  main.querySelector('.judge').append(...s.judge.map((line) => {
    const p = document.createElement('p');
    p.textContent = line;
    return p;
  }));
  main.querySelector('#ask h3').textContent = s.kind === 'pairwise' ? '最终结果（outcome）站得住吗？' : '判官的判定站得住吗？';
  main.querySelector('pre').textContent = s.text;
  main.querySelector('#prev').onclick = () => go(index - 1);
  main.querySelector('#next').onclick = () => go(index + 1);
  const note = document.createElement('input');
  note.placeholder = '备注：哪里不对、是判官错还是代码检查错（只写备注不选，算未决定）';
  note.value = s.note ?? '';
  const buttons = [['right', '站得住'], ['wrong', '不对']].map(([v, text]) => {
    const b = document.createElement('button');
    b.dataset.v = v;
    b.textContent = text;
    b.onclick = () => send(s, s.verdict === v ? null : v, note.value, buttons);
    return b;
  });
  note.onchange = () => send(s, s.verdict ?? null, note.value, buttons);
  press(buttons, s.verdict);
  main.querySelector('.row').replaceChildren(...buttons, note);
  main.scrollTop = 0;
}

const press = (buttons, verdict) => buttons.forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.v === verdict)));

async function send(s, verdict, note, buttons) {
  const res = await fetch('/spot', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ source: s.source, id: s.id, verdict, note }) });
  if (!res.ok) { document.querySelector('header h2').textContent = '没保存上（HTTP ' + res.status + '），刷新后再试'; return; }
  s.verdict = verdict;
  s.note = note || undefined;
  press(buttons, verdict);
  renderList();
}

function go(i) {
  if (i < 0 || i >= queue.length) return;
  index = i;
  try { localStorage.setItem('spot-index', String(i)); } catch {}
  renderList();
  renderSpot();
}
go(index);
</script></body></html>`;
}
