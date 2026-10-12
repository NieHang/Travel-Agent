import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { Component } from '@autix/contracts'
import { ComponentRenderer } from './ComponentRenderer'

const form: Extract<Component, { type: 'form' }> = {
  type: 'form', command: 'submit_requirements', title: '旅游需求', submitLabel: '生成路线草案',
  fields: [
    { name: 'destination', kind: 'text', label: '目的地', required: true, placeholder: null, min: null, max: null },
    { name: 'departureDate', kind: 'date', label: '出发日期', required: true, placeholder: null, min: null, max: null },
    { name: 'returnDate', kind: 'date', label: '返程日期', required: true, placeholder: null, min: null, max: null },
    { name: 'travelers', kind: 'number', label: '出行人数', required: true, placeholder: null, min: 1, max: 100 },
  ],
  initialValues: { destination: '京都', departureDate: '2026-10-05', returnDate: '2026-10-07', travelers: 1 },
}

const submitted = (onCommand: ReturnType<typeof vi.fn>, call = 0) => onCommand.mock.calls[call]?.[0]?.values

it('changing only destination preserves saved dates and travelers on submission', async () => {
  const user = userEvent.setup(), onCommand = vi.fn()
  render(<ComponentRenderer component={form} onCommand={onCommand} />)
  const destination = screen.getByRole('textbox', { name: /目的地/ })
  expect(destination).toHaveValue('京都')
  await user.clear(destination)
  await user.type(destination, '东京')
  await user.click(screen.getByRole('button', { name: '生成路线草案' }))
  expect(onCommand).toHaveBeenCalledWith({
    type: 'submit_requirements',
    values: { destination: '东京', departureDate: '2026-10-05', returnDate: '2026-10-07', travelers: 1 },
  })
})

it('selects a cross-month range in one calendar and normalizes reverse selection', async () => {
  const user = userEvent.setup(), onCommand = vi.fn()
  render(<ComponentRenderer component={form} onCommand={onCommand} />)
  await user.click(screen.getByRole('button', { name: /出行日期/ }))
  await user.click(screen.getByRole('button', { name: '2026-10-30' }))
  await user.click(screen.getByRole('button', { name: '下个月' }))
  await user.click(screen.getByRole('button', { name: '2026-11-03' }))
  await user.click(screen.getByRole('button', { name: '生成路线草案' }))
  expect(submitted(onCommand, 0)).toMatchObject({ departureDate: '2026-10-30', returnDate: '2026-11-03' })
  await user.click(screen.getByRole('button', { name: /出行日期/ }))
  await user.click(screen.getByRole('button', { name: '2026-10-20' }))
  await user.click(screen.getByRole('button', { name: '2026-10-18' }))
  await user.click(screen.getByRole('button', { name: '生成路线草案' }))
  expect(submitted(onCommand, 1)).toMatchObject({ departureDate: '2026-10-18', returnDate: '2026-10-20' })
})

it('keeps a supplied return date when selecting only the missing departure', async () => {
  const user = userEvent.setup(), onCommand = vi.fn()
  const { departureDate: _, ...withoutDeparture } = form.initialValues
  render(<ComponentRenderer component={{ ...form, initialValues: withoutDeparture }} onCommand={onCommand} />)
  await user.click(screen.getByRole('button', { name: /出行日期/ }))
  await user.click(screen.getByRole('button', { name: '2026-10-05' }))
  await user.click(screen.getByRole('button', { name: '生成路线草案' }))
  expect(submitted(onCommand)).toMatchObject({ departureDate: '2026-10-05', returnDate: '2026-10-07' })
})
