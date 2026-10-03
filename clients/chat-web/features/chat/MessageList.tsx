'use client'

import type { Message, Requirement } from '@autix/contracts'
import { useEffect, useLayoutEffect, useRef, type ReactNode, type RefObject } from 'react'
import { Skeleton } from '@/components/ui/Skeleton'
import { MessageBubble } from './MessageBubble'

export type PendingReply = { text: string; requirements: Requirement[] }

export function SkeletonBubbles({ count }: { count: number }) {
  return (
    <div aria-hidden data-testid="skeleton-bubbles" className="flex flex-col gap-3">
      {Array.from({ length: count }, (_, i) => (
        <Skeleton
          key={i}
          className={`h-14 rounded-card! ${i % 2 === 0 ? 'w-3/5 self-start' : 'w-2/5 self-end'}`}
        />
      ))}
    </div>
  )
}

export function MessageList({
  scrollRef,
  messages,
  pending,
  hasMore,
  loadingMore,
  onLoadMore,
  children,
}: {
  scrollRef: RefObject<HTMLDivElement | null>
  /** 时间正序 */
  messages: Message[]
  /** 正在生成的回复；null 表示没有 */
  pending: PendingReply | null
  hasMore: boolean
  loadingMore: boolean
  onLoadMore(): void
  /** 没有消息时的内容（问候、骨架、错误状态） */
  children?: ReactNode
}) {
  const sentinel = useRef<HTMLDivElement>(null)
  const heightBeforeLoad = useRef<number | null>(null)
  const sawLoading = useRef(false)
  const loadMore = useRef(onLoadMore)
  useEffect(() => {
    loadMore.current = onLoadMore
  })
  // 加载更早的消息：记下加载前的 scrollHeight，加载后补上增加的高度
  useLayoutEffect(() => {
    if (loadingMore) {
      sawLoading.current = true
      return
    }
    const el = scrollRef.current
    if (!el || heightBeforeLoad.current === null || !sawLoading.current) return
    el.scrollTop += el.scrollHeight - heightBeforeLoad.current
    heightBeforeLoad.current = null
  }, [loadingMore, messages, scrollRef])

  // 每次加载结束都重建观察者：哨兵仍然可见时会立即再触发一次
  useEffect(() => {
    const root = scrollRef.current
    const target = sentinel.current
    if (!root || !target || !hasMore || loadingMore) return
    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) return
        heightBeforeLoad.current = root.scrollHeight
        sawLoading.current = false
        loadMore.current()
      },
      { root, rootMargin: '120px 0px 0px 0px' },
    )
    observer.observe(target)
    return () => observer.disconnect()
  }, [hasMore, loadingMore, scrollRef])

  return (
    <div
      ref={scrollRef}
      data-testid="message-scroll"
      style={{ overflowAnchor: 'none' }}
      className="min-h-0 flex-1 overflow-y-auto px-4"
    >
      <div className="flex min-h-full flex-col gap-3 py-4">
        <div ref={sentinel} aria-hidden className="h-px shrink-0" />
        {loadingMore ? <SkeletonBubbles count={1} /> : null}
        {messages.length === 0 && !pending ? children : null}
        {messages.map((message) => (
          <MessageBubble
            key={message.id}
            role={message.role}
            content={message.content}
            status={message.status}
            requirements={message.metadata?.requirements}
          />
        ))}
        {pending ? (
          <MessageBubble
            role="ASSISTANT"
            content={pending.text}
            typing={pending.text === ''}
            requirements={pending.requirements}
          />
        ) : null}
      </div>
    </div>
  )
}
