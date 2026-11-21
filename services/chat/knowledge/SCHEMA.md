# Maintaining the travel wiki

Pages are English Markdown with YAML frontmatter. Use an English `title`, Chinese and Japanese `names` (`zh`, `ja`), optional `aliases` (defaults to an empty list), a `type` and an ISO `updated` date. Only a place can have an optional Google `placeId`. Store only the confirmed ID. Names and aliases must be unique across pages after normalization.

A city lists areas and topics, or links directly to places. An area groups nearby sights and suggests how to combine them. A place describes a visit. A topic covers a planning question. A curated page holds human selections. Maintainers may link to curated pages and leave their content to the editor.

Use the path under `wiki/` without the extension as the page ID. Link with `[[kyoto/kiyomizu-dera]]`, including across directories. List every city in `index.md`. Every page except the index and maintenance log needs an incoming link from another page and a path from its city's directory.

Use short editorial sections such as “Worth seeing” and “When to go” as needed. Visit lengths are approximate planning estimates. Keep concrete claims about opening hours, closures, prices, works and rail access under `## Practical`. Use one single-line bullet per fact, ending with a named reference. Copy the official quotation verbatim, up to 300 characters. Use this exact definition format:

```markdown
## Practical
- State the sourced fact here.[^hours]

[^hours]: https://example.org/visit · checked 2026-11-21 · "Exact source text"
```

Keep clock times, prices and ISO dates out of editorial sections. Use a written date for log entries. For static transport coverage describe modes, omitting journey times, line names and transfers. The rendered title, names and body together must fit in 1,800 characters. Split longer pages and link the parts.

## Ingest

1. Fetch the official source and save its full text locally in `raw/<sha256>`, using the hexadecimal SHA-256 of the cached content. Register its URL, fetch date, hash and citing page IDs in `sources.json`. Imported sources awaiting their first fetch have null dates and hashes.
2. Write or update every affected place page. Match each practical bullet to its source and preserve the scope and effective period.
3. Update affected areas, topics and city directories with links.
4. Append a dated line to `wiki/log.md` describing the change and affected pages.
5. Run `bun run wiki:check` in services/chat and resolve all failures before review.

## Lint

1. Run the checker. Review links, coverage, duplicate names, citation syntax, cached quotations and stale checks.
2. Read related pages together for contradictions, superseded claims, missing cross-links and material that deserves a separate page.
3. Update affected pages and the manifest, append a log entry and rerun the checker. Submit the diff for human review.

## Weekly refresh

1. Run lint and select the ten pages with the oldest footnote checks. Checks older than 180 days produce warnings.
2. Re-fetch their sources, refresh the local cache and manifest, and compare the quoted text and claims against the current sources.
3. Update the facts, quotes and check dates after verifying them. Follow ingest for related pages, links and the log. Run the checker with the cache present and send the diff for review.

The chat service only reads the published wiki. Use wiki_miss logs to find navigation gaps. Keep full source text local.
