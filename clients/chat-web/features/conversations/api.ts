import {
  ConversationSchema,
  MessageSchema,
  pageSchema,
  type Conversation,
  type Message,
  type Page,
} from '@autix/contracts'
import { api, apiFetch } from '@/features/auth/api-client'

const ConversationPageSchema = pageSchema(ConversationSchema)
const MessagePageSchema = pageSchema(MessageSchema)

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
    ConversationPageSchema,
  )
}

export function createConversation(): Promise<Conversation> {
  return api('/api/conversations', ConversationSchema, { method: 'POST' })
}

export function renameConversation(
  id: string,
  title: string,
): Promise<Conversation> {
  return api(`/api/conversations/${encodeURIComponent(id)}`, ConversationSchema, {
    method: 'PATCH',
    body: { title },
  })
}

export async function deleteConversation(id: string): Promise<void> {
  await apiFetch(`/api/conversations/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  })
}

export function listMessages(
  id: string,
  p: { cursor?: string },
  signal?: AbortSignal,
): Promise<Page<Message>> {
  return api(
    withQuery(`/api/conversations/${encodeURIComponent(id)}/messages`, {
      cursor: p.cursor,
    }),
    MessagePageSchema,
    { signal },
  )
}
