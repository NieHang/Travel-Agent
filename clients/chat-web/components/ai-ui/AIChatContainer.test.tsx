import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { AIChatContainer } from './AIChatContainer'
import { api } from '@/features/auth/api-client'
import type { AIUIResponse } from './types'

vi.mock('@/features/auth/api-client', () => ({ api: vi.fn() }))
const reply: AIUIResponse = { message: '请选择旅行类型', intent: 'trip_planning', components: [{ id: 'trip', type: 'selection', purpose: 'trip_type', title: '类型', mode: 'single', options: [{ value: 'solo', label: '独自旅行', description: null }] }] }
beforeEach(() => vi.mocked(api).mockReset())

it('发送文本和 UIAction 使用同一会话，并保留历史且禁用过期组件', async () => {
  const user = userEvent.setup()
  vi.mocked(api).mockResolvedValueOnce(reply).mockResolvedValueOnce({ message: '已选择', intent: 'trip_planning', components: [{ id: 't', type: 'text', content: '继续填写需求', format: 'plain' }] })
  render(<AIChatContainer sessionId="session-1" locale="zh" />)
  await user.type(screen.getByRole('textbox', { name: '消息' }), '帮我规划杭州旅行')
  await user.click(screen.getByRole('button', { name: '发送' }))
  expect(await screen.findByText('请选择旅行类型')).toBeInTheDocument()
  expect(api).toHaveBeenNthCalledWith(1, '/api/ui-chat/chat', expect.objectContaining({ method: 'POST', body: { sessionId: 'session-1', input: '帮我规划杭州旅行', locale: 'zh' } }))
  await user.click(screen.getByRole('button', { name: '独自旅行' }))
  expect(await screen.findByText('已选择')).toBeInTheDocument()
  expect(api).toHaveBeenNthCalledWith(2, '/api/ui-chat/action', expect.objectContaining({ method: 'POST', body: { sessionId: 'session-1', action: { type: 'selection', componentId: 'trip', values: ['solo'] }, locale: 'zh' } }))
  expect(screen.getByText('帮我规划杭州旅行')).toBeInTheDocument()
  expect(screen.getByText('继续填写需求')).toBeInTheDocument()
  expect(screen.getByRole('button', { name: '独自旅行' })).toBeDisabled()
})

it('请求期间阻止重复发送，失败保留输入并允许重试', async () => {
  const user = userEvent.setup()
  let reject!: (reason: Error) => void
  vi.mocked(api).mockReturnValueOnce(new Promise((_, fail) => { reject = fail }))
  render(<AIChatContainer sessionId="session-2" />)
  const input = screen.getByRole('textbox', { name: '消息' })
  await user.type(input, '查询酒店')
  await user.click(screen.getByRole('button', { name: '发送' }))
  expect(screen.getByRole('button', { name: '发送中…' })).toBeDisabled()
  reject(new Error('NETWORK'))
  expect(await screen.findByRole('alert')).toHaveTextContent('请求失败')
  expect(input).toHaveValue('查询酒店')
  vi.mocked(api).mockResolvedValueOnce(reply)
  await user.click(screen.getByRole('button', { name: '发送' }))
  await screen.findByText('请选择旅行类型')
  expect(screen.getAllByText('查询酒店')).toHaveLength(1)
  expect(input).toHaveValue('')
})

it('空输入不发送，无效响应显示错误，切换会话重置历史', async () => {
  const user = userEvent.setup()
  const { rerender } = render(<AIChatContainer sessionId="first" />)
  expect(screen.getByRole('button', { name: '发送' })).toBeDisabled()
  vi.mocked(api).mockResolvedValueOnce({ message: 'broken' })
  await user.type(screen.getByRole('textbox'), '你好')
  await user.click(screen.getByRole('button', { name: '发送' }))
  await screen.findByRole('alert')
  rerender(<AIChatContainer sessionId="second" />)
  await waitFor(() => expect(screen.queryByRole('alert')).toBeNull())
  expect(screen.queryByText('你好')).toBeNull()
})

it('未指定 sessionId 时生成稳定会话 ID，操作失败后组件仍可重试', async () => {
  const user = userEvent.setup()
  vi.mocked(api).mockResolvedValueOnce(reply).mockRejectedValueOnce(new Error('NETWORK')).mockResolvedValueOnce(reply)
  render(<AIChatContainer />)
  await user.type(screen.getByRole('textbox'), '旅行')
  await user.click(screen.getByRole('button', { name: '发送' }))
  await user.click(await screen.findByRole('button', { name: '独自旅行' }))
  await screen.findByRole('alert')
  expect(screen.getByRole('button', { name: '独自旅行' })).toBeEnabled()
  await user.click(screen.getByRole('button', { name: '独自旅行' }))
  await waitFor(() => expect(api).toHaveBeenCalledTimes(3))
  const bodies = vi.mocked(api).mock.calls.map(([, init]) => init?.body as { sessionId: string })
  expect(bodies[0].sessionId).toBeTruthy()
  expect(new Set(bodies.map(body => body.sessionId)).size).toBe(1)
})

it('切换会话取消旧请求，旧响应不会进入新会话历史', async () => {
  const user = userEvent.setup()
  let resolve!: (response: AIUIResponse) => void
  vi.mocked(api).mockReturnValueOnce(new Promise(done => { resolve = done }))
  const { rerender } = render(<AIChatContainer sessionId="old" />)
  await user.type(screen.getByRole('textbox'), '旧会话')
  await user.click(screen.getByRole('button', { name: '发送' }))
  const signal = vi.mocked(api).mock.calls[0][1]?.signal
  rerender(<AIChatContainer sessionId="new" />)
  expect(signal?.aborted).toBe(true)
  resolve(reply)
  await waitFor(() => expect(screen.getByRole('button', { name: '发送' })).toBeDisabled())
  expect(screen.queryByText('请选择旅行类型')).toBeNull()
  expect(screen.queryByText('旧会话')).toBeNull()
})
