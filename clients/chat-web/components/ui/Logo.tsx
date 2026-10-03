'use client'

import { useTranslations } from 'next-intl'

export function LogoDot({ className = 'bg-ink' }: { className?: string }) {
  return (
    <span aria-hidden className={`block size-6 shrink-0 rounded-full ${className}`} />
  )
}

export function Logo() {
  const t = useTranslations('common')
  return (
    <span className="inline-flex items-center gap-2 text-xl font-extrabold tracking-tight text-ink">
      <LogoDot />
      {t('brand')}
    </span>
  )
}
