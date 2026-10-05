import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ComponentRenderer } from './ComponentRenderer'
import type { UIResponse } from './types'

const form = {
  id: 'requirements', type: 'form', title: '旅游需求', submitLabel: '生成路线草案',
  fields: [
    { name: 'destination', type: 'input', label: '目的地', required: true, placeholder: null },
    { name: 'departureDate', type: 'date', label: '出发日期', required: true, placeholder: null },
    { name: 'returnDate', type: 'date', label: '返程日期', required: true, placeholder: null },
    { name: 'travelers', type: 'number', label: '出行人数', required: true, min: 1, max: 100 },
  ],
  initialValues: [{ name: 'destination', value: '京都' }, { name: 'departureDate', value: '2026-10-05' }, { name: 'returnDate', value: '2026-10-07' }, { name: 'travelers', value: 1 }],
} as Extract<UIResponse, { type: 'form' }>

it('changing only destination preserves saved dates and travelers on submission', async () => {
  const user = userEvent.setup(), onAction = vi.fn()
  render(<ComponentRenderer component={form} onAction={onAction} />)
  const destination = screen.getByRole('textbox', { name: /目的地/ })
  expect(destination).toHaveValue('京都')
  await user.clear(destination)
  await user.type(destination, '东京')
  await user.click(screen.getByRole('button', { name: '生成路线草案' }))
  expect(onAction).toHaveBeenCalledWith({ type: 'form_submit', componentId: 'requirements', values: [
    { name: 'destination', value: '东京' }, { name: 'departureDate', value: '2026-10-05' },
    { name: 'returnDate', value: '2026-10-07' }, { name: 'travelers', value: 1 },
  ] })
})

it('selects a cross-month range in one calendar and normalizes reverse selection', async () => {
  const user = userEvent.setup(), onAction = vi.fn()
  render(<ComponentRenderer component={form} onAction={onAction} />)
  await user.click(screen.getByRole('button', { name: /出行日期/ }))
  await user.click(screen.getByRole('button', { name: '2026-10-30' }))
  await user.click(screen.getByRole('button', { name: '下个月' }))
  await user.click(screen.getByRole('button', { name: '2026-11-03' }))
  await user.click(screen.getByRole('button', { name: '生成路线草案' }))
  expect(onAction.mock.calls[0][0].values.slice(1, 3)).toEqual([
    { name: 'departureDate', value: '2026-10-30' }, { name: 'returnDate', value: '2026-11-03' },
  ])
  await user.click(screen.getByRole('button', { name: /出行日期/ }))
  await user.click(screen.getByRole('button', { name: '2026-10-20' }))
  await user.click(screen.getByRole('button', { name: '2026-10-18' }))
  await user.click(screen.getByRole('button', { name: '生成路线草案' }))
  expect(onAction.mock.calls[1][0].values.slice(1, 3)).toEqual([
    { name: 'departureDate', value: '2026-10-18' }, { name: 'returnDate', value: '2026-10-20' },
  ])
})

it('keeps a supplied return date when selecting only the missing departure', async () => {
  const user = userEvent.setup(), onAction = vi.fn()
  render(<ComponentRenderer component={{ ...form, initialValues: form.initialValues!.filter(v => v.name !== 'departureDate') }} onAction={onAction} />)
  await user.click(screen.getByRole('button', { name: /出行日期/ }))
  await user.click(screen.getByRole('button', { name: '2026-10-05' }))
  await user.click(screen.getByRole('button', { name: '生成路线草案' }))
  expect(onAction.mock.calls[0]?.[0].values.slice(1, 3)).toEqual([
    { name: 'departureDate', value: '2026-10-05' }, { name: 'returnDate', value: '2026-10-07' },
  ])
})
