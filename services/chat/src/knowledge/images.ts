import { nameKey, pageNames, type WikiPage } from './page.js';

/** A page's photo, as a path under clients/chat-web/public. */
export const imageFile = (pageId: string) => `places/${pageId}.webp`;

/** Finds the photo of the wiki page a stop is named after, as the URL path the web app serves it at. */
export function imageLookup(pages: Iterable<WikiPage>): (name: string) => string | null {
  const byName = new Map<string, string>();
  for (const page of pages) {
    if (!page.image) continue;
    for (const name of pageNames(page)) byName.set(nameKey(name), `/${imageFile(page.id)}`);
  }
  return (name) => byName.get(nameKey(name)) ?? null;
}
