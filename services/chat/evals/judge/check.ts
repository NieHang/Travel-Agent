// Serves a local page for checking the judge's web sources: each fact the fact verdicts (realistic_days,
// no_unsupported_claims) rest on, its source and what to look for there, and the verdicts citing it. Unlike
// eval:label this is not blind; it asks whether the source says what the judge claims. Each click saves to
// results/judge/facts.checks.json, which eval:agreement reports.
// Usage: bun run eval:check
import { existsSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { z } from 'zod';
import { CheckFileSchema, FactFileSchema, type CheckFile } from './facts.js';
import { readJson } from './read-json.js';
import { RUBRIC_HASH } from './rubric.js';
import { VerdictFileSchema } from './verdicts.js';

const PORT = 4312;
const folder = new URL('../results/judge/', import.meta.url);
const facts = FactFileSchema.parse(JSON.parse(await readFile(new URL('facts.json', folder), 'utf8')));
if (facts.rubricHash !== RUBRIC_HASH) throw new Error(`facts.json is for rubric ${facts.rubricHash}, the current one is ${RUBRIC_HASH}`);
const reasons = await readReasons([...new Set(facts.facts.flatMap((f) => f.cites.map((c) => c.trial)))]);
const queue = facts.facts.map((fact) => ({
  ...fact,
  cites: fact.cites.map((c) => {
    const verdict = reasons.get(`${c.trial} ${c.id} ${c.criterion}`);
    if (!verdict) throw new Error(`${fact.id} cites ${c.trial} ${c.id} ${c.criterion}, which has no verdict`);
    return { ...c, ...verdict };
  }),
}));
const checksPath = new URL('facts.checks.json', folder);
const checks: CheckFile = existsSync(checksPath) ? CheckFileSchema.parse(JSON.parse(await readFile(checksPath, 'utf8'))) : { rubricHash: RUBRIC_HASH, checks: [] };

const PostSchema = z.object({ fact: z.string(), verdict: z.enum(['supported', 'unsupported']).nullable(), note: z.string() });
createServer(async (req, res) => {
  if (req.method === 'GET' && req.url === '/') return res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }).end(page());
  if (req.method !== 'POST' || req.url !== '/check') return res.writeHead(404).end('Not found');
  const parsed = PostSchema.safeParse(await readJson(req));
  if (!parsed.success || !queue.some((f) => f.id === parsed.data.fact)) return res.writeHead(400).end('Bad check');
  const { fact, verdict, note } = parsed.data;
  checks.checks = [...checks.checks.filter((c) => c.fact !== fact), ...verdict || note ? [{ fact, verdict, ...note ? { note } : {} }] : []];
  await writeFile(checksPath, JSON.stringify(checks, null, 2) + '\n');
  res.writeHead(200, { 'content-type': 'application/json' }).end('{"ok":true}');
}).listen(PORT, '127.0.0.1');
console.log(`${queue.length} facts checked ${facts.checked} → http://127.0.0.1:${PORT}`);

async function readReasons(trials: string[]): Promise<Map<string, { verdict: string; reason: string }>> {
  const reasons = new Map<string, { verdict: string; reason: string }>();
  for (const trial of trials) {
    const file = VerdictFileSchema.parse(JSON.parse(await readFile(new URL(`${trial}.verdicts.json`, folder), 'utf8')));
    if (file.rubricHash !== RUBRIC_HASH) throw new Error(`${trial}.verdicts.json uses rubric ${file.rubricHash}, the current one is ${RUBRIC_HASH}`);
    for (const item of file.items) for (const v of item.verdicts) reasons.set(`${trial} ${item.id} ${v.criterion}`, { verdict: v.verdict, reason: v.reason });
  }
  return reasons;
}

function page(): string {
  const data = JSON.stringify({ queue, checks: checks.checks }).replaceAll('<', '\\u003c');
  return `<!doctype html>
<html lang="zh"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Source Check</title>
<style>
:root { color-scheme: light dark; --bg: #fafaf9; --panel: #fff; --line: #e7e5e4; --muted: #78716c; --ink: #1c1917; --accent: #2563eb; --pass: #15803d; --fail: #b91c1c; --warn: #b45309; }
@media (prefers-color-scheme: dark) { :root { --bg: #1c1917; --panel: #292524; --line: #44403c; --muted: #a8a29e; --ink: #f5f5f4; --accent: #60a5fa; --pass: #4ade80; --fail: #f87171; --warn: #fbbf24; } }
* { box-sizing: border-box; }
body { margin: 0; background: var(--bg); color: var(--ink); font: 14px/1.6 system-ui, sans-serif; display: grid; grid-template-columns: 260px 1fr; height: 100vh; }
nav { border-right: 1px solid var(--line); overflow-y: auto; padding: 12px 0; }
nav h1 { font-size: 13px; margin: 0 16px 8px; color: var(--muted); font-weight: 600; }
nav button { all: unset; box-sizing: border-box; display: flex; justify-content: space-between; gap: 8px; width: 100%; padding: 6px 16px; cursor: pointer; font-size: 13px; }
nav button[aria-current="true"] { background: var(--panel); box-shadow: inset 3px 0 var(--accent); }
nav .mark { color: var(--muted); }
nav .supported .mark { color: var(--pass); }
nav .unsupported .mark { color: var(--fail); }
main { overflow-y: auto; padding: 20px 28px 80px; max-width: 900px; }
header { display: flex; align-items: center; gap: 12px; margin-bottom: 12px; }
header h2 { margin: 0; font-size: 18px; flex: 1; }
header button { padding: 6px 12px; border: 1px solid var(--line); background: var(--panel); color: var(--ink); border-radius: 6px; cursor: pointer; }
section { background: var(--panel); border: 1px solid var(--line); border-radius: 8px; padding: 12px 16px; margin-top: 12px; }
section h3 { margin: 0 0 8px; font-size: 13px; color: var(--muted); font-weight: 600; }
.note { border-color: var(--warn); }
.note p { margin: 0; }
.source { margin: 0 0 10px; }
.source:last-child { margin-bottom: 0; }
.source a { color: var(--accent); word-break: break-all; }
.source div { color: var(--muted); }
.cite { padding: 8px 0; border-top: 1px solid var(--line); }
.cite:first-of-type { border-top: 0; padding-top: 0; }
.cite b { font-family: ui-monospace, monospace; font-size: 12px; }
.cite .fail { color: var(--fail); }
.cite .pass { color: var(--pass); }
.row { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; }
.row button { padding: 6px 16px; border-radius: 999px; border: 1px solid var(--line); background: transparent; color: var(--ink); cursor: pointer; }
.row button[aria-pressed="true"][data-v="supported"] { background: var(--pass); border-color: var(--pass); color: var(--panel); }
.row button[aria-pressed="true"][data-v="unsupported"] { background: var(--fail); border-color: var(--fail); color: var(--panel); }
.row input { flex: 1; min-width: 200px; padding: 6px 8px; border: 1px solid var(--line); border-radius: 6px; background: transparent; color: var(--ink); }
@media (max-width: 760px) { body { grid-template-columns: 1fr; height: auto; } nav { border-right: 0; border-bottom: 1px solid var(--line); max-height: 40vh; } main { padding: 16px; } }
</style></head>
<body><nav><h1 id="progress"></h1><div id="list"></div></nav><main id="main"></main>
<script>
const { queue, checks } = ${data};
let index = 0;
try { index = Math.min(Number(localStorage.getItem('check-index')) || 0, queue.length - 1); } catch {}
const checkOf = (fact) => checks.find((c) => c.fact === fact.id);
const MARK = { supported: '✓', unsupported: '✗' };

function renderList() {
  const done = queue.filter((f) => checkOf(f)?.verdict).length;
  document.getElementById('progress').textContent = done + ' / ' + queue.length + ' 条已核对';
  document.getElementById('list').replaceChildren(...queue.map((f, i) => {
    const b = document.createElement('button');
    const verdict = checkOf(f)?.verdict;
    b.setAttribute('aria-current', String(i === index));
    if (verdict) b.className = verdict;
    b.innerHTML = '<span></span><span class="mark"></span>';
    b.children[0].textContent = f.id;
    b.children[1].textContent = verdict ? MARK[verdict] : checkOf(f)?.note ? '?' : '';
    b.onclick = () => go(i);
    return b;
  }));
}

function renderFact() {
  const f = queue[index];
  const main = document.getElementById('main');
  main.innerHTML = '<header><h2></h2><button id="prev">← 上一条</button><button id="next">下一条 →</button></header>'
    + '<section id="sources"><h3>来源（点开看）</h3></section><section id="cites"><h3></h3></section>'
    + '<section id="ask"><h3></h3><div class="row"></div></section>';
  main.querySelector('h2').textContent = f.claim;
  main.querySelector('#ask h3').textContent = '来源是否支持这条事实：“' + f.claim + '”';
  main.querySelector('#prev').onclick = () => go(index - 1);
  main.querySelector('#next').onclick = () => go(index + 1);
  if (f.note) {
    const note = document.createElement('section');
    note.className = 'note';
    note.innerHTML = '<p></p>';
    note.querySelector('p').textContent = f.note;
    main.querySelector('header').after(note);
  }
  main.querySelector('#sources').append(...f.sources.map((s) => {
    const div = document.createElement('div');
    div.className = 'source';
    div.innerHTML = '<a target="_blank" rel="noopener noreferrer"></a><div></div>';
    div.querySelector('a').href = s.url;
    div.querySelector('a').textContent = s.url;
    div.querySelector('div').textContent = '看哪里：' + s.look;
    return div;
  }));
  main.querySelector('#cites h3').textContent = '依赖这条事实的判定（' + f.cites.length + '）';
  main.querySelector('#cites').append(...f.cites.map((c) => {
    const div = document.createElement('div');
    div.className = 'cite';
    div.innerHTML = '<b></b> <span></span><div></div>';
    div.querySelector('b').textContent = c.trial.replace(/^.*-([ab]_\\d+)$/, '$1') + ' · ' + c.id.replace(/^l3-/, '') + ' · ' + c.criterion;
    div.querySelector('span').textContent = c.verdict;
    div.querySelector('span').className = c.verdict;
    div.querySelector('div').textContent = c.reason;
    return div;
  }));
  const row = main.querySelector('.row');
  const note = document.createElement('input');
  note.placeholder = '备注（只写备注不选，算未决定）';
  note.value = checkOf(f)?.note ?? '';
  const buttons = [['supported', '支持'], ['unsupported', '不支持']].map(([v, text]) => {
    const b = document.createElement('button');
    b.dataset.v = v;
    b.textContent = text;
    b.onclick = () => send(f, checkOf(f)?.verdict === v ? null : v, note.value, buttons);
    return b;
  });
  note.onchange = () => send(f, checkOf(f)?.verdict ?? null, note.value, buttons);
  press(buttons, checkOf(f)?.verdict);
  row.replaceChildren(...buttons, note);
  main.scrollTop = 0;
}

const press = (buttons, verdict) => buttons.forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.v === verdict)));

async function send(f, verdict, note, buttons) {
  const res = await fetch('/check', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ fact: f.id, verdict, note }) });
  if (!res.ok) { document.querySelector('header h2').textContent = '没保存上（HTTP ' + res.status + '），刷新后再试'; return; }
  const rest = checks.filter((c) => c.fact !== f.id);
  checks.splice(0, checks.length, ...rest, ...verdict || note ? [{ fact: f.id, verdict, ...note ? { note } : {} }] : []);
  press(buttons, verdict);
  renderList();
}

function go(i) {
  if (i < 0 || i >= queue.length) return;
  index = i;
  try { localStorage.setItem('check-index', String(i)); } catch {}
  renderList();
  renderFact();
}
go(index);
</script></body></html>`;
}
