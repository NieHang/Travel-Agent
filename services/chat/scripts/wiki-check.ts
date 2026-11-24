import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { check, imageFile, loadLibrary } from '../src/knowledge/index.js';

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
const photos = new URL('../../../clients/chat-web/public/', import.meta.url);
for (const page of pages.values()) {
  if (page.image && !existsSync(new URL(imageFile(page.id), photos))) errors.push(`${page.id}: image file missing: ${imageFile(page.id)}`);
}
const registered = new Set([...pages.values()].filter(page => page.image).map(page => imageFile(page.id)));
const places = new URL('places/', photos);
if (existsSync(places)) {
  for (const file of readdirSync(places, { recursive: true, withFileTypes: true })) {
    if (!file.isFile()) continue;
    const path = relative(fileURLToPath(photos), join(file.parentPath, file.name)).split(sep).join('/');
    if (!registered.has(path)) errors.push(`${path}: photo without an image entry on its wiki page`);
  }
}
const { failures, warnings } = check([...pages.values()], new Date().toISOString().slice(0, 10), cache);
for (const warning of warnings) console.warn(warning);
for (const error of [...errors, ...failures]) console.error(error);
console.log(`${pages.size} wiki pages, ${errors.length + failures.length} failures, ${warnings.length} warnings`);
if (errors.length || failures.length) process.exitCode = 1;
