import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, type RenderResult } from '@testing-library/react'
import userEvent, { type UserEvent } from '@testing-library/user-event'
import { NextIntlClientProvider } from 'next-intl'
import type { ReactElement } from 'react'
import en from '@/messages/en.json'
import zh from '@/messages/zh.json'

export type RenderOptions = { locale?: 'zh' | 'en'; queryClient?: QueryClient }

const MESSAGES = { zh, en }
// Fixed so relative-time output is deterministic in tests.
export const TEST_NOW = new Date('2026-10-03T12:00:00Z')

export function renderWithProviders(
  ui: ReactElement,
  opts: RenderOptions = {},
): RenderResult & { queryClient: QueryClient; user: UserEvent } {
  const locale = opts.locale ?? 'zh'
  const queryClient =
    opts.queryClient ??
    new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const result = render(
    <NextIntlClientProvider
      locale={locale}
      messages={MESSAGES[locale]}
      timeZone="UTC"
      now={TEST_NOW}
    >
      <QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>
    </NextIntlClientProvider>,
  )
  return { ...result, queryClient, user: userEvent.setup() }
}
