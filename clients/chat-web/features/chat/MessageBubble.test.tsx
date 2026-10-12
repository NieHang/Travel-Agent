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

const buttons = { type: 'buttons', buttons: [{ command: 'confirm', label: '确认路线' }] }

it('组件在助手消息下渲染，有 onCommand 时可操作并发送命令', async () => {
  const onCommand = vi.fn()
  const { user } = renderWithProviders(
    <MessageBubble role="ASSISTANT" content="草稿" components={[buttons]} onCommand={onCommand} />,
  )
  await user.click(screen.getByRole('button', { name: '确认路线' }))
  expect(onCommand).toHaveBeenCalledWith({ type: 'confirm' })
})

it('没有 onCommand（旧版本或生成中）时组件只读', () => {
  renderWithProviders(<MessageBubble role="ASSISTANT" content="草稿" components={[buttons]} />)
  expect(screen.getByRole('button', { name: '确认路线' })).toBeDisabled()
})
