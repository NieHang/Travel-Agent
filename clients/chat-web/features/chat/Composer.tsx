'use client'

import { ArrowUp, Square } from 'lucide-react'
import { useTranslations } from 'next-intl'
import {
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  type KeyboardEvent,
  type Ref,
} from 'react'
import { PillButton } from '@/components/ui/PillButton'

export const INPUT_MAX_LENGTH = 4000
export const COUNTER_FROM = 3800
// 24px 行高 × 5 行 + 上下内边距各 12px
const MAX_HEIGHT_PX = 24 * 5 + 24

export function Composer({
  value,
  onChange,
  generating,
  rateLimitSeconds,
  onSend,
  onStop,
  ref,
}: {
  value: string
  onChange(v: string): void
  generating: boolean
  rateLimitSeconds: number
  onSend(): void
  onStop(): void
  ref?: Ref<HTMLTextAreaElement>
}) {
  const t = useTranslations('chat')
  const inner = useRef<HTMLTextAreaElement>(null)
  useImperativeHandle(ref, () => inner.current as HTMLTextAreaElement)

  useLayoutEffect(() => {
    const el = inner.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, MAX_HEIGHT_PX)}px`
  }, [value])

  const canSend = !generating && rateLimitSeconds <= 0 && value.trim() !== ''

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key !== 'Enter' || event.shiftKey) return
    // 输入法组字中的回车用来确认候选词
    if (event.nativeEvent.isComposing || event.keyCode === 229) return
    event.preventDefault()
    if (canSend) onSend()
  }

  return (
    <div className="flex flex-col gap-2">
      {rateLimitSeconds > 0 ? (
        <p role="status" className="px-4 text-sm font-bold text-ink">
          {t('rateLimited', { n: rateLimitSeconds })}
        </p>
      ) : null}
      <div
        data-on-ink
        className="relative flex items-end gap-2 rounded-card bg-ink p-2 pl-5 shadow-float"
      >
        <textarea
          ref={inner}
          rows={1}
          value={value}
          maxLength={INPUT_MAX_LENGTH}
          placeholder={t('placeholder')}
          aria-label={t('placeholder')}
          onChange={(event) => onChange(event.target.value)}
          onKeyDown={onKeyDown}
          style={{ maxHeight: MAX_HEIGHT_PX }}
          className="min-h-12 flex-1 resize-none self-center overflow-y-auto bg-transparent py-3 text-base leading-6 text-white outline-none placeholder:text-white/60"
        />
        {generating ? (
          <PillButton variant="lime" iconOnly aria-label={t('stop')} onClick={onStop}>
            <Square size={18} fill="currentColor" aria-hidden />
          </PillButton>
        ) : (
          <PillButton
            variant="lime"
            iconOnly
            aria-label={t('send')}
            disabled={!canSend}
            onClick={onSend}
          >
            <ArrowUp size={20} aria-hidden />
          </PillButton>
        )}
        {value.length >= COUNTER_FROM ? (
          <span className="pointer-events-none absolute right-16 bottom-0.5 text-xs font-bold text-white/70">
            {value.length} / {INPUT_MAX_LENGTH}
          </span>
        ) : null}
      </div>
    </div>
  )
}
