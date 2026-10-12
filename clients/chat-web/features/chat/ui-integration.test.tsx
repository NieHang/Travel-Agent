import { screen } from '@testing-library/react'
import { vi, it, expect } from 'vitest'
import { renderWithProviders } from '@/test/render'
import { MessageBubble } from './MessageBubble'
import { TripPanels } from '@/features/panels/TripPanels'
it('renders trip commands inside actual message bubbles', async () => {
  const onCommand = vi.fn()
  const { user } = renderWithProviders(
    <MessageBubble
      role="ASSISTANT"
      content="Choose"
      components={[
        {
          type: 'choice',
          command: 'set_trip_type',
          title: 'Trip',
          options: [{ value: 'solo', label: 'Solo', description: null }],
        },
      ]}
      onCommand={onCommand}
    />,
  )
  await user.click(screen.getByRole('button', { name: /Solo/ }))
  expect(onCommand).toHaveBeenCalledWith({ type: 'set_trip_type', value: 'solo' })
})
it('shows a real empty panel', () => {
  renderWithProviders(<TripPanels tab="plan" data={null} />)
  expect(screen.getByText('开始规划后，行程会显示在这里')).toBeInTheDocument()
})

it('renders a legacy component from an old message as read-only text', () => {
  renderWithProviders(
    <MessageBubble
      role="ASSISTANT"
      content="Draft body"
      components={[
        {
          id: 'draft',
          type: 'card',
          category: 'itinerary',
          title: 'Trip draft',
          description: 'Old draft',
          details: [],
          sourceStatus: 'unverified',
        },
      ]}
    />,
  )
  expect(screen.getByText('Draft body')).toBeInTheDocument()
  expect(screen.getByText('Trip draft')).toBeInTheDocument()
  expect(screen.queryByRole('button')).toBeNull()
})
