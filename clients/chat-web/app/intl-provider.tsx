'use client'

import { IntlErrorCode, NextIntlClientProvider } from 'next-intl'
import { useEffect, useState, type ReactNode } from 'react'
import type { Locale } from '@autix/contracts'
import type { Messages } from '@/i18n/messages'

// The server cannot know the viewer's time zone. The first render (SSR and
// hydration) has none; after mount the browser's zone is applied. The missing
// zone warning is expected during that first render, so it is ignored.
function onError(error: { code: string }) {
  if (error.code === IntlErrorCode.ENVIRONMENT_FALLBACK) return
  console.error(error)
}

export function IntlProvider({
  locale,
  messages,
  children,
}: {
  locale: Locale
  messages: Messages
  children: ReactNode
}) {
  const [timeZone, setTimeZone] = useState<string | undefined>(undefined)
  useEffect(() => {
    setTimeZone(Intl.DateTimeFormat().resolvedOptions().timeZone)
  }, [])
  return (
    <NextIntlClientProvider locale={locale} messages={messages} timeZone={timeZone} onError={onError}>
      {children}
    </NextIntlClientProvider>
  )
}
