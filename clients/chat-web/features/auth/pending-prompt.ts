import { useEffect, useRef } from 'react'

export const PENDING_KEY = 'hilda:pendingPrompt'
export const PENDING_PREVIEW_CHARS = 40

export type PendingPrompt = { prompt: string; conversationId?: string }

function parse(raw: string | null): PendingPrompt | null {
  if (!raw) return null
  try {
    const value: unknown = JSON.parse(raw)
    if (typeof value !== 'object' || value === null) return null
    const { prompt, conversationId } = value as Record<string, unknown>
    if (typeof prompt !== 'string') return null
    if (conversationId !== undefined && typeof conversationId !== 'string') return null
    return conversationId === undefined ? { prompt } : { prompt, conversationId }
  } catch {
    return null
  }
}

export function savePendingPrompt(p: PendingPrompt): void {
  try {
    sessionStorage.setItem(PENDING_KEY, JSON.stringify(p))
  } catch {
    // 存储不可用：落地页输入不暂存，登录流程照常
  }
}

export function peekPendingPrompt(): PendingPrompt | null {
  try {
    return parse(sessionStorage.getItem(PENDING_KEY))
  } catch {
    return null
  }
}

export function takePendingPrompt(): PendingPrompt | null {
  const value = peekPendingPrompt()
  try {
    sessionStorage.removeItem(PENDING_KEY)
  } catch {
    // 同上
  }
  return value
}

/** 按字符截到 40 个，超出加省略号。 */
export function truncatePrompt(prompt: string): string {
  const chars = Array.from(prompt)
  return chars.length > PENDING_PREVIEW_CHARS
    ? chars.slice(0, PENDING_PREVIEW_CHARS).join('') + '…'
    : prompt
}

/**
 * 挂载后把暂存内容交给 onReady 恰好一次。先清后发：读出时即清除存储，
 * 内容留在 ref 里，StrictMode 的模拟重挂载不会再读一次，刷新页面也不会重复。
 */
export function usePendingPrompt(
  enabled: boolean,
  onReady: (p: PendingPrompt) => void,
): void {
  const taken = useRef<PendingPrompt | null>(null)
  const callback = useRef(onReady)
  useEffect(() => {
    callback.current = onReady
  })

  useEffect(() => {
    if (!enabled) return
    taken.current ??= takePendingPrompt()
    if (!taken.current) return
    const timer = setTimeout(() => {
      const value = taken.current
      taken.current = null
      if (value) callback.current(value)
    }, 0)
    return () => clearTimeout(timer)
  }, [enabled])
}
