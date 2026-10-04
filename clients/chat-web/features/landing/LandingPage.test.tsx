import { act, fireEvent, screen, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { authStore } from '@/features/auth/auth-store'
import { peekPendingPrompt } from '@/features/auth/pending-prompt'
import { makeConversation, makeUser } from '@/test/fixtures'
import { renderWithProviders } from '@/test/render'
import { server, apiUrl } from '@/test/server'
import { LandingPage } from './LandingPage'
const nav = vi.hoisted(() => ({ push: vi.fn(), refresh: vi.fn() }))
vi.mock('next/navigation', () => ({ useRouter: () => nav }))
const toast = vi.hoisted(() => vi.fn())
vi.mock('@/components/ui/toast', () => ({ toast }))
beforeEach(() => { authStore.setGuest(); nav.push.mockClear(); toast.mockClear() })
afterEach(() => { authStore.reset(); vi.restoreAllMocks() })
it('鉴权状态决定入口：登录、进入对话或骨架', () => {
  const { rerender } = renderWithProviders(<LandingPage />)
  expect(screen.getByRole('link', { name: '登录' })).toHaveAttribute('href', '/login')
  act(() => authStore.setAuthed({ accessToken: 't', user: makeUser() }))
  expect(screen.getByRole('link', { name: '进入对话' })).toHaveAttribute('href', '/chat')
  act(() => authStore.reset())
  expect(screen.queryByRole('link', { name: '登录' })).not.toBeInTheDocument()
  expect(screen.getByTestId('auth-entry-skeleton')).toBeInTheDocument()
})
it('空输入不可提交，chip 填入并聚焦，不跳转', async () => {
  const { user } = renderWithProviders(<LandingPage />)
  const input = screen.getByRole('textbox')
  expect(screen.getByRole('button', { name: '开始规划' })).toBeDisabled()
  await user.type(input, '   ')
  expect(screen.getByRole('button', { name: '开始规划' })).toBeDisabled()
  await user.click(screen.getByRole('button', { name: '里斯本 5 天' }))
  expect(input).toHaveValue('里斯本 5 天'); expect(input).toHaveFocus(); expect(nav.push).not.toHaveBeenCalled()
})
it('未登录普通回车暂存并跳转；输入法组字不提交', async () => {
  const { user } = renderWithProviders(<LandingPage />)
  const input = screen.getByRole('textbox')
  await user.type(input, '  里斯本 5 天  ')
  fireEvent.keyDown(input, { key: 'Enter', isComposing: true })
  expect(nav.push).not.toHaveBeenCalled()
  fireEvent.keyDown(input, { key: 'Enter' })
  expect(peekPendingPrompt()).toEqual({ prompt: '里斯本 5 天' })
  expect(nav.push).toHaveBeenCalledWith('/login?next=/chat')
  expect(input).toHaveAttribute('maxlength', '4000')
})
it('已登录创建会话期间阻止重复提交，成功暂存目标会话', async () => {
  authStore.setAuthed({ accessToken: 't', user: makeUser() })
  let release!: () => void; const gate = new Promise<void>((resolve) => { release = resolve })
  let calls = 0
  server.use(http.post(apiUrl('/api/conversations'), async () => { calls++; await gate; return HttpResponse.json(makeConversation({ id: 'new-id' })) }))
  const { user } = renderWithProviders(<LandingPage />)
  await user.type(screen.getByRole('textbox'), '京都')
  await user.keyboard('{Enter}{Enter}')
  await waitFor(() => expect(calls).toBe(1))
  expect(screen.getByRole('button', { name: '开始规划' })).toHaveAttribute('aria-busy', 'true')
  act(() => release())
  await waitFor(() => expect(nav.push).toHaveBeenCalledWith('/chat/new-id'))
  expect(peekPendingPrompt()).toEqual({ prompt: '京都', conversationId: 'new-id' })
})
it('创建失败保留输入、提示失败，不跳转不暂存', async () => {
  authStore.setAuthed({ accessToken: 't', user: makeUser() })
  server.use(http.post(apiUrl('/api/conversations'), () => HttpResponse.json({ code: 'INTERNAL_ERROR' }, { status: 500 })))
  const { user } = renderWithProviders(<LandingPage />)
  await user.type(screen.getByRole('textbox'), '京都'); await user.keyboard('{Enter}')
  await waitFor(() => expect(toast).toHaveBeenCalledWith('发送失败，请重试', { tone: 'danger' }))
  expect(screen.getByRole('textbox')).toHaveValue('京都'); expect(nav.push).not.toHaveBeenCalled(); expect(peekPendingPrompt()).toBeNull()
})
it('存储不可用仍跳转，装饰卡片对读屏隐藏', async () => {
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('blocked') })
  const { user } = renderWithProviders(<LandingPage />)
  await user.type(screen.getByRole('textbox'), '京都'); await user.keyboard('{Enter}')
  expect(nav.push).toHaveBeenCalledWith('/login?next=/chat')
  expect(screen.getByTestId('floating-cards')).toHaveAttribute('aria-hidden', 'true')
})
