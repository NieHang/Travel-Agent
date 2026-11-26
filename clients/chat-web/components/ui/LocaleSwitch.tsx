'use client'

import { useLocale, useTranslations } from 'next-intl'
import type { Locale } from '@autix/contracts'
import { useSetLocale } from '@/features/auth/use-set-locale'

export function LocaleSwitch() {
  const t = useTranslations('common')
  const current = useLocale()
  const setLocale = useSetLocale()
  const segments: { locale: Locale; label: string }[] = [
    { locale: 'zh', label: t('localeZh') },
    { locale: 'en', label: t('localeEn') },
  ]
  return (
    <div className="inline-flex gap-1 rounded-full bg-trip-fill p-1">
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
            className={`inline-flex min-h-11 min-w-11 items-center justify-center rounded-full px-3 text-[13px] font-medium ${
              selected ? 'cursor-default bg-white text-trip-ink' : 'cursor-pointer text-trip-muted'
            }`}
          >
            {label}
          </button>
        )
      })}
    </div>
  )
}
