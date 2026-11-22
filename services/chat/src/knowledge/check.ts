import { z } from 'zod';
import type { WikiPage } from './page.js';

const definition = /^\[\^([\w-]+)\]: (https:\/\/[^\s<>]+) · checked (\d{4}-\d{2}-\d{2}) · "(.{1,300})"$/u;
const concrete = /\d{1,2}:\d{2}|\d{4}-\d{2}-\d{2}|\p{Sc}\s*\d|\b(?:JPY|USD|EUR|GBP|CNY|yen)\s*\d|\d[\d,.]*\s*(?:\p{Sc}|円|元|yen\b|dollars?\b|euros?\b|JPY\b|USD\b|EUR\b|GBP\b|CNY\b)/iu;

export function check(pages: WikiPage[], today: string, cache: ReadonlyMap<string, string> = new Map()) {
  const failures: string[] = [];
  const warnings: string[] = [];
  const byId = new Map(pages.map(page => [page.id, page]));
  const incoming = new Set(pages.flatMap(page => page.links.filter(link => link !== page.id)));
  const reachable = reachableFromCities(pages, byId, failures);
  const aliases = new Map<string, string>();
  for (const page of pages) {
    const fail = (message: string) => failures.push(`${page.id}: ${message}`);
    for (const link of page.links) if (!byId.has(link)) fail('unresolved link ' + link);
    if (page.id !== 'index' && page.id !== 'log') {
      if (!incoming.has(page.id)) fail('orphan');
      if (!reachable.has(page.id)) fail('unreachable from ' + page.id.split('/')[0]);
    }
    // The log is append-only, so it outgrows the limit that keeps reading pages short.
    if (page.id !== 'log' && page.rendered.length > 1800) fail('rendered page exceeds 1800 characters');
    if ([page.title, page.names.zh, page.names.ja].some(value => concrete.test(value))) fail('time, price or date outside Practical');
    for (const alias of [page.title, page.names.zh, page.names.ja, ...page.aliases]) {
      const key = alias.normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
      const previous = aliases.get(key);
      if (previous && previous !== page.id) fail(`alias "${alias}" also names ${previous}`);
      aliases.set(key, page.id);
    }
    checkBody(page, today, cache, fail, message => warnings.push(`${page.id}: ${message}`));
  }
  return { failures, warnings };
}

function reachableFromCities(pages: WikiPage[], byId: ReadonlyMap<string, WikiPage>, failures: string[]) {
  const cities = pages.filter(page => page.type === 'city');
  const reachable = new Set<string>();
  for (const city of cities) {
    const pending = [city.id];
    while (pending.length) {
      const id = pending.pop()!;
      if (reachable.has(id)) continue;
      reachable.add(id);
      pending.push(...(byId.get(id)?.links ?? []).filter(link => link.startsWith(city.id + '/')));
    }
    if (!byId.get('index')?.links.includes(city.id)) failures.push(`${city.id}: missing from index`);
  }
  return reachable;
}

function checkBody(page: WikiPage, today: string, cache: ReadonlyMap<string, string>, fail: (message: string) => void, warn: (message: string) => void) {
  const notes = new Set<string>();
  const references = new Set<string>();
  let practical = false;
  for (const line of page.body.split(/\r?\n/).map(value => value.trim()).filter(Boolean)) {
    if (line.startsWith('[^')) {
      const match = definition.exec(line);
      if (!match || !URL.canParse(match[2]) || !z.string().date().safeParse(match[3]).success) {
        fail('invalid footnote: ' + line);
        continue;
      }
      const [, label, url, date, quote] = match;
      if (notes.has(label)) fail('duplicate footnote: ' + label);
      notes.add(label);
      const cached = cache.get(url);
      if (cached !== undefined && !cached.includes(quote)) fail('quote missing from cache: ' + label);
      if (Date.parse(today) - Date.parse(date) > 180 * 86400000) warn(`${label} checked ${date}`);
      continue;
    }
    if (/^#{1,6}\s/.test(line)) practical = line === '## Practical';
    if (line === '## Practical') continue;
    if (!practical) {
      if (concrete.test(line)) fail('time, price or date outside Practical');
      continue;
    }
    const bullet = /^- .+\[\^([\w-]+)\]$/.exec(line);
    if (bullet) references.add(bullet[1]);
    else fail('invalid Practical bullet: ' + line);
  }
  for (const label of references) if (!notes.has(label)) fail('undefined footnote: ' + label);
}
