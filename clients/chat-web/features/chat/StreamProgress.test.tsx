import { screen } from '@testing-library/react'
import { it, expect } from 'vitest'
import { renderWithProviders } from '@/test/render'
import { StreamProgress } from './StreamProgress'

it('shows the phase step and reserves 100 percent and the checkmark for a completed turn', () => {
  const { rerender } = renderWithProviders(
    <StreamProgress phase="searching" outcome="running" />,
  )
  expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '35')
  expect(screen.getByText('查询实时数据')).toBeInTheDocument()
  expect(screen.queryByTestId('progress-check')).not.toBeInTheDocument()
  rerender(<StreamProgress phase="writing" outcome="completed" />)
  expect(screen.getByRole('progressbar')).toHaveAttribute(
    'aria-valuenow',
    '100',
  )
  expect(screen.getByTestId('progress-check')).toBeInTheDocument()
  rerender(<StreamProgress phase="writing" outcome="cancelled" />)
  expect(screen.queryByTestId('progress-check')).not.toBeInTheDocument()
})

it('renders nothing without a phase', () => {
  renderWithProviders(<StreamProgress phase={null} outcome="cancelled" />)
  expect(screen.queryByRole('progressbar')).toBeNull()
})
