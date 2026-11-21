import { posix } from 'node:path';
import { Logger } from '@nestjs/common';
import { tool, type StructuredToolInterface } from '@langchain/core/tools';
import type { TraceVerification } from '@autix/contracts';
import { z } from 'zod';
import type { WikiPage } from './page.js';

export const READ_WIKI = 'read_wiki';
export type WikiPageRef = TraceVerification['reading'][number];

export class WikiRead {
  constructor(readonly content: string, readonly pages: WikiPageRef[]) {}
}

const logger = new Logger('Wiki');

export function readWikiTool(library: ReadonlyMap<string, WikiPage>, locale: 'zh' | 'en'): StructuredToolInterface {
  return tool(async ({ pages }: { pages: string[] }) => {
    const reading: WikiPageRef[] = [];
    const sections = pages.map(id => {
      const page = library.get(id);
      if (page) {
        reading.push({ id, title: locale === 'zh' ? page.names.zh : page.title });
        return page.rendered;
      }
      logger.warn({ event: 'wiki_miss', id });
      const siblings = [...library.keys()].filter(key => posix.dirname(key) === posix.dirname(id));
      return `Unknown wiki page "${id}". Pages in this directory: ${siblings.join(', ') || '(none)'}`;
    });
    return new WikiRead(sections.join('\n\n'), reading);
  }, {
    name: READ_WIKI,
    description: 'Read city entries and linked wiki pages by ID. Request the pages needed for this round together.',
    schema: z.object({ pages: z.array(z.string()).min(1).max(6) }),
  });
}
