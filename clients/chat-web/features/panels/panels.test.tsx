import { screen, waitFor, within } from '@testing-library/react'
import { Toaster } from '@/components/ui/toast'
import { renderWithProviders } from '@/test/render'
import { SaveTripButton } from './TripPanels'
import userEvent from '@testing-library/user-event'
import type { ResultItem, StopCheck, TripView } from '@autix/contracts'
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
  days: [{ title: '第 1 天', stops: [{ name: '阿尔法玛', note: null, time: null, check: null }], stay: hotel('h1', 'Casa do Fado') }],
  hotels: [hotel('h1', 'Casa do Fado'), hotel('h2', 'Old Town Rooms')], routes: [], hotspots: [],
}

it('行程页按天显示站点和当晚酒店', () => {
  renderWithProviders(<LiveTripPanels tab="plan" data={view} />)
  expect(screen.getByText('第 1 天')).toBeInTheDocument()
  expect(screen.getByText('阿尔法玛')).toBeInTheDocument()
  expect(screen.getByText(/今晚入住/)).toBeInTheDocument()
})

const closing = {
  text: '11–2 月 16:30 关门，这一站会超过关门时间',
  source: 'https://www.higashihonganji.or.jp/worship/',
  checkedOn: '2026-11-18',
}
const checked = (check: StopCheck | null): TripView => ({
  ...view,
  days: [{ title: '第 1 天', stops: [{ name: '东本愿寺', note: null, time: '16:00', check }], stay: null }],
})
const stopLine = () => screen.getByText('16:00 · 东本愿寺').closest('li')

it.each([
  ['ok', '已核实', 'chip--success'],
  ['caution', '注意', 'chip--warning'],
  ['conflict', '冲突', 'chip--danger'],
  ['unverified', '未核实', 'chip--default'],
] as const)('核对结果为 %s 时站点后显示“%s”标记', (level, label, color) => {
  renderWithProviders(<LiveTripPanels tab="plan" data={checked({ level, notes: [] })} />)
  expect(stopLine()).toContainElement(screen.getByText(label))
  expect(screen.getByText(label).closest('[data-slot="chip"]')).toHaveClass(color)
})

it('没有核对结果时站点后不显示标记', () => {
  renderWithProviders(<LiveTripPanels tab="plan" data={checked(null)} />)
  expect(stopLine()).toHaveTextContent(/^16:00 · 东本愿寺$/)
  expect(document.querySelector('[data-slot="chip"]')).toBeNull()
})

it('只有标记本身能打开说明：悬停、聚焦预览，按下后显示说明、来源和核实日期', async () => {
  const { user } = renderWithProviders(<LiveTripPanels tab="plan" data={checked({ level: 'conflict', notes: [closing] })} />)
  // React Aria counts a hover as the mouse only after it has seen the pointer move.
  await user.hover(document.body)
  await user.hover(screen.getByText('16:00 · 东本愿寺'))
  await user.click(screen.getByText('16:00 · 东本愿寺'))
  expect(screen.queryByRole('tooltip')).toBeNull()
  expect(screen.queryByRole('dialog')).toBeNull()

  const chip = screen.getByRole('button', { name: '冲突' })
  await user.hover(chip)
  expect(screen.getByRole('tooltip')).toHaveTextContent(closing.text)
  await user.unhover(chip)
  expect(screen.queryByRole('tooltip')).toBeNull()

  await user.tab()
  expect(chip).toHaveFocus()
  expect(screen.getByRole('tooltip')).toHaveTextContent(closing.text)
  await user.keyboard('{Enter}')
  const dialog = await screen.findByRole('dialog', { name: '东本愿寺' })
  expect(dialog).toHaveTextContent(closing.text)
  expect(dialog).toHaveTextContent('核实于 2026年11月18日')
  const link = within(dialog).getByRole('link', { name: '来源' })
  expect(link).toHaveAttribute('href', closing.source)
  expect(link).toHaveAttribute('target', '_blank')
  expect(link).toHaveAttribute('rel', 'noopener noreferrer')
  await user.tab()
  expect(link).toHaveFocus()
  await user.keyboard('{Escape}')
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  await waitFor(() => expect(chip).toHaveFocus())
})

it('触屏点按标记打开说明', async () => {
  const { user } = renderWithProviders(<LiveTripPanels tab="plan" data={checked({ level: 'caution', notes: [closing] })} />)
  await user.pointer({ keys: '[TouchA]', target: screen.getByRole('button', { name: '注意' }) })
  expect(await screen.findByRole('dialog', { name: '东本愿寺' })).toHaveTextContent(closing.text)
  expect(screen.queryByRole('tooltip')).toBeNull()
})

it('英文界面按英文格式显示核实日期，每条说明各带来源', async () => {
  const kiosk = { text: 'Most shops are closed on this date', source: 'https://www.tsukiji.or.jp/calendar/', checkedOn: '2026-03-01' }
  const { user } = renderWithProviders(
    <LiveTripPanels tab="plan" data={checked({ level: 'caution', notes: [closing, kiosk] })} />,
    { locale: 'en' },
  )
  await user.click(screen.getByRole('button', { name: 'Caution' }))
  const dialog = await screen.findByRole('dialog', { name: '东本愿寺' })
  expect(dialog).toHaveTextContent('Checked on Nov 18, 2026')
  expect(dialog).toHaveTextContent('Checked on Mar 1, 2026')
  expect(within(dialog).getAllByRole('link', { name: 'Source' }).map((a) => a.getAttribute('href'))).toEqual([closing.source, kiosk.source])
})

it('没有说明的标记只是标签：不能聚焦，悬停和点按都不打开弹层', async () => {
  const { user } = renderWithProviders(<LiveTripPanels tab="plan" data={checked({ level: 'conflict', notes: [] })} />)
  const chip = screen.getByText('冲突')
  expect(screen.queryByRole('button')).toBeNull()
  await user.hover(document.body)
  await user.hover(chip)
  await user.click(chip)
  await user.pointer({ keys: '[TouchA]', target: chip })
  expect(screen.queryByRole('tooltip')).toBeNull()
  expect(screen.queryByRole('dialog')).toBeNull()
  await user.tab()
  expect(document.body).toHaveFocus()
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
