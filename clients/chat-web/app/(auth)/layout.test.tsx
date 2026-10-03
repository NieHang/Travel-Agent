import { screen } from '@testing-library/react'
import { renderWithProviders } from '@/test/render'
import { makeUser } from '@/test/fixtures'
import { authStore } from '@/features/auth/auth-store'
import AuthLayout from './layout'

const replace = vi.fn()
let search = new URLSearchParams()
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace, refresh: vi.fn() }),
  useSearchParams: () => search,
}))

function setup() {
  return renderWithProviders(
    <AuthLayout>
      <p>form-children</p>
    </AuthLayout>,
  )
}

beforeEach(() => {
  authStore.reset()
  replace.mockClear()
  search = new URLSearchParams()
})

const authed = () => authStore.setAuthed({ accessToken: 't', user: makeUser() })

it('authed 且 next=/chat/abc：跳转，不渲染子内容', () => {
  search = new URLSearchParams('next=/chat/abc')
  authed()
  setup()
  expect(replace).toHaveBeenCalledWith('/chat/abc')
  expect(screen.queryByText('form-children')).not.toBeInTheDocument()
})

it('authed 无 next：跳 /chat', () => {
  authed()
  setup()
  expect(replace).toHaveBeenCalledWith('/chat')
})

it('authed 且 next=//evil.com：跳 /chat', () => {
  search = new URLSearchParams('next=//evil.com')
  authed()
  setup()
  expect(replace).toHaveBeenCalledWith('/chat')
})

it('loading：显示加载动效，无子内容，不跳转', () => {
  setup()
  expect(screen.getByRole('status')).toBeInTheDocument()
  expect(screen.queryByText('form-children')).not.toBeInTheDocument()
  expect(replace).not.toHaveBeenCalled()
})

it('guest：渲染子内容，不跳转', () => {
  authStore.setGuest()
  setup()
  expect(screen.getByText('form-children')).toBeInTheDocument()
  expect(screen.queryByRole('status')).not.toBeInTheDocument()
  expect(replace).not.toHaveBeenCalled()
})
