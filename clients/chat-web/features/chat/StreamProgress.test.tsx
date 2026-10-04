import { screen } from '@testing-library/react'
import { it, expect } from 'vitest'
import { renderWithProviders } from '@/test/render'
import { StreamProgress } from './StreamProgress'
it('reserves 100 percent and the checkmark for a persisted successful completion', () => {
  const progress = {
    agent: 'save',
    step: 4,
    totalSteps: 4,
    status: 'completed' as const,
    label: 'save',
  }
  const { rerender } = renderWithProviders(
    <StreamProgress progress={progress} outcome="running" />,
  )
  expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '99')
  expect(screen.queryByTestId('progress-check')).not.toBeInTheDocument()
  rerender(<StreamProgress progress={progress} outcome="completed" />)
  expect(screen.getByRole('progressbar')).toHaveAttribute(
    'aria-valuenow',
    '100',
  )
  expect(screen.getByTestId('progress-check')).toBeInTheDocument()
  rerender(<StreamProgress progress={progress} outcome="cancelled" />)
  expect(screen.queryByTestId('progress-check')).not.toBeInTheDocument()
})
