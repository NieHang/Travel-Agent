'use client'

import type {
  Message,
  Requirement,
  UIResponse,
  ComponentInteractionState,
  UIAction,
} from '@autix/contracts'
import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  type ReactNode,
  type RefObject,
} from 'react'
import { useTranslations } from 'next-intl'
import { PillButton } from '@/components/ui/PillButton'
import { Skeleton } from '@/components/ui/Skeleton'
import { MessageBubble } from './MessageBubble'

export type PendingReply = {
  text: string
  requirements: Requirement[]
  components?: UIResponse[]
  interactionState?: ComponentInteractionState
}

export function SkeletonBubbles({ count }: { count: number }) {
  return (
    <div
      aria-hidden
      data-testid="skeleton-bubbles"
      className="flex flex-col gap-3"
    >
      {Array.from({ length: count }, (_, i) => (
        <Skeleton
          key={i}
          className={`h-14 rounded-card! ${i % 2 === 0 ? 'w-3/5 self-start' : 'w-2/5 self-end'}`}
        />
      ))}
    </div>
  )
}

/**
 * 助手回复与它所回应的那条用户消息共用一个 key：流式气泡被缓存里的消息
 * （先是本地消息，刷新后是服务端消息）替换时是同一个 DOM 节点，不重播入场动画。
 */
function replyKeys(messages: Message[]): {
  keys: string[]
  pendingKey: string
} {
  const keys: string[] = []
  const used = new Set<string>()
  let lastUserId: string | null = null
  for (const message of messages) {
    let key = `m:${message.id}`
    if (message.role === 'USER') {
      lastUserId = message.id
    } else if (lastUserId && !used.has(`reply:${lastUserId}`)) {
      key = `reply:${lastUserId}`
    }
    used.add(key)
    keys.push(key)
  }
  const last = messages.at(-1)
  return {
    keys,
    pendingKey: last?.role === 'USER' ? `reply:${last.id}` : 'reply:pending',
  }
}

export function MessageList({
  scrollRef,
  messages,
  pending,
  hasMore,
  loadingMore,
  loadMoreFailed,
  onLoadMore,
  children,
  onAction,
  generating = false,
  activeSourceMessageId,
}: {
  scrollRef: RefObject<HTMLDivElement | null>
  /** 时间正序 */
  messages: Message[]
  /** 正在生成的回复；null 表示没有 */
  pending: PendingReply | null
  hasMore: boolean
  loadingMore: boolean
  /** 加载更早的消息失败：不再自动重试，改为显示重试按钮 */
  loadMoreFailed: boolean
  onLoadMore(): void
  /** 没有消息时的内容（问候、骨架、错误状态） */
  children?: ReactNode
  generating?: boolean
  activeSourceMessageId?: string | null
  onAction?: (
    sourceMessageId: string,
    revision: number,
    action: UIAction,
  ) => void
}) {
  const tc = useTranslations('common')
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
    if (!root || !target || !hasMore || loadingMore || loadMoreFailed) return
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
  }, [hasMore, loadingMore, loadMoreFailed, scrollRef])

  const retryLoadMore = () => {
    const el = scrollRef.current
    if (el) heightBeforeLoad.current = el.scrollHeight
    sawLoading.current = false
    loadMore.current()
  }
  const { keys, pendingKey } = replyKeys(messages)
  // 流式气泡与消息在同一个数组里，key 相同时才会被 React 当作同一个节点
  const current =
    activeSourceMessageId !== undefined
      ? activeSourceMessageId
      : [...messages]
          .reverse()
          .find((m) => m.status === 'complete' && m.metadata?.interactionState)
          ?.id
  const historyBubbles = useMemo(
    () =>
      messages.map((message, index) => (
        <MessageBubble
          key={keys[index]}
          role={message.role}
          content={message.content}
          status={message.status}
          requirements={message.metadata?.requirements}
          components={message.metadata?.components}
          disabled={generating || message.id !== current}
          onAction={
            onAction && message.metadata?.interactionState
              ? (action) =>
                  onAction(
                    message.id,
                    message.metadata!.interactionState!.revision,
                    action,
                  )
              : undefined
          }
        />
      )),
    [messages, current, generating, onAction],
  )
  const bubbles = [...historyBubbles]
  if (
    pending &&
    !messages.some(
      (message) => message.id === pending.interactionState?.sourceMessageId,
    )
  ) {
    bubbles.push(
      <MessageBubble
        key={pendingKey}
        role="ASSISTANT"
        content={pending.text}
        typing={pending.text === ''}
        requirements={pending.requirements}
        components={pending.components}
        disabled
      />,
    )
  }

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
        {loadMoreFailed && !loadingMore ? (
          <div className="flex items-center justify-center gap-3">
            <span className="text-sm font-bold text-ink">
              {tc('loadFailed')}
            </span>
            <PillButton variant="ink" size="sm" onClick={retryLoadMore}>
              {tc('retry')}
            </PillButton>
          </div>
        ) : null}
        {messages.length === 0 && !pending ? children : null}
        {bubbles}
      </div>
    </div>
  )
}
