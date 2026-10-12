import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { DateRangeField } from './DateRangeField'

const departure = { name: 'departureDate', label: '出发日期', required: true }
const returning = { name: 'returnDate', label: '返程日期', required: true }

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-10-12T10:00:00'))
})
afterEach(() => vi.useRealTimers())

it('过去的日期不可选，今天和以后可选', async () => {
  const user = userEvent.setup()
  render(<DateRangeField departure={departure} returning={returning} />)
  await user.click(screen.getByRole('button', { name: /出行日期/ }))
  expect(screen.getByRole('button', { name: '2026-10-11' })).toBeDisabled()
  expect(screen.getByRole('button', { name: '2026-10-12' })).toBeEnabled()
  expect(screen.getByRole('button', { name: '2026-10-13' })).toBeEnabled()
  await user.click(screen.getByRole('button', { name: '2026-10-11' }))
  expect(screen.getByRole('button', { name: '2026-10-11' })).toHaveAttribute('aria-pressed', 'false')
})

it('当前月份不能翻到上个月', async () => {
  const user = userEvent.setup()
  render(<DateRangeField departure={departure} returning={returning} />)
  await user.click(screen.getByRole('button', { name: /出行日期/ }))
  expect(screen.getByRole('button', { name: '上个月' })).toBeDisabled()
  await user.click(screen.getByRole('button', { name: '下个月' }))
  expect(screen.getByRole('button', { name: '上个月' })).toBeEnabled()
})

it('隐藏的日期输入以今天为最小值，过去的已存日期无法通过表单校验', () => {
  render(<form><DateRangeField departure={departure} returning={returning} initialStart="2026-10-01" initialEnd="2026-10-20" /></form>)
  const start = screen.getByLabelText('出发日期') as HTMLInputElement
  expect(start).toHaveAttribute('min', '2026-10-12')
  expect(screen.getByLabelText('返程日期')).toHaveAttribute('min', '2026-10-12')
  expect(start.checkValidity()).toBe(false)
})
