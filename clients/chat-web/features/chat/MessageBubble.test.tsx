import { screen } from '@testing-library/react'
import { renderWithProviders } from '@/test/render'
import { MessageBubble } from './MessageBubble'

it('用户消息保留换行', () => {
  renderWithProviders(<MessageBubble role="USER" content={'第一行\n第二行'} />)
  const bubble = screen.getByText(/第一行/)
  expect(bubble).toHaveStyle({ whiteSpace: 'pre-wrap' })
  expect(bubble.textContent).toBe('第一行\n第二行')
})

it('partial：下方标注「已停止」；error：标注「生成失败」', () => {
  const { rerender } = renderWithProviders(
    <MessageBubble role="ASSISTANT" content="好的" status="partial" />,
  )
  expect(screen.getByText('已停止')).toBeInTheDocument()
  expect(screen.queryByText('生成失败')).not.toBeInTheDocument()
  rerender(<MessageBubble role="ASSISTANT" content="好的" status="error" />)
  expect(screen.getByText('生成失败')).toBeInTheDocument()
  expect(screen.queryByText('已停止')).not.toBeInTheDocument()
})

it('complete 的助手消息没有标注', () => {
  renderWithProviders(<MessageBubble role="ASSISTANT" content="好的" />)
  expect(screen.queryByText('已停止')).not.toBeInTheDocument()
  expect(screen.queryByText('生成失败')).not.toBeInTheDocument()
})

it('内容为空的 error 消息只显示标注', () => {
  const { container } = renderWithProviders(
    <MessageBubble role="ASSISTANT" content="" status="error" />,
  )
  expect(screen.getByText('生成失败')).toBeInTheDocument()
  expect(container.querySelector('[data-bubble]')).toBeNull()
})

it('typing：显示三点跳动，读屏标签为「正在输入…」', () => {
  renderWithProviders(<MessageBubble role="ASSISTANT" content="" typing />)
  expect(screen.getByRole('status', { name: '正在输入…' })).toBeInTheDocument()
})

it('metadata.requirements 两条：两张卡片，标题为 action，副标题为 constraints 用「 · 」连接', () => {
  renderWithProviders(
    <MessageBubble
      role="ASSISTANT"
      content="好的"
      requirements={[
        { action: '规划里斯本行程', constraints: ['5 天', '预算 3000'], entities: [] },
        { action: '订酒店', constraints: ['150 欧以内'], entities: [] },
      ]}
    />,
  )
  expect(screen.getByText('规划里斯本行程')).toBeInTheDocument()
  expect(screen.getByText('5 天 · 预算 3000')).toBeInTheDocument()
  expect(screen.getByText('订酒店')).toBeInTheDocument()
  expect(screen.getByText('150 欧以内')).toBeInTheDocument()
})

it('constraints 为空：没有副标题', () => {
  const { container } = renderWithProviders(
    <MessageBubble
      role="ASSISTANT"
      content="好的"
      requirements={[{ action: '订酒店', constraints: [], entities: [] }]}
    />,
  )
  expect(screen.getByText('订酒店')).toBeInTheDocument()
  expect(container.querySelectorAll('[data-requirement] p')).toHaveLength(1)
})
