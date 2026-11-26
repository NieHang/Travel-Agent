import { fireEvent, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ResultItem, TripView } from '@autix/contracts'
import { Toaster } from '@/components/ui/toast'
import { makeTripView } from '@/test/fixtures'
import { renderWithProviders } from '@/test/render'
import { LiveTripPanels } from './LiveTripPanels'
import { MobileTrip } from './MobileTrip'
import { panelTabs } from './tabs'
import { PanelTabs, SaveTripButton } from './TripPanels'

type Day = TripView['days'][number]
type Stop = Day['stops'][number]

const hotel = (ref: string, name: string): ResultItem => ({
  ref, id: null, title: { original: name, translation: null }, address: null,
  price: { amount: 118, currency: 'EUR' }, rating: null, url: 'https://rollinggo.ai/h/1', image: null,
  details: [], amenities: [{ original: 'Kitchen', translation: '厨房' }], summary: null,
})
const stop = (over: Partial<Stop> & { name: string }): Stop => ({ note: null, time: null, hours: null, transit: null, image: null, ...over })

const granvia: ResultItem = {
  ...hotel('h1', 'Hotel Granvia Kyoto'),
  price: { amount: 1385, currency: 'CNY' },
  details: [{ label: '早餐', value: { original: 'Included', translation: '含早' } }],
}
const kyoto = makeTripView({
  destination: '京都',
  departureDate: '2026-11-22',
  returnDate: '2026-11-26',
  travelers: 1,
  tip: '红叶季人多：清水寺、东福寺一带早出门',
  todos: [
    { kind: 'reserve', title: '二条城本丸御殿', note: '网上订指定时段门票' },
    { kind: 'on_arrival', title: '买交通 IC 卡', note: null },
  ],
  days: [
    {
      title: '第 1 天 | 京都站周边 · 东本愿寺（轻松）',
      heading: '京都站周边 · 东本愿寺',
      pace: 'light',
      stops: [
        stop({ name: '抵达京都站', time: '下午', note: '办好入住，稍作休息', transit: '步行，或坐地铁' }),
        stop({ name: '东本愿寺', time: '16:30', hours: { text: '开放 6:20–16:30', late: true }, transit: '步行回京都站' }),
        stop({ name: '京都站附近晚饭', hours: { text: '营业至 22:00', late: false } }),
      ],
      stay: granvia,
    },
    {
      title: '第 2 天 | 伏见稻荷大社 · 东福寺',
      heading: '伏见稻荷大社 · 东福寺',
      pace: 'standard',
      stops: [stop({ name: '伏见稻荷大社', time: '07:30' })],
      stay: granvia,
    },
  ],
  stayPlan: [{ nights: { from: 0, to: 3 }, stay: granvia, options: [granvia] }],
  hotels: [granvia],
})

it('保存按钮提供即将上线提示', async () => {
  const { user } = renderWithProviders(<><Toaster /><SaveTripButton /></>)
  await user.click(screen.getByRole('button', { name: '保存行程' }))
  expect(await screen.findByText('保存行程即将上线')).toBeInTheDocument()
})

describe('行程页', () => {
  it('封面显示目的地、状态和日期 · 人数 · 晚数；京都用封面照片', () => {
    const { container } = renderWithProviders(<LiveTripPanels tab="plan" data={kyoto} conversationId="c-cover" />)
    expect(screen.getByRole('heading', { name: '京都', level: 2 })).toBeInTheDocument()
    expect(screen.getByText('行程草稿')).toBeInTheDocument()
    expect(screen.getByText('11月22日 – 26日 · 1 人 · 4 晚不换酒店')).toBeInTheDocument()
    const outsideMap = [...container.querySelectorAll('img')].filter((img) => !screen.getByTestId('day-map').contains(img))
    expect(outsideMap.map((img) => img.getAttribute('src'))).toEqual([expect.stringContaining('kyoto.webp')])
  })

  it('其他目的地用纯色封面，跨月日期写出月份', () => {
    const lisbon = makeTripView({ departureDate: '2026-11-30', returnDate: '2026-12-02', travelers: 2 })
    const { container } = renderWithProviders(<LiveTripPanels tab="plan" data={lisbon} conversationId="c-plain" />, { locale: 'en' })
    expect(screen.getByRole('heading', { name: '里斯本' })).toBeInTheDocument()
    expect(screen.getByText('November 30 – December 2 · 2 travelers · 2 nights')).toBeInTheDocument()
    expect(container.querySelector('img')).toBeNull()
  })

  it('按出发日期列出每天的星期和日期，切换后显示那一天', async () => {
    const { user } = renderWithProviders(<LiveTripPanels tab="plan" data={kyoto} conversationId="c-days" />)
    const days = within(screen.getByRole('radiogroup', { name: '选择哪一天' })).getAllByRole('radio')
    expect(days.map((d) => d.textContent)).toEqual(['周日22', '周一23'])
    expect(days[0]).toHaveAttribute('aria-checked', 'true')
    expect(screen.getByText('第 1 天 · 轻松')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: '京都站周边 · 东本愿寺' })).toBeInTheDocument()
    await user.click(days[1])
    expect(screen.getByText('第 2 天 · 标准')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: '伏见稻荷大社 · 东福寺' })).toBeInTheDocument()
    expect(screen.queryByText('东本愿寺')).toBeNull()
  })

  it('时间圈：钟点上方标出时段，文字照写，没有时间时显示序号', () => {
    renderWithProviders(<LiveTripPanels tab="plan" data={{ ...kyoto, todos: [] }} conversationId="c-time" />)
    const [timeline] = screen.getAllByRole('list')
    const circles = within(timeline).getAllByRole('listitem').map((item) => item.firstElementChild?.textContent)
    expect(circles).toEqual(['下午', '下午16:30', '3'])
  })

  it('到达时已过关门时间的开放时间用强调色并注明；交通写在卡片下方', () => {
    renderWithProviders(<LiveTripPanels tab="plan" data={kyoto} conversationId="c-hours" />)
    const late = screen.getByText('开放 6:20–16:30 · 到达时已到关门时间')
    expect(late).toHaveClass('text-trip-accent')
    const onTime = screen.getByText('营业至 22:00')
    expect(onTime).toHaveClass('text-trip-muted')
    expect(screen.getByText('步行回京都站')).toBeInTheDocument()
    expect(screen.getByText('步行，或坐地铁')).toBeInTheDocument()
  })

  it('有提示时显示提示，没有时不显示', () => {
    const { rerender } = renderWithProviders(<LiveTripPanels tab="plan" data={kyoto} conversationId="c-tip" />)
    expect(screen.getByText('红叶季人多：清水寺、东福寺一带早出门')).toBeInTheDocument()
    rerender(<LiveTripPanels tab="plan" data={{ ...kyoto, tip: null, todos: [] }} conversationId="c-tip" />)
    expect(screen.queryByText('红叶季人多：清水寺、东福寺一带早出门')).toBeNull()
    expect(screen.queryByRole('heading', { name: '出发前要办' })).toBeNull()
  })

  it('日程地图标出当天每一站的名字，知识库有配图的站带照片', () => {
    const day = { ...kyoto.days[0], stops: kyoto.days[0].stops.map((s) => (s.name === '东本愿寺' ? { ...s, image: '/places/kyoto/higashi-hongan-ji.webp' } : s)) }
    renderWithProviders(<LiveTripPanels tab="plan" data={{ ...kyoto, days: [day] }} conversationId="c-map-pins" />)
    const map = screen.getByTestId('day-map')
    for (const name of ['抵达京都站', '东本愿寺', '京都站附近晚饭']) expect(within(map).getByText(name)).toBeInTheDocument()
    const photos = [...map.querySelectorAll('img')]
    expect(photos).toHaveLength(1)
    expect(decodeURIComponent(photos[0].getAttribute('src') ?? '')).toContain('/places/kyoto/higashi-hongan-ji.webp')
    expect(within(map).getByText('东本愿寺').parentElement).toContainElement(photos[0])
  })

  it('站点照片加载失败时只留名字', () => {
    const day = { ...kyoto.days[0], stops: kyoto.days[0].stops.map((s) => ({ ...s, image: '/places/kyoto/missing.webp' })) }
    renderWithProviders(<LiveTripPanels tab="plan" data={{ ...kyoto, days: [day] }} conversationId="c-map-error" />)
    const map = screen.getByTestId('day-map')
    fireEvent.error(map.querySelectorAll('img')[1])
    expect(map.querySelectorAll('img')).toHaveLength(2)
    expect(within(map).getByText('东本愿寺').parentElement?.querySelector('img')).toBeNull()
  })

  it('住宿卡片列出酒店的全部设施', () => {
    const amenities = ['客房WIFI（免费）', '行李寄存', '24小时前台', '餐厅', '洗衣设施', '电梯'].map((original) => ({ original, translation: null }))
    const day = { ...kyoto.days[0], stay: { ...granvia, amenities } }
    renderWithProviders(<LiveTripPanels tab="plan" data={{ ...kyoto, days: [day] }} conversationId="c-amenities" />)
    const list = screen.getByRole('list', { name: '设施' })
    expect(within(list).getAllByRole('listitem').map((li) => li.textContent)).toEqual(['客房WIFI（免费）', '行李寄存', '24小时前台', '餐厅', '洗衣设施', '电梯'])
  })

  it('住宿卡片显示当晚酒店、每晚价格、入住退房日期和详情', () => {
    renderWithProviders(<LiveTripPanels tab="plan" data={kyoto} conversationId="c-stay" />)
    const stay = screen.getByRole('region', { name: '住宿' })
    expect(within(stay).getByText('Hotel Granvia Kyoto')).toBeInTheDocument()
    expect(within(stay).getByText('4 晚不换酒店')).toBeInTheDocument()
    expect(within(stay).getByText(/1,385/)).toHaveTextContent('¥1,385每晚')
    const facts = within(stay).getAllByRole('definition').map((dd) => [dd.previousElementSibling?.textContent, dd.textContent])
    expect(facts).toEqual([['入住', '11月22日'], ['退房', '11月26日'], ['早餐', '含早']])
  })
})

describe('出发前要办', () => {
  it('勾选一项后计数增加，并按对话记在本机', async () => {
    const user = userEvent.setup()
    const { unmount } = renderWithProviders(<LiveTripPanels tab="plan" data={kyoto} conversationId="c-check" />)
    const list = screen.getByRole('region', { name: '出发前要办' })
    expect(within(list).getByText('已完成 0 / 2')).toBeInTheDocument()
    const item = within(list).getByRole('button', { name: /二条城本丸御殿/ })
    expect(item).toHaveTextContent('需预约 · 网上订指定时段门票')
    expect(within(list).getByRole('button', { name: /买交通 IC 卡/ })).toHaveTextContent('到达后')
    expect(item).toHaveAttribute('aria-pressed', 'false')
    await user.click(item)
    expect(item).toHaveAttribute('aria-pressed', 'true')
    expect(within(list).getByText('已完成 1 / 2')).toBeInTheDocument()
    expect(JSON.parse(localStorage.getItem('hilda:checklist:c-check') ?? 'null')).toEqual(['二条城本丸御殿'])
    unmount()

    renderWithProviders(<LiveTripPanels tab="plan" data={kyoto} conversationId="c-check" />)
    expect(screen.getByRole('button', { name: /二条城本丸御殿/ })).toHaveAttribute('aria-pressed', 'true')
    await user.click(screen.getByRole('button', { name: /二条城本丸御殿/ }))
    expect(screen.getByRole('button', { name: /二条城本丸御殿/ })).toHaveAttribute('aria-pressed', 'false')
    expect(JSON.parse(localStorage.getItem('hilda:checklist:c-check') ?? 'null')).toEqual([])
  })

  it('另一段对话的勾选互不影响', () => {
    localStorage.setItem('hilda:checklist:c-other-a', JSON.stringify(['二条城本丸御殿']))
    renderWithProviders(<LiveTripPanels tab="plan" data={kyoto} conversationId="c-other-b" />)
    expect(screen.getByRole('button', { name: /二条城本丸御殿/ })).toHaveAttribute('aria-pressed', 'false')
  })

  it('本机存储不可用时仍能勾选', async () => {
    const user = userEvent.setup()
    const spy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('blocked', 'SecurityError')
    })
    renderWithProviders(<LiveTripPanels tab="plan" data={kyoto} conversationId="c-blocked" />)
    await user.click(screen.getByRole('button', { name: /二条城本丸御殿/ }))
    expect(screen.getByRole('button', { name: /二条城本丸御殿/ })).toHaveAttribute('aria-pressed', 'true')
    spy.mockRestore()
  })
})

describe('手机底部面板', () => {
  it('封面下是行程、清单、酒店三个标签；有路线结果时多一个路线标签', () => {
    const { rerender } = renderWithProviders(<MobileTrip data={kyoto} conversationId="c-tabs" />)
    const tabs = () => within(screen.getByRole('tablist', { name: '你的行程' })).getAllByRole('tab').map((tab) => tab.textContent)
    expect(tabs()).toEqual(['行程', '清单', '酒店'])
    expect(screen.getByRole('button', { name: '保存行程' })).toBeInTheDocument()
    rerender(<MobileTrip data={{ ...kyoto, routes: [hotel('r1', 'Philosopher’s Path')] }} conversationId="c-tabs" />)
    expect(tabs()).toEqual(['行程', '清单', '酒店', '路线'])
  })

  it('行程页只显示一行提醒，点开后进入清单标签', async () => {
    const { user } = renderWithProviders(<MobileTrip data={kyoto} conversationId="c-remind" />)
    expect(screen.queryByRole('region', { name: '出发前要办' })).toBeNull()
    await user.click(screen.getByRole('button', { name: /还有 2 项未完成/ }))
    expect(screen.getByRole('tab', { name: '清单' })).toHaveAttribute('aria-selected', 'true')
    await user.click(screen.getByRole('button', { name: /买交通 IC 卡/ }))
    expect(screen.getByText('已完成 1 / 2')).toBeInTheDocument()
    await user.click(screen.getByRole('tab', { name: '行程' }))
    expect(screen.getByRole('button', { name: /还有 1 项未完成/ })).toBeInTheDocument()
  })
})

it('桌面顶栏的标签同手机一样只在有结果时给出路线和热点，清单留在行程页里', () => {
  const tabs = () => within(screen.getByRole('tablist', { name: '你的行程' })).getAllByRole('tab').map((tab) => tab.textContent)
  const { rerender } = renderWithProviders(<PanelTabs tabs={panelTabs(kyoto)} tab="plan" onChange={() => {}} />)
  expect(tabs()).toEqual(['行程', '酒店'])
  rerender(<PanelTabs tabs={panelTabs({ ...kyoto, routes: [hotel('r1', 'Philosopher’s Path')], hotspots: [hotel('s1', 'Nishiki Market')] })} tab="plan" onChange={() => {}} />)
  expect(tabs()).toEqual(['行程', '酒店', '路线', '热点'])
})

describe('草稿与空态', () => {
  it('草稿生成时行程页显示正在写的草稿，完成后按天显示', () => {
    const { rerender } = renderWithProviders(<LiveTripPanels tab="plan" data={null} draft={'## 正在写\n\n第 1 天'} conversationId="c-draft" />)
    expect(screen.getByRole('heading', { name: '正在写' })).toBeInTheDocument()
    rerender(<LiveTripPanels tab="plan" data={kyoto} conversationId="c-draft" />)
    expect(screen.queryByRole('heading', { name: '正在写' })).toBeNull()
    expect(screen.getByRole('heading', { name: '京都站周边 · 东本愿寺' })).toBeInTheDocument()
  })

  it('还没有按天拆分时显示行程全文，没有全文时显示尚无草稿', () => {
    const collecting = makeTripView({ status: 'collecting', destination: '杭州', itineraryMarkdown: null })
    const { rerender } = renderWithProviders(<LiveTripPanels tab="plan" data={collecting} conversationId="c-md" />)
    expect(screen.getByText('完善需求中')).toBeInTheDocument()
    expect(screen.getByText('尚无行程草稿')).toBeInTheDocument()
    rerender(<LiveTripPanels tab="plan" data={{ ...collecting, status: 'draft', itineraryMarkdown: '## 杭州行程草稿' }} conversationId="c-md" />)
    expect(screen.getByRole('heading', { name: '杭州行程草稿' })).toBeInTheDocument()
  })

  it('没有数据时显示空态', () => {
    renderWithProviders(<LiveTripPanels tab="hotels" data={null} conversationId={null} />)
    expect(screen.getByRole('heading', { name: '你的行程' })).toBeInTheDocument()
    expect(screen.getByText('还没有行程')).toBeInTheDocument()
  })
})

const lisbon = makeTripView({
  itineraryMarkdown: '## 里斯本行程草稿',
  hotels: [hotel('h1', 'Casa do Fado'), hotel('h2', 'Old Town Rooms')],
})
const drafted: TripView = {
  ...lisbon,
  stayPlan: [{ nights: { from: 0, to: 1 }, stay: hotel('h1', 'Casa do Fado'), options: [hotel('h1', 'Casa do Fado'), hotel('h2', 'Old Town Rooms')] }],
}

it('有行程时酒店页按连续的晚上分组，选另一家酒店会发出 choose_stay', async () => {
  const user = userEvent.setup()
  const onCommand = vi.fn()
  const { rerender } = renderWithProviders(<LiveTripPanels tab="hotels" data={drafted} onCommand={onCommand} conversationId="c-hotels" />)
  const group = screen.getByRole('radiogroup', { name: '第 1–2 晚' })
  const radios = screen.getAllByRole('radio')
  expect(group).toContainElement(radios[0])
  expect(radios[0]).toHaveAttribute('aria-checked', 'true')
  expect(radios[0]).toBeDisabled()
  await user.click(radios[1])
  expect(onCommand).toHaveBeenCalledWith({ type: 'choose_stay', ref: 'h2', nights: { from: 0, to: 1 } })
  // The selection follows the server, not the click.
  expect(radios[1]).toHaveAttribute('aria-checked', 'false')
  rerender(<LiveTripPanels tab="hotels" data={drafted} onCommand={onCommand} busy conversationId="c-hotels" />)
  expect(screen.getAllByRole('radio')[1]).toBeDisabled()
})

it('酒店页用卡片列表，可选择，并显示所选酒店的价格和预订', async () => {
  const user = userEvent.setup()
  renderWithProviders(<LiveTripPanels tab="hotels" data={lisbon} conversationId="c-list" />)
  const radios = within(screen.getByRole('radiogroup', { name: '酒店' })).getAllByRole('radio')
  expect(radios).toHaveLength(2)
  expect(radios[0]).toHaveAttribute('aria-checked', 'true')
  await user.click(radios[1])
  expect(radios[1]).toHaveAttribute('aria-checked', 'true')
  expect(screen.getByRole('link', { name: /Old Town Rooms/ })).toHaveAttribute('href', 'https://rollinggo.ai/h/1')
})

it('路线页的结果可用键盘选择，价格随所选结果变化', async () => {
  const user = userEvent.setup()
  const route = (ref: string, name: string, amount: number): ResultItem => ({ ...hotel(ref, name), amenities: [], price: { amount, currency: 'EUR' } })
  renderWithProviders(<LiveTripPanels tab="routes" data={{ ...lisbon, routes: [route('r1', 'Alfama walk', 118), route('r2', 'Belém by tram', 240)] }} conversationId="c-routes" />)
  const radios = within(screen.getByRole('radiogroup', { name: '路线' })).getAllByRole('radio')
  expect(screen.getByText('€118')).toBeInTheDocument()
  await user.tab()
  await user.tab()
  expect(radios[1]).toHaveFocus()
  await user.keyboard('{Enter}')
  expect(radios[1]).toHaveAttribute('aria-checked', 'true')
  expect(screen.getByText('€240')).toBeInTheDocument()
  expect(screen.queryByText('€118')).toBeNull()
})
