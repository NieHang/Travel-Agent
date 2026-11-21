import { screen } from '@testing-library/react'
import { renderWithProviders } from '@/test/render'
import { MessageBubble } from './MessageBubble'

it('用户消息保留换行', () => {
  renderWithProviders(<MessageBubble role="USER" content={'第一行\n第二行'} />)
  const bubble = screen.getByText(/第一行/)
  expect(bubble).toHaveStyle({ whiteSpace: 'pre-wrap' })
  expect(bubble.textContent).toBe('第一行\n第二行')
})

const trace = {
  steps: [
    { phase: 'understanding' as const, at: '2026-11-15T09:27:47.000Z' },
    { phase: 'searching' as const, at: '2026-11-15T09:27:48.500Z' },
    { phase: 'writing' as const, at: '2026-11-15T09:27:59.800Z' },
  ],
  endedAt: '2026-11-15T09:28:04.300Z',
  verification: {
    lookups: [{ tool: 'mcp_rollingGo_searchHotels', subject: '大阪酒店 · 12/20–12/22', at: '2026-11-15T09:27:52.000Z', ok: true, count: 8 }],
    reading: [],
    grounding: { kept: 3, dropped: 1 },
  },
}

it('已完成：收成「用时」一行，展开后是各阶段与数据核验', async () => {
  const { user } = renderWithProviders(<MessageBubble role="ASSISTANT" content="大阪 2 晚" trace={trace} />)
  await user.click(screen.getByRole('button', { name: /用时 17 秒/ }))
  expect(screen.getByText('理解需求')).toBeVisible()
  expect(screen.getByText('11 秒')).toBeVisible()
  expect(screen.getByText(/大阪酒店 · 12\/20–12\/22 · 查询于 .+ · 8 条结果/)).toBeVisible()
  expect(screen.getByText('3 条结果与查询数据一致，1 条未通过核对')).toBeVisible()
  expect(screen.queryByText(/已查阅/)).not.toBeInTheDocument()
})

const kyoto = [
  { id: 'kyoto', title: '京都' },
  { id: 'kyoto/higashiyama', title: '东山' },
  { id: 'kyoto/kiyomizu-dera', title: '清水寺' },
]

it('只读了资料页（没有查询和核对）：数据核验里列出页面标题', async () => {
  const { user } = renderWithProviders(
    <MessageBubble role="ASSISTANT" content="京都 1 天" trace={{ ...trace, verification: { lookups: [], reading: kyoto, grounding: null } }} />,
  )
  await user.click(screen.getByRole('button', { name: /用时 17 秒/ }))
  expect(screen.getByText('数据核验')).toBeVisible()
  expect(screen.getByText('已查阅京都、东山和清水寺')).toBeVisible()
})

it('读了很多页面：只列前 8 个标题，其余计数', async () => {
  const reading = Array.from({ length: 40 }, (_, i) => ({ id: `kyoto/place-${i + 1}`, title: `地点${i + 1}` }))
  const { user } = renderWithProviders(
    <MessageBubble role="ASSISTANT" content="京都 5 天" trace={{ ...trace, verification: { lookups: [], reading, grounding: null } }} />,
  )
  await user.click(screen.getByRole('button', { name: /用时 17 秒/ }))
  expect(screen.getByText('已查阅地点1、地点2、地点3、地点4、地点5、地点6、地点7、地点8和其余 32 项')).toBeVisible()
})

it('英文界面：页面标题与其余计数', async () => {
  const reading = [
    'Kyoto', 'Higashiyama', 'Fushimi', 'Autumn leaves', 'Kiyomizu-dera', 'Tofuku-ji', 'Fushimi Inari Taisha', 'Higashi Hongan-ji', 'Kinkaku-ji', 'Arashiyama',
  ].map((title) => ({ id: `kyoto/${title}`, title }))
  const { user } = renderWithProviders(
    <MessageBubble role="ASSISTANT" content="Kyoto, 5 days" trace={{ ...trace, verification: { lookups: [], reading, grounding: null } }} />,
    { locale: 'en' },
  )
  await user.click(screen.getByRole('button', { name: /Took 17s/ }))
  expect(
    screen.getByText('Consulted Kyoto, Higashiyama, Fushimi, Autumn leaves, Kiyomizu-dera, Tofuku-ji, Fushimi Inari Taisha, Higashi Hongan-ji, and 2 more'),
  ).toBeVisible()
})

it('已完成但没有过程记录（旧消息、按钮回合）：不显示过程行', () => {
  renderWithProviders(<MessageBubble role="ASSISTANT" content="好的" />)
  expect(screen.queryByText(/用时|已停止|生成失败/)).not.toBeInTheDocument()
})

it('已停止：写明停在哪个阶段，并可继续生成', async () => {
  const onResume = vi.fn()
  const { user } = renderWithProviders(
    <MessageBubble role="ASSISTANT" content="" status="partial" trace={{ steps: trace.steps.slice(0, 2), endedAt: trace.endedAt }} onResume={onResume} />,
  )
  expect(screen.getByText('已停止 · 查询实时数据')).toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: '继续生成' }))
  expect(onResume).toHaveBeenCalledOnce()
})

it('生成失败且没有过程记录：仍在气泡里标注，并可重试', () => {
  renderWithProviders(<MessageBubble role="ASSISTANT" content="" status="error" onResume={vi.fn()} />)
  expect(screen.getByText('生成失败').closest('[data-bubble]')).not.toBeNull()
  expect(screen.getByRole('button', { name: '重试' })).toBeInTheDocument()
})

it('生成中且还没有文字：列出已到达的阶段，最后一个为进行中', () => {
  renderWithProviders(<MessageBubble role="ASSISTANT" content="" status="running" trace={{ steps: trace.steps.slice(0, 2) }} />)
  const list = screen.getByRole('status')
  expect(list).toHaveTextContent('理解需求')
  expect(screen.getByText('查询实时数据')).toHaveClass('trace-shimmer')
})

const buttons = { type: 'buttons', buttons: [{ command: 'confirm', label: '确认路线' }] }

it('组件在助手消息下渲染，live 时可操作并发送命令', async () => {
  const onCommand = vi.fn()
  const { user } = renderWithProviders(
    <MessageBubble role="ASSISTANT" content="草稿" components={[buttons]} mode={{ kind: 'live', onCommand }} />,
  )
  await user.click(screen.getByRole('button', { name: '确认路线' }))
  expect(onCommand).toHaveBeenCalledWith({ type: 'confirm' })
})

it('默认锁定（旧版本或生成中）时组件只读', () => {
  renderWithProviders(<MessageBubble role="ASSISTANT" content="草稿" components={[buttons]} />)
  expect(screen.getByRole('button', { name: '确认路线' })).toBeDisabled()
})

it('文字和组件在同一个气泡里', () => {
  renderWithProviders(<MessageBubble role="ASSISTANT" content="草稿" components={[buttons]} mode={{ kind: 'live', onCommand: vi.fn() }} />)
  const bubble = screen.getByText('草稿').closest('[data-bubble]')
  expect(bubble).toContainElement(screen.getByRole('button', { name: '确认路线' }))
})

it('已回答的按钮收起后，气泡里只剩文字', () => {
  renderWithProviders(<MessageBubble role="ASSISTANT" content="草稿" components={[buttons]} mode={{ kind: 'answered', command: { type: 'confirm' } }} />)
  expect(screen.queryByRole('button')).toBeNull()
  expect(screen.getByText('草稿').closest('[data-bubble]')!.textContent).toBe('草稿')
})
