import type {
  ChatStreamEvent,
  Conversation,
  Message,
  User,
} from '@autix/contracts'

const NOW = '2026-10-03T08:00:00.000Z'

export function makeUser(over: Partial<User> = {}): User {
  return {
    id: 'user_1',
    email: 'hilda@example.com',
    nickname: 'Hilda',
    locale: 'zh',
    createdAt: NOW,
    ...over,
  }
}

export function makeConversation(over: Partial<Conversation> = {}): Conversation {
  return {
    id: 'conv_1',
    title: 'Trip to Kyoto',
    createdAt: NOW,
    updatedAt: NOW,
    ...over,
  }
}

export function makeMessage(over: Partial<Message> = {}): Message {
  return {
    id: 'msg_1',
    conversationId: 'conv_1',
    role: 'USER',
    content: 'hello',
    status: 'complete',
    metadata: null,
    createdAt: NOW,
    ...over,
  }
}

export function sseBody(
  events: ChatStreamEvent[],
  opts: { chunkBytes?: number; close?: boolean } = {},
): ReadableStream<Uint8Array> {
  const bytes = new TextEncoder().encode(
    events.map((e) => `event: ${e.event}\ndata: ${JSON.stringify(e.data)}\n\n`).join(''),
  )
  const size = opts.chunkBytes && opts.chunkBytes > 0 ? opts.chunkBytes : bytes.length
  const close = opts.close ?? true
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (let i = 0; i < bytes.length; i += size) {
        controller.enqueue(bytes.slice(i, i + size))
      }
      if (close) controller.close()
    },
  })
}
