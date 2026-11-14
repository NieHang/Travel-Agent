import { screen, within } from '@testing-library/react'
import type { Component, FormField } from '@autix/contracts'
import { renderWithProviders } from '@/test/render'
import { ComponentRenderer } from '../ComponentRenderer'

const fields: FormField[] = [
  { name: 'destination', label: '目的地', placeholder: '例如日本东京', value: null, suggestions: ['东京', '京都'] },
  { name: 'dates', label: '出行日期', value: null },
  { name: 'travelers', label: '出行人数', value: 2 },
  { name: 'preferences', label: '兴趣与特殊需求', placeholder: null, value: '', suggestions: ['美食', '温泉'] },
]
const form = (overrides: Partial<Record<FormField['name'], unknown>> = {}): Extract<Component, { type: 'form' }> => ({
  type: 'form', command: 'submit_requirements', title: '旅游需求', submitLabel: '生成路线草案',
  fields: fields.map((f) => (f.name in overrides ? { ...f, value: overrides[f.name] } : f)) as FormField[],
})

// The calendar blocks past days; pin "today" before every date the tests pick.
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-10-01T10:00:00'))
})
afterEach(() => vi.useRealTimers())

const day = (name: RegExp) => within(screen.getByRole('grid')).getByRole('button', { name })

it('fills an empty trip with taps only: each commit opens the next missing field', async () => {
  const onCommand = vi.fn()
  const { user } = renderWithProviders(<ComponentRenderer component={form()} mode={{ kind: 'live', onCommand }} />)
  await user.click(screen.getByRole('button', { name: '下一步：目的地' }))
  await user.click(screen.getByRole('button', { name: '东京' }))
  // Committing the destination opens the dates calendar without another tap.
  await user.click(day(/10月5日/))
  await user.click(day(/10月8日/))
  expect(screen.getByRole('button', { name: /目的地: 东京/ })).toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: '生成路线草案' }))
  expect(onCommand).toHaveBeenCalledWith({
    type: 'submit_requirements',
    values: { destination: '东京', departureDate: '2026-10-05', returnDate: '2026-10-08', travelers: 2, preferences: '' },
  })
})

it('submits a prefilled trip in one tap and keeps changes made with the stepper and tags', async () => {
  const onCommand = vi.fn()
  const { user } = renderWithProviders(
    <ComponentRenderer component={form({ destination: '京都', dates: { start: '2026-10-05', end: '2026-10-07' } })} mode={{ kind: 'live', onCommand }} />,
  )
  await user.click(screen.getByRole('button', { name: '增加一人' }))
  await user.click(screen.getByRole('button', { name: '兴趣与特殊需求' }))
  await user.click(screen.getByRole('button', { name: '美食' }))
  await user.click(screen.getByRole('button', { name: '温泉' }))
  await user.click(screen.getByRole('button', { name: '完成' }))
  await user.click(screen.getByRole('button', { name: '生成路线草案' }))
  expect(onCommand).toHaveBeenCalledWith({
    type: 'submit_requirements',
    values: { destination: '京都', departureDate: '2026-10-05', returnDate: '2026-10-07', travelers: 3, preferences: '美食、温泉' },
  })
})

it('typing a destination and pressing Enter commits it', async () => {
  const onCommand = vi.fn()
  const { user } = renderWithProviders(<ComponentRenderer component={form({ dates: { start: '2026-10-05', end: '2026-10-07' } })} mode={{ kind: 'live', onCommand }} />)
  await user.click(screen.getByRole('button', { name: '目的地' }))
  await user.type(screen.getByRole('textbox', { name: '目的地' }), '  札幌 {Enter}')
  expect(screen.getByRole('button', { name: /目的地: 札幌/ })).toBeInTheDocument()
})

it('an answered form steps aside: the reply below already lists the values', () => {
  const { container } = renderWithProviders(
    <ComponentRenderer
      component={form()}
      mode={{ kind: 'answered', command: { type: 'submit_requirements', values: { destination: '大阪', departureDate: '2026-12-01', returnDate: '2026-12-05', travelers: 3, preferences: '' } } }}
    />,
  )
  expect(container).toBeEmptyDOMElement()
})

it('a locked form shows its values without a submit button', () => {
  renderWithProviders(<ComponentRenderer component={form({ destination: '京都' })} mode={{ kind: 'locked' }} />)
  expect(screen.getByText('京都')).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: /生成路线草案|下一步/ })).toBeNull()
})
