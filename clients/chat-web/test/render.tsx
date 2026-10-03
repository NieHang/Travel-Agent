import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, type RenderResult } from '@testing-library/react'
import userEvent, { type UserEvent } from '@testing-library/user-event'
import type { ReactElement } from 'react'

export type RenderOptions = { locale?: 'zh' | 'en'; queryClient?: QueryClient }

export function renderWithProviders(
  ui: ReactElement,
  opts: RenderOptions = {},
): RenderResult & { queryClient: QueryClient; user: UserEvent } {
  const queryClient =
    opts.queryClient ??
    new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const result = render(
    <QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>,
  )
  return { ...result, queryClient, user: userEvent.setup() }
}
