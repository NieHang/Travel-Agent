'use client'

import { useReducedMotion } from '@/lib/use-reduced-motion'

import type { LucideIcon } from 'lucide-react'
import { motion } from 'motion/react'
import { useRef, type KeyboardEvent } from 'react'
import { springs } from '@/lib/motion'

type Variant = 'pill' | 'tile'

/** `pill`: a row of text tabs (the desktop top bar). `tile`: equal tiles with an icon (the mobile sheet). */
const LOOK: Record<Variant, { list: string; tab: string; on: string; off: string; indicator: string }> = {
  pill: {
    list: 'inline-flex max-w-full gap-1',
    tab: 'min-h-11 min-w-11 shrink-0 gap-2 rounded-full px-[18px] text-[15px] whitespace-nowrap',
    on: 'font-bold text-trip-ink',
    off: 'font-medium text-trip-muted',
    indicator: 'rounded-full bg-trip-fill',
  },
  tile: {
    list: 'grid w-full auto-cols-fr grid-flow-col gap-2.5',
    tab: 'h-[72px] min-w-0 flex-col gap-1.5 rounded-trip-sm bg-trip-tile px-1 text-[13px] font-semibold',
    on: 'text-white',
    off: 'text-trip-ink',
    indicator: 'rounded-trip-sm bg-trip-ink',
  },
}

export function PillTabs<T extends string>({
  items,
  value,
  onChange,
  layoutId,
  variant = 'pill',
  'aria-label': ariaLabel,
}: {
  items: { value: T; label: string; badge?: string; icon?: LucideIcon }[]
  value: T
  onChange: (value: T) => void
  'aria-label': string
  layoutId: string
  variant?: Variant
}) {
  const reduced = useReducedMotion()
  const refs = useRef<(HTMLButtonElement | null)[]>([])
  const look = LOOK[variant]

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
    <div role="tablist" aria-label={ariaLabel} className={look.list}>
      {items.map((item, i) => {
        const selected = item.value === value
        const Icon = item.icon
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
            className={`relative inline-flex cursor-pointer items-center justify-center transition-colors duration-150 ${look.tab} ${selected ? look.on : look.off}`}
          >
            {selected ? (
              <motion.span
                aria-hidden
                layoutId={layoutId}
                transition={reduced ? { duration: 0 } : springs.smooth}
                className={`absolute inset-0 ${look.indicator}`}
              />
            ) : null}
            {Icon ? <Icon size={20} aria-hidden className="relative" /> : null}
            <span className="relative max-w-full truncate">{item.label}</span>
            {item.badge ? (
              <span className="relative rounded-full bg-trip-ink px-2 text-xs text-white">
                {item.badge}
              </span>
            ) : null}
          </button>
        )
      })}
    </div>
  )
}
