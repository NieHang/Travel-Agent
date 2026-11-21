import { screen } from '@testing-library/react'
import { Toaster } from '@/components/ui/toast'
import { renderWithProviders } from '@/test/render'
import { SaveTripButton } from './TripPanels'
import userEvent from '@testing-library/user-event'
import type { ResultItem, TripView } from '@autix/contracts'
import { LiveTripPanels } from './LiveTripPanels'

it('保存按钮提供即将上线提示', async () => {
  const { user } = renderWithProviders(<><Toaster /><SaveTripButton /></>)
  await user.click(screen.getByRole('button', { name: '保存行程' }))
  expect(await screen.findByText('保存行程即将上线')).toBeInTheDocument()
})

const hotel = (ref: string, name: string): ResultItem => ({
  ref, id: null, title: { original: name, translation: null }, address: null,
  price: { amount: 118, currency: 'EUR' }, rating: null, url: 'https://rollinggo.ai/h/1', image: null,
  details: [], amenities: [{ original: 'Kitchen', translation: '厨房' }], summary: null,
})
const view: TripView = {
  revision: 3, status: 'draft', destination: '里斯本', departureDate: '2026-12-01', returnDate: '2026-12-03',
  travelers: 2, budget: null, budgetCurrency: null, overview: null, itineraryMarkdown: '## 里斯本行程草稿', stayPlan: [],
  days: [{ title: '第 1 天', stops: [{ name: '阿尔法玛', note: null, time: null }], stay: hotel('h1', 'Casa do Fado') }],
  hotels: [hotel('h1', 'Casa do Fado'), hotel('h2', 'Old Town Rooms')], routes: [], hotspots: [],
}

it('行程页按天显示站点和当晚酒店', () => {
  renderWithProviders(<LiveTripPanels tab="plan" data={view} />)
  expect(screen.getByText('第 1 天')).toBeInTheDocument()
  expect(screen.getByText('阿尔法玛')).toBeInTheDocument()
  expect(screen.getByText(/今晚入住/)).toBeInTheDocument()
})

const drafted: TripView = {
  ...view,
  overview: '**总览**：里斯本 2 晚',
  days: [...view.days, { title: '第 2 天', stops: [], stay: hotel('h1', 'Casa do Fado') }, { title: '第 3 天', stops: [], stay: null }],
  stayPlan: [{ nights: { from: 0, to: 1 }, stay: hotel('h1', 'Casa do Fado'), options: [hotel('h1', 'Casa do Fado'), hotel('h2', 'Old Town Rooms')] }],
}

it('草稿生成时行程页显示正在写的草稿，完成后在天数上方显示总览', () => {
  const { rerender } = renderWithProviders(<LiveTripPanels tab="plan" data={null} draft={'## 正在写\n\n第 1 天'} />)
  expect(screen.getByRole('heading', { name: '正在写' })).toBeInTheDocument()
  rerender(<LiveTripPanels tab="plan" data={drafted} />)
  expect(screen.getByText(/里斯本 2 晚/)).toBeInTheDocument()
})

it('有行程时酒店页按连续的晚上分组，选另一家酒店会发出 choose_stay', async () => {
  const user = userEvent.setup()
  const onCommand = vi.fn()
  const { rerender } = renderWithProviders(<LiveTripPanels tab="hotels" data={drafted} onCommand={onCommand} />)
  const group = screen.getByRole('radiogroup', { name: '第 1–2 晚' })
  const radios = screen.getAllByRole('radio')
  expect(group).toContainElement(radios[0])
  expect(radios[0]).toHaveAttribute('aria-checked', 'true')
  expect(radios[0]).toBeDisabled()
  await user.click(radios[1])
  expect(onCommand).toHaveBeenCalledWith({ type: 'choose_stay', ref: 'h2', nights: { from: 0, to: 1 } })
  // The selection follows the server, not the click.
  expect(radios[1]).toHaveAttribute('aria-checked', 'false')
  rerender(<LiveTripPanels tab="hotels" data={drafted} onCommand={onCommand} busy />)
  expect(screen.getAllByRole('radio')[1]).toBeDisabled()
})

it('酒店页用卡片列表，可选择，并显示所选酒店的价格和预订', async () => {
  const user = userEvent.setup()
  renderWithProviders(<LiveTripPanels tab="hotels" data={view} />)
  const radios = screen.getAllByRole('radio')
  expect(radios).toHaveLength(2)
  expect(radios[0]).toHaveAttribute('aria-checked', 'true')
  await user.click(radios[1])
  expect(radios[1]).toHaveAttribute('aria-checked', 'true')
  expect(screen.getByRole('link', { name: /Old Town Rooms/ })).toHaveAttribute('href', 'https://rollinggo.ai/h/1')
})

it('没有数据时显示空态', () => {
  renderWithProviders(<LiveTripPanels tab="hotels" data={null} />)
  expect(screen.getByText('开始规划后，行程会显示在这里')).toBeInTheDocument()
})
