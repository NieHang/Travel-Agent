import { screen } from '@testing-library/react'
import { vi, it, expect } from 'vitest'
import { renderWithProviders } from '@/test/render'
import { MessageBubble } from './MessageBubble'
import { TripPanels } from '@/features/panels/TripPanels'
import { latestTripSnapshot } from '@/features/panels/trip-snapshot'
import { makeMessage } from '@/test/fixtures'
it('renders protocol actions inside actual message bubbles', async () => {
  const onAction = vi.fn()
  const { user } = renderWithProviders(
    <MessageBubble
      role="ASSISTANT"
      content="Choose"
      components={[
        {
          id: 's',
          type: 'selection',
          purpose: 'trip_type',
          title: 'Trip',
          mode: 'single',
          options: [{ value: 'solo', label: 'Solo', description: null }],
        },
      ]}
      onAction={onAction}
    />,
  )
  await user.click(screen.getByRole('button', { name: /Solo/ }))
  expect(onAction).toHaveBeenCalledWith({
    type: 'selection',
    componentId: 's',
    values: ['solo'],
  })
})
it('shows a real empty panel and respects explicit cleared snapshots', () => {
  renderWithProviders(<TripPanels tab="plan" data={null} />)
  expect(screen.getByText('开始规划后，行程会显示在这里')).toBeInTheDocument()
  expect(
    latestTripSnapshot([makeMessage({ metadata: { trip: null } })]),
  ).toBeNull()
})

it('shows a streamed itinerary once while preserving card title and attribution', () => {
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
          description: 'Draft body',
          details: [],
          sourceStatus: 'unverified',
        },
      ]}
    />,
  )
  expect(screen.getAllByText('Draft body')).toHaveLength(1)
  expect(screen.getByText('Trip draft')).toBeInTheDocument()
})
