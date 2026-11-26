import { screen, waitFor } from '@testing-library/react'
import { renderWithProviders } from '@/test/render'
import { IconSwap } from './IconSwap'

it('换 key 时新图标出现，旧图标退场后移除', async () => {
  const { rerender } = renderWithProviders(<IconSwap swapKey="menu"><svg data-testid="menu" /></IconSwap>)
  expect(screen.getByTestId('menu')).toBeInTheDocument()
  rerender(<IconSwap swapKey="close"><svg data-testid="close" /></IconSwap>)
  expect(screen.getByTestId('close')).toBeInTheDocument()
  await waitFor(() => expect(screen.queryByTestId('menu')).toBeNull())
})
