'use client'

import { useTranslations } from 'next-intl'

export function LogoDot({ className = 'size-6 bg-ink' }: { className?: string }) {
  return (
    <span aria-hidden className={`block shrink-0 rounded-full ${className}`} />
  )
}

/** `ink` for the landing and sign-in pages, `trip` for the trip screen. */
const LOOK = {
  ink: { text: 'gap-2 text-xl font-extrabold tracking-tight text-ink', dot: 'size-6 bg-ink' },
  trip: { text: 'gap-2.5 text-2xl font-bold tracking-[-0.4px] text-trip-ink', dot: 'size-[22px] bg-trip-brand' },
}

export function Logo({ variant = 'ink' }: { variant?: keyof typeof LOOK }) {
  const t = useTranslations('common')
  return (
    <span className={`inline-flex items-center ${LOOK[variant].text}`}>
      <LogoDot className={LOOK[variant].dot} />
      {t('brand')}
    </span>
  )
}
