import { screen } from '@testing-library/react'
import { renderWithProviders } from '@/test/render'
import { makeUser } from '@/test/fixtures'
import { AuthGate } from './AuthGate'
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
