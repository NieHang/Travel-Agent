import { load } from 'js-yaml';
import { z } from 'zod';

const name = z.string().trim().min(1);
const fields = z.object({
  title: name, names: z.object({ zh: name, ja: name }), aliases: name.array().default([]), updated: z.string().date(),
  /** Where the page's photo came from; the file itself is clients/chat-web/public/places/<page id>.webp. */
  image: z.object({ source: z.string().url().optional(), credit: name }).strict().optional(),
});
const frontmatter = z.discriminatedUnion('type', [
  fields.extend({ type: z.literal('place'), placeId: name.optional() }).strict(),
  fields.extend({ type: z.enum(['city', 'area', 'topic', 'curated']) }).strict(),
]);

export function parsePage(id: string, text: string) {
  const header = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(text);
  if (!header) throw new Error('Missing wiki frontmatter');
  const meta = frontmatter.parse(load(header[1]));
  const body = text.slice(header[0].length).trim();
  const links = [...body.matchAll(/\[\[([^\]\n]+)\]\]/g)].map(match => match[1]);
  const rendered = `# ${meta.title} (${meta.names.zh} / ${meta.names.ja})\n${body}`;
  return { ...meta, id, body, links, rendered };
}

export type WikiPage = ReturnType<typeof parsePage>;

/** Every name a page answers to. */
export const pageNames = (page: WikiPage) => [page.title, page.names.zh, page.names.ja, ...page.aliases];

/** Names compare by letters and digits only, so "Tofuku-ji" and "tofukuji" are one name. */
export const nameKey = (value: string) => value.normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
