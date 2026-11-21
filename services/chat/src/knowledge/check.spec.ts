import { expect, it } from 'vitest';
import { check } from './check.js';
import { parsePage } from './page.js';

function fixture(id: string, body: string) {
  return parsePage(id, `---
title: ${id}
names: { zh: ${id}, ja: ${id} }
type: ${id === 'kyoto' ? 'city' : 'topic'}
updated: 2026-11-21
---
${body}`);
}

const url = 'https://example.org/visit';
it('reports broken navigation, including an isolated cycle outside the city directory listing', () => {
  const pages = [fixture('index', '[[kyoto]]'), fixture('kyoto', '[[missing]]'), fixture('kyoto/a', '[[kyoto/b]]'), fixture('kyoto/b', '[[kyoto/a]]'), fixture('kyoto/c', '')];
  expect(check(pages, '2026-11-21').failures).toEqual([
    'kyoto: unresolved link missing', 'kyoto/a: unreachable from kyoto', 'kyoto/b: unreachable from kyoto',
    'kyoto/c: orphan', 'kyoto/c: unreachable from kyoto',
  ]);
});

it('checks editorial facts, citations, cached quotations and staleness independently', () => {
  const page = fixture('index', `Open 09:00\n## Practical\n- Open daily.[^hours]\n- Uncited\n[^hours]: ${url} · checked 2026-01-01 · "daily"`);
  expect(check([page], '2026-11-21', new Map([[url, 'weekends']]))).toEqual({
    failures: ['index: time, price or date outside Practical', 'index: invalid Practical bullet: - Uncited', 'index: quote missing from cache: hours'],
    warnings: ['index: hours checked 2026-01-01'],
  });
});

it.each(['Admission ¥500', 'Admission 500 yen', 'Admission JPY 500', 'Reopens 2026-12-02'])('flags editorial claim %s', body => {
  expect(check([fixture('index', body)], '2026-11-21').failures).toEqual(['index: time, price or date outside Practical']);
});

it('rejects malformed definitions and unresolved citations', () => {
  const page = fixture('index', '## Practical\n- Open daily.[^hours]\n[^hours]: http://example.org · checked 2026-11-21 · "daily"');
  expect(check([page], '2026-11-21').failures).toEqual([
    'index: invalid footnote: [^hours]: http://example.org · checked 2026-11-21 · "daily"', 'index: undefined footnote: hours',
  ]);
});

it('counts the rendered heading and normalizes aliases across pages', () => {
  const page = fixture('log', 'x'.repeat(1800));
  page.aliases.push('ＩＮ-ＤＥＸ');
  expect(check([fixture('index', ''), page], '2026-11-21').failures).toEqual([
    'log: rendered page exceeds 1800 characters', 'log: alias "ＩＮ-ＤＥＸ" also names index',
  ]);
});
