import { existsSync, readFileSync } from 'node:fs';
import { z } from 'zod';
import { check, loadLibrary } from '../src/knowledge/index.js';

const errors: string[] = [];
const pages = loadLibrary(undefined, message => errors.push(message));
const manifest = z.array(z.object({
  url: z.string().url(), fetchedOn: z.string().date().nullable(),
  sha256: z.string().regex(/^[a-f0-9]{64}$/).nullable(), pages: z.array(z.string()),
})).parse(JSON.parse(readFileSync(new URL('../knowledge/sources.json', import.meta.url), 'utf8')));
const cache = new Map<string, string>();
for (const { url, sha256 } of manifest) {
  if (!sha256) continue;
  const path = new URL(`../knowledge/raw/${sha256}`, import.meta.url);
  if (existsSync(path)) cache.set(url, readFileSync(path, 'utf8'));
}
const { failures, warnings } = check([...pages.values()], new Date().toISOString().slice(0, 10), cache);
for (const warning of warnings) console.warn(warning);
for (const error of [...errors, ...failures]) console.error(error);
console.log(`${pages.size} wiki pages, ${errors.length + failures.length} failures, ${warnings.length} warnings`);
if (errors.length || failures.length) process.exitCode = 1;
