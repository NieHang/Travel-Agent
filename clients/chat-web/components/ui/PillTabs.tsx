'use client'

import { useReducedMotion } from '@/lib/use-reduced-motion'

import { motion } from 'motion/react'
import { useRef, type KeyboardEvent } from 'react'
import { springs } from '@/lib/motion'

export function PillTabs<T extends string>({
  items,
  value,
  onChange,
  layoutId,
  onInk = false,
  scrollable = false,
  'aria-label': ariaLabel,
}: {
  items: { value: T; label: string; badge?: string }[]
  value: T
  onChange(value: T): void
  'aria-label': string
  layoutId: string
  onInk?: boolean
  scrollable?: boolean
}) {
  const reduced = useReducedMotion()
  const refs = useRef<(HTMLButtonElement | null)[]>([])

  function select(next: T) {
    if (next !== value) onChange(next)
  }

  function onKeyDown(e: KeyboardEvent, index: number) {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return
    e.preventDefault()
    const step = e.key === 'ArrowRight' ? 1 : -1
    const next = (index + step + items.length) % items.length
    refs.current[next]?.focus()
    select(items[next].value)
  }

  return (
    <div
      role="tablist"
      aria-label={ariaLabel}
      data-on-ink={onInk || undefined}
      className={`inline-flex max-w-full gap-1 rounded-full p-1 ${
        onInk ? 'bg-ink' : 'bg-paper'
      } ${scrollable ? 'overflow-x-auto' : ''}`}
    >
      {items.map((item, i) => {
        const selected = item.value === value
        return (
          <button
            key={item.value}
            ref={(el) => {
              refs.current[i] = el
            }}
            type="button"
            role="tab"
            aria-selected={selected}
            tabIndex={selected ? 0 : -1}
            onClick={() => select(item.value)}
            onKeyDown={(e) => onKeyDown(e, i)}
            className={`relative inline-flex min-h-11 min-w-11 shrink-0 cursor-pointer items-center justify-center gap-2 rounded-full px-4 text-sm font-bold whitespace-nowrap ${
              selected ? 'text-ink' : onInk ? 'text-white' : 'text-ink'
            }`}
          >
            {selected ? (
              <motion.span
                aria-hidden
                layoutId={layoutId}
                transition={reduced ? { duration: 0 } : springs.smooth}
                className="absolute inset-0 rounded-full bg-lime"
              />
            ) : null}
            <span className="relative">{item.label}</span>
            {item.badge ? (
              <span className="relative rounded-full bg-ink px-2 text-xs text-white">
                {item.badge}
              </span>
            ) : null}
          </button>
        )
      })}
    </div>
  )
}
