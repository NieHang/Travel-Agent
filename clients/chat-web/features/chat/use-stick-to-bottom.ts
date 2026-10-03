'use client'

import { useCallback, useLayoutEffect, useEffect, useRef, useState, type RefObject } from 'react'

export const BOTTOM_THRESHOLD_PX = 80

export function isNearBottom(el: {
  scrollTop: number
  scrollHeight: number
  clientHeight: number
}): boolean {
  return el.scrollHeight - el.scrollTop - el.clientHeight <= BOTTOM_THRESHOLD_PX
}

/**
 * 在底部时，dep 变化后把滚动容器贴到底；用户向上滚动后停止跟随，直到回到底部或调用 scrollToBottom。
 * resetKey 变化（切换会话）时恢复跟随。
 */
export function useStickToBottom(
  dep: unknown,
  resetKey?: unknown,
): { ref: RefObject<HTMLDivElement | null>; atBottom: boolean; scrollToBottom(): void } {
  const ref = useRef<HTMLDivElement | null>(null)
  const stick = useRef(true)
  const lastReset = useRef(resetKey)
  const [atBottom, setAtBottom] = useState(true)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    const onScroll = () => {
      const near = isNearBottom(el)
      stick.current = near
      setAtBottom(near)
    }
    el.addEventListener('scroll', onScroll, { passive: true })
    return () => el.removeEventListener('scroll', onScroll)
  }, [])

  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    if (lastReset.current !== resetKey) {
      lastReset.current = resetKey
      stick.current = true
    }
    if (stick.current) el.scrollTop = el.scrollHeight
  }, [dep, resetKey])

  const scrollToBottom = useCallback(() => {
    const el = ref.current
    if (!el) return
    stick.current = true
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    el.scrollTo({ top: el.scrollHeight, behavior: reduced ? 'auto' : 'smooth' })
  }, [])

  return { ref, atBottom, scrollToBottom }
}
