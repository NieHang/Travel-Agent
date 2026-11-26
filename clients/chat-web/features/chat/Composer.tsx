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

const INPUT_MAX_LENGTH = 4000
const COUNTER_FROM = 3800
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
  onChange: (v: string) => void
  generating: boolean
  rateLimitSeconds: number
  onSend: () => void
  onStop: () => void
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
        <p role="status" className="px-4 text-[13px] font-semibold">
          {t('rateLimited', { n: rateLimitSeconds })}
        </p>
      ) : null}
      {/* 30px = the 48px send button's radius plus the 6px around it, so the corners stay concentric. */}
      <div className="relative flex items-end gap-2.5 rounded-[30px] bg-white py-1.5 pr-1.5 pl-[22px] has-[textarea:focus-visible]:outline-2 has-[textarea:focus-visible]:outline-offset-2 has-[textarea:focus-visible]:outline-trip-ink">
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
          className="min-h-12 flex-1 resize-none self-center overflow-y-auto bg-transparent py-3 text-[15px] leading-6 text-trip-ink outline-none placeholder:text-trip-muted"
        />
        {generating ? (
          <PillButton variant="trip-soft" iconOnly aria-label={t('stop')} onClick={onStop}>
            <Square size={16} fill="currentColor" aria-hidden />
          </PillButton>
        ) : (
          <PillButton
            variant="trip-soft"
            iconOnly
            aria-label={t('send')}
            disabled={!canSend}
            onClick={onSend}
          >
            <ArrowUp size={20} aria-hidden />
          </PillButton>
        )}
        {value.length >= COUNTER_FROM ? (
          <span className="pointer-events-none absolute right-16 bottom-0.5 text-xs font-semibold text-trip-muted">
            {value.length} / {INPUT_MAX_LENGTH}
          </span>
        ) : null}
      </div>
    </div>
  )
}
