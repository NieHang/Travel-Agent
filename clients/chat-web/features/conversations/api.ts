import type { Conversation, Message, Page } from '@autix/contracts'
import { api } from '@/features/auth/api-client'

function withQuery(path: string, params: Record<string, string | undefined>) {
  const search = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) {
    if (value) search.set(key, value)
  }
  const qs = search.toString()
  return qs ? `${path}?${qs}` : path
}

export function listConversations(p: {
  cursor?: string
  q?: string
}): Promise<Page<Conversation>> {
  return api(
    withQuery('/api/conversations', { cursor: p.cursor, q: p.q?.trim() }),
  )
}

export function createConversation(): Promise<Conversation> {
  return api('/api/conversations', { method: 'POST' })
}

export function renameConversation(
  id: string,
  title: string,
): Promise<Conversation> {
  return api(`/api/conversations/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: { title },
  })
}

export function deleteConversation(id: string): Promise<void> {
  return api(`/api/conversations/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  })
}

export function listMessages(
  id: string,
  p: { cursor?: string },
): Promise<Page<Message>> {
  return api(
    withQuery(`/api/conversations/${encodeURIComponent(id)}/messages`, {
      cursor: p.cursor,
    }),
  )
}
