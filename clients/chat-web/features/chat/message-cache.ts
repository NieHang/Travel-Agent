import type { Message, Page } from '@autix/contracts'
import type { InfiniteData, QueryClient } from '@tanstack/react-query'
import { messagesKey } from '@/features/conversations/queries'

type MessagePages = InfiniteData<Page<Message>>

/** 把消息放到缓存里最新的位置（pages[0].items 的开头，缓存为时间倒序）；已有同 id 则替换；缓存不存在时建一页。 */
export function upsertMessage(
  queryClient: QueryClient,
  conversationId: string,
  message: Message,
): void {
  queryClient.setQueryData<MessagePages>(messagesKey(conversationId), (data) => {
    if (!data || data.pages.length === 0) {
      return {
        pages: [{ items: [message], nextCursor: null }],
        pageParams: [undefined],
      }
    }
    const exists = data.pages.some((p) => p.items.some((m) => m.id === message.id))
    if (exists) {
      return {
        ...data,
        pages: data.pages.map((p) => ({
          ...p,
          items: p.items.map((m) => (m.id === message.id ? message : m)),
        })),
      }
    }
    const [first, ...rest] = data.pages
    return { ...data, pages: [{ ...first, items: [message, ...first.items] }, ...rest] }
  })
}
