import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { loadLibrary } from './library.js';
import { check } from './check.js';

it('indexes valid files by path and reports skipped pages', () => {
  const dir = mkdtempSync(join(tmpdir(), 'wiki-'));
  try {
    writeFileSync(join(dir, 'bad.md'), 'no header');
    writeFileSync(join(dir, 'good.md'), '---\ntitle: Guide\nnames: {zh: 指南, ja: 案内}\ntype: topic\nupdated: 2026-11-21\n---\nBody');
    const errors: string[] = [];
    const pages = loadLibrary(dir, error => errors.push(error));
    expect([...pages.keys()]).toEqual(['good']);
    expect(pages.get('good')?.rendered).toContain('Body');
    expect(errors).toEqual([expect.stringContaining('bad.md')]);
  } finally {
    rmSync(dir, { recursive: true });
  }
});

it('checks the shipped library', () => {
  const errors: string[] = [];
  const pages = loadLibrary(undefined, error => errors.push(error));
  expect(errors).toEqual([]);
  expect([...pages.values()].filter(page => page.type === 'city').map(page => page.id)).toEqual(['kyoto', 'nara', 'osaka', 'tokyo']);
  expect(check([...pages.values()], '2026-11-21').failures).toEqual([]);
});
