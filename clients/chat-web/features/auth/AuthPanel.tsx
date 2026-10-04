'use client'

import { useReducedMotion } from '@/lib/use-reduced-motion'

import { AlertCircle } from 'lucide-react'
import {
  motion,
  useAnimate,
  type MotionProps,
} from 'motion/react'
import { useTranslations } from 'next-intl'
import { useEffect, type ReactNode } from 'react'
import { enter, springs } from '@/lib/motion'
import { truncatePrompt, type PendingPrompt } from './pending-prompt'

const SHAKE_OFFSET = 10

/** ink 色面板：440px，窄屏占满；gentle 入场；shakeKey 变化时水平晃动一次（减弱动效时跳过）。 */
export function AuthPanel({
  shakeKey = 0,
  children,
}: {
  shakeKey?: number
  children: ReactNode
}) {
  const reduced = useReducedMotion()
  const [scope, animate] = useAnimate<HTMLDivElement>()

  useEffect(() => {
    if (shakeKey === 0 || reduced) return
    let cancelled = false
    void (async () => {
      const el = scope.current
      if (!el) return
      await animate(el, { x: -SHAKE_OFFSET }, springs.snappy)
      if (cancelled) return
      await animate(el, { x: SHAKE_OFFSET }, springs.snappy)
      if (cancelled) return
      await animate(el, { x: 0 }, springs.snappy)
    })()
    return () => {
      cancelled = true
    }
  }, [shakeKey, reduced, animate, scope])

  return (
    <motion.div {...(enter(0, Boolean(reduced)) as MotionProps)} className="w-full max-w-110">
      <div
        ref={scope}
        data-on-ink
        className="rounded-panel bg-ink p-6 text-white shadow-float sm:p-10"
      >
        {children}
      </div>
    </motion.div>
  )
}

/** A6：表单级错误。 */
export function FormError({ children }: { children: ReactNode }) {
  return (
    <p role="alert" className="flex items-center gap-2 text-sm font-bold text-white">
      <AlertCircle aria-hidden className="size-4 shrink-0 text-danger" />
      <span>{children}</span>
    </p>
  )
}

/** 标题下方的提示：因 REFRESH_REUSED 登出，或暂存的落地页输入。 */
export function PanelNotices({
  pending,
  sessionEnded,
}: {
  pending: PendingPrompt | null
  sessionEnded: boolean
}) {
  const t = useTranslations()
  return (
    <>
      {sessionEnded ? (
        <p className="text-sm text-white">{t('errors.sessionEnded')}</p>
      ) : null}
      {pending ? (
        <p className="text-sm text-white">
          {t('auth.pendingHint', { prompt: truncatePrompt(pending.prompt) })}
        </p>
      ) : null}
    </>
  )
}
