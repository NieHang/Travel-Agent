import { act, screen } from '@testing-library/react'
import { renderWithProviders } from '@/test/render'
import { makeUser } from '@/test/fixtures'
import { AuthGate, markSignOutIntent, resetSignOutIntentForTests } from './AuthGate'
import { authStore } from './auth-store'

const replace = vi.fn()
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace, refresh: vi.fn() }),
  usePathname: () => '/chat/abc',
  useSearchParams: () => new URLSearchParams(),
}))

beforeEach(() => {
  authStore.reset()
  replace.mockClear()
  resetSignOutIntentForTests()
})

it('loading：有 role=status，无子内容', () => {
  renderWithProviders(<AuthGate><p>secret</p></AuthGate>)
  expect(screen.getByRole('status')).toBeInTheDocument()
  expect(screen.queryByText('secret')).not.toBeInTheDocument()
  expect(replace).not.toHaveBeenCalled()
})

it('guest：跳登录页并带 next，期间仍显示加载', () => {
  authStore.setGuest()
  renderWithProviders(<AuthGate><p>secret</p></AuthGate>)
  expect(replace).toHaveBeenCalledWith('/login?next=%2Fchat%2Fabc')
  expect(screen.getByRole('status')).toBeInTheDocument()
  expect(screen.queryByText('secret')).not.toBeInTheDocument()
})

it('authed：渲染子内容', () => {
  authStore.setAuthed({ accessToken: 't', user: makeUser() })
  renderWithProviders(<AuthGate><p>secret</p></AuthGate>)
  expect(screen.getByText('secret')).toBeInTheDocument()
  expect(screen.queryByRole('status')).not.toBeInTheDocument()
  expect(replace).not.toHaveBeenCalled()
})

it('有退出意图时 guest 跳 /，意图不泄漏到之后的 guest 转换', () => {
  authStore.setAuthed({ accessToken: 't', user: makeUser() })
  const first = renderWithProviders(<AuthGate><p>secret</p></AuthGate>)
  markSignOutIntent()
  act(() => authStore.setGuest())
  expect(replace).toHaveBeenCalledTimes(1)
  expect(replace).toHaveBeenCalledWith('/')
  first.unmount()
  replace.mockClear()

  // 之后重新登录再被登出（例如其他标签页）：没有意图，回登录页
  authStore.setAuthed({ accessToken: 't', user: makeUser() })
  renderWithProviders(<AuthGate><p>secret</p></AuthGate>)
  act(() => authStore.setGuest())
  expect(replace).toHaveBeenCalledTimes(1)
  expect(replace).toHaveBeenCalledWith('/login?next=%2Fchat%2Fabc')
})
