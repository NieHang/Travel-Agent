'use client'

import { AlertCircle, Eye, EyeOff } from 'lucide-react'
import { useTranslations } from 'next-intl'
import {
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
  type Ref,
} from 'react'

export function Field({
  label,
  name,
  type,
  value,
  onChange,
  onBlur,
  error,
  hint,
  autoComplete,
  autoFocus,
  maxLength,
  ref,
}: {
  label: string
  name: string
  type: 'text' | 'email' | 'password'
  value: string
  onChange(value: string): void
  onBlur?(): void
  error?: ReactNode
  hint?: ReactNode
  autoComplete?: string
  autoFocus?: boolean
  maxLength?: number
  ref?: Ref<HTMLInputElement>
}) {
  const t = useTranslations('auth')
  const id = useId()
  const errorId = `${id}-error`
  const hintId = `${id}-hint`
  const [revealed, setRevealed] = useState(false)
  const inputRef = useRef<HTMLInputElement | null>(null)
  const caret = useRef<[number | null, number | null] | null>(null)

  const isPassword = type === 'password'
  const hasError = Boolean(error)
  const describedBy =
    [hasError ? errorId : null, hint ? hintId : null]
      .filter(Boolean)
      .join(' ') || undefined

  // 切换 type 后恢复光标位置
  useLayoutEffect(() => {
    const el = inputRef.current
    const saved = caret.current
    if (!el || !saved) return
    caret.current = null
    try {
      el.setSelectionRange(saved[0], saved[1])
    } catch {
      // 个别浏览器对该 type 不支持选区
    }
  }, [revealed])

  function setRefs(el: HTMLInputElement | null) {
    inputRef.current = el
    if (typeof ref === 'function') ref(el)
    else if (ref) ref.current = el
  }

  return (
    <div className="flex flex-col gap-2">
      <label htmlFor={id} className="text-sm font-bold text-white">
        {label}
      </label>
      <div
        data-on-ink
        className="flex items-center rounded-full border border-white/40 bg-ink px-5 has-[input:focus-visible]:outline-2 has-[input:focus-visible]:outline-offset-2 has-[input:focus-visible]:outline-lime"
      >
        <input
          ref={setRefs}
          id={id}
          name={name}
          type={isPassword && revealed ? 'text' : type}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onBlur={onBlur}
          autoComplete={autoComplete}
          autoFocus={autoFocus}
          maxLength={maxLength}
          aria-invalid={hasError || undefined}
          aria-describedby={describedBy}
          className="min-h-12 min-w-0 flex-1 bg-transparent text-base text-white outline-none focus-visible:outline-none"
        />
        {isPassword ? (
          <button
            type="button"
            aria-label={revealed ? t('hidePassword') : t('showPassword')}
            aria-pressed={revealed}
            // 点击时不抢走输入框的焦点
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => {
              const el = inputRef.current
              caret.current = el ? [el.selectionStart, el.selectionEnd] : null
              setRevealed((v) => !v)
            }}
            className="-mr-3 inline-flex size-11 shrink-0 cursor-pointer items-center justify-center rounded-full text-white"
          >
            {revealed ? (
              <EyeOff aria-hidden className="size-5" />
            ) : (
              <Eye aria-hidden className="size-5" />
            )}
          </button>
        ) : null}
      </div>
      {hasError ? (
        <p
          id={errorId}
          className="flex items-center gap-1.5 text-sm font-bold text-white"
        >
          <AlertCircle aria-hidden className="size-4 shrink-0 text-danger" />
          <span>{error}</span>
        </p>
      ) : null}
      {hint ? (
        <p id={hintId} className="text-xs text-white">
          {hint}
        </p>
      ) : null}
    </div>
  )
}
