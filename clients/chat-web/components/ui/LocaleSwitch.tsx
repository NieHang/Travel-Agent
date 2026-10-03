'use client'

import { useLocale, useTranslations } from 'next-intl'
import type { Locale } from '@autix/contracts'
import { useSetLocale } from '@/features/auth/use-set-locale'

export function LocaleSwitch({ onInk = false }: { onInk?: boolean }) {
  const t = useTranslations('common')
  const current = useLocale()
  const setLocale = useSetLocale()
  const segments: { locale: Locale; label: string }[] = [
    { locale: 'zh', label: t('localeZh') },
    { locale: 'en', label: t('localeEn') },
  ]
  return (
    <div
      data-on-ink={onInk || undefined}
      className={`inline-flex gap-1 rounded-full p-1 ${onInk ? 'bg-ink' : 'bg-paper'}`}
    >
      {segments.map(({ locale, label }) => {
        const selected = locale === current
        return (
          <button
            key={locale}
            type="button"
            aria-pressed={selected}
            onClick={() => {
              if (!selected) setLocale(locale)
            }}
            className={`inline-flex min-h-11 min-w-11 items-center justify-center rounded-full px-3 text-sm font-bold ${
              selected
                ? 'cursor-default bg-lime text-ink'
                : `cursor-pointer ${onInk ? 'text-white' : 'text-ink'}`
            }`}
          >
            {label}
          </button>
        )
      })}
    </div>
  )
}
