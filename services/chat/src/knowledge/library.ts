import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Logger } from '@nestjs/common';
import { parsePage, type WikiPage } from './page.js';

const root = fileURLToPath(new URL('../../knowledge/wiki/', import.meta.url));
const logger = new Logger('Wiki');

export function loadLibrary(dir = root, onError = (message: string) => logger.warn(message)) {
  const pages = new Map<string, WikiPage>();
  for (const file of readdirSync(dir, { recursive: true, withFileTypes: true })) {
    if (!file.isFile() || !file.name.endsWith('.md')) continue;
    const path = join(file.parentPath, file.name);
    const id = relative(dir, path).split(sep).join('/').slice(0, -3);
    try {
      pages.set(id, parsePage(id, readFileSync(path, 'utf8')));
    } catch (error) {
      onError(`Skipping ${path}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return new Map([...pages].sort(([a], [b]) => a.localeCompare(b)));
}
