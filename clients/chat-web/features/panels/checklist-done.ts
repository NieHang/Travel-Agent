import { useMemo, useSyncExternalStore } from 'react'

const PREFIX = 'hilda:checklist:'
/** The JSON list of ticked titles per conversation; it also keeps ticks for the session when storage is unavailable. */
const cache = new Map<string, string>()
const listeners = new Set<() => void>()

function read(conversationId: string): string {
  const cached = cache.get(conversationId)
  if (cached !== undefined) return cached
  const stored = loadStored(conversationId)
  cache.set(conversationId, stored)
  return stored
}

function loadStored(conversationId: string): string {
  try {
    return localStorage.getItem(PREFIX + conversationId) ?? '[]'
  } catch {
    return '[]'
  }
}

function write(conversationId: string, titles: string[]) {
  const raw = JSON.stringify(titles)
  cache.set(conversationId, raw)
  try {
    localStorage.setItem(PREFIX + conversationId, raw)
  } catch {
    // Storage is blocked or full: the cache keeps the ticks until the page reloads.
  }
  for (const listener of listeners) listener()
}

function parseTitles(raw: string): string[] {
  try {
    const value: unknown = JSON.parse(raw)
    return Array.isArray(value) ? value.filter((title): title is string => typeof title === 'string') : []
  } catch {
    return []
  }
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/** Before-you-go items this viewer ticked, by title. They live in this browser only. */
export function useChecklistDone(conversationId: string): {
  done: ReadonlySet<string>
  toggle: (title: string) => void
} {
  // The snapshot is the raw string, so React sees an unchanged value until a write.
  const raw = useSyncExternalStore(subscribe, () => read(conversationId), () => '[]')
  const done = useMemo(() => new Set(parseTitles(raw)), [raw])
  const toggle = (title: string) => {
    const titles = parseTitles(read(conversationId))
    write(conversationId, titles.includes(title) ? titles.filter((t) => t !== title) : [...titles, title])
  }
  return { done, toggle }
}
