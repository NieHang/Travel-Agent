import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, type RenderResult } from '@testing-library/react'
import userEvent, { type UserEvent } from '@testing-library/user-event'
import { NextIntlClientProvider } from 'next-intl'
import type { ReactElement, ReactNode } from 'react'
import en from '@/messages/en.json'
import zh from '@/messages/zh.json'

export type RenderOptions = { locale?: 'zh' | 'en'; queryClient?: QueryClient }

const MESSAGES = { zh, en }
// Fixed so relative-time output is deterministic in tests.
export const TEST_NOW = new Date('2026-10-03T12:00:00Z')

export function createWrapper(opts: RenderOptions = {}): {
  Wrapper: (props: { children: ReactNode }) => ReactElement
  queryClient: QueryClient
} {
  const locale = opts.locale ?? 'zh'
  const queryClient =
    opts.queryClient ??
    new QueryClient({ defaultOptions: { queries: { retry: false } } })
  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <NextIntlClientProvider
        locale={locale}
        messages={MESSAGES[locale]}
        timeZone="UTC"
        now={TEST_NOW}
      >
        <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
      </NextIntlClientProvider>
    )
  }
  return { Wrapper, queryClient }
}

export function renderWithProviders(
  ui: ReactElement,
  opts: RenderOptions = {},
): RenderResult & { queryClient: QueryClient; user: UserEvent } {
  const { Wrapper, queryClient } = createWrapper(opts)
  const result = render(ui, { wrapper: Wrapper })
  return { ...result, queryClient, user: userEvent.setup() }
}
