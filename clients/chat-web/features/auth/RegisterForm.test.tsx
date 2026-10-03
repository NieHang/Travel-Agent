import { act, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { HttpResponse, http } from 'msw'
import { renderWithProviders } from '@/test/render'
import { apiUrl, server } from '@/test/server'
import { makeUser } from '@/test/fixtures'
import { RegisterForm } from './RegisterForm'
import { authStore } from './auth-store'
import { resetRefreshForTests } from './refresh'

const replace = vi.fn()
let search = new URLSearchParams()
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace, refresh: vi.fn() }),
  useSearchParams: () => search,
}))
vi.mock('@/components/ui/toast', () => ({ toast: vi.fn() }))

const authResult = { accessToken: 'tok', user: makeUser() }

function onRegister(handler: Parameters<typeof http.post>[1]) {
  const spy = vi.fn()
  server.use(
    http.post(apiUrl('/api/auth/register'), (info) => {
      spy(info.request.clone())
      return handler(info)
    }),
  )
  return spy
}

function errorBody(code: string, details?: unknown) {
  return { code, message: code, details }
}

type U = ReturnType<typeof userEvent.setup>
async function fill(user: U, nickname = 'Ann', email = 'ann@example.com', pw = 'secret123') {
  await user.type(screen.getByLabelText('昵称'), nickname)
  await user.type(screen.getByLabelText('邮箱'), email)
  await user.type(screen.getByLabelText('密码'), pw)
}

const rule = (name: string) => screen.getByText(name).closest('[data-met]') as HTMLElement

beforeEach(() => {
  authStore.reset()
  authStore.setGuest()
  resetRefreshForTests()
  replace.mockClear()
  search = new URLSearchParams()
})

afterEach(() => {
  vi.useRealTimers()
})

it('加载后焦点在昵称框', () => {
  renderWithProviders(<RegisterForm />)
  expect(screen.getByLabelText('昵称')).toHaveFocus()
})

it('密码规则随输入逐条打勾；提交时未满足的条目变为 danger 色且不发请求', async () => {
  const spy = onRegister(() => HttpResponse.json(authResult))
  const { user } = renderWithProviders(<RegisterForm />)
  expect(rule('至少 8 位')).toHaveAttribute('data-met', 'false')
  expect(rule('包含字母和数字')).toHaveAttribute('data-met', 'false')
  const pw = screen.getByLabelText('密码')
  await user.type(pw, 'abcdefgh')
  expect(rule('至少 8 位')).toHaveAttribute('data-met', 'true')
  expect(rule('包含字母和数字')).toHaveAttribute('data-met', 'false')
  expect(rule('包含字母和数字')).not.toHaveClass('text-danger')
  await user.type(screen.getByLabelText('昵称'), 'Ann')
  await user.type(screen.getByLabelText('邮箱'), 'ann@example.com')
  await user.click(screen.getByRole('button', { name: '创建账号' }))
  expect(rule('包含字母和数字')).toHaveClass('text-danger')
  expect(rule('至少 8 位')).not.toHaveClass('text-danger')
  expect(pw).toHaveFocus()
  expect(spy).not.toHaveBeenCalled()
  await user.type(pw, '1')
  expect(rule('包含字母和数字')).toHaveAttribute('data-met', 'true')
})

it('空表单提交：标出昵称与邮箱，聚焦昵称框，不发请求', async () => {
  const spy = onRegister(() => HttpResponse.json(authResult))
  const { user } = renderWithProviders(<RegisterForm />)
  await user.click(screen.getByLabelText('密码'))
  await user.click(screen.getByRole('button', { name: '创建账号' }))
  expect(screen.getAllByText('请填写此项')).toHaveLength(2)
  expect(screen.getByLabelText('昵称')).toHaveFocus()
  expect(rule('至少 8 位')).toHaveClass('text-danger')
  expect(spy).not.toHaveBeenCalled()
})

it('昵称 21 个字：「昵称最多 20 个字」', async () => {
  const { user } = renderWithProviders(<RegisterForm />)
  await user.type(screen.getByLabelText('昵称'), 'x'.repeat(21))
  await user.tab()
  expect(screen.getByText('昵称最多 20 个字')).toBeInTheDocument()
})

it('邮箱失焦校验', async () => {
  const { user } = renderWithProviders(<RegisterForm />)
  await user.type(screen.getByLabelText('邮箱'), 'a@')
  await user.tab()
  expect(screen.getByText('请输入有效的邮箱')).toBeInTheDocument()
})

it('成功：请求体含 locale 为当前界面语言，之后跳 next', async () => {
  search = new URLSearchParams('next=/chat/abc')
  const spy = onRegister(() => HttpResponse.json(authResult))
  const { user } = renderWithProviders(<RegisterForm />, { locale: 'en' })
  await user.type(screen.getByLabelText('Nickname'), ' Ann ')
  await user.type(screen.getByLabelText('Email'), 'ann@example.com')
  await user.type(screen.getByLabelText('Password'), 'secret123')
  await user.click(screen.getByRole('button', { name: 'Create account' }))
  await waitFor(() => expect(replace).toHaveBeenCalledWith('/chat/abc'))
  expect(await spy.mock.calls[0][0].json()).toEqual({
    email: 'ann@example.com',
    password: 'secret123',
    nickname: 'Ann',
    locale: 'en',
  })
})

it('EMAIL_TAKEN：邮箱框下提示并有指向 /login?next=… 的链接', async () => {
  search = new URLSearchParams('next=/chat/abc')
  onRegister(() => HttpResponse.json(errorBody('EMAIL_TAKEN'), { status: 409 }))
  const { user } = renderWithProviders(<RegisterForm />)
  await fill(user)
  await user.click(screen.getByRole('button', { name: '创建账号' }))
  expect(await screen.findByText('这个邮箱已注册')).toBeInTheDocument()
  expect(screen.getByRole('link', { name: '去登录' })).toHaveAttribute(
    'href',
    '/login?next=%2Fchat%2Fabc',
  )
  expect(screen.getByLabelText('邮箱')).toHaveAccessibleDescription(/这个邮箱已注册/)
  expect(screen.getByLabelText('邮箱')).toHaveFocus()
})

it('VALIDATION_FAILED：两个框下都有错误，焦点在昵称框', async () => {
  onRegister(() =>
    HttpResponse.json(
      errorBody('VALIDATION_FAILED', {
        fieldErrors: { nickname: ['Too long'], email: ['Invalid email'] },
      }),
      { status: 400 },
    ),
  )
  const { user } = renderWithProviders(<RegisterForm />)
  await fill(user)
  await user.click(screen.getByRole('button', { name: '创建账号' }))
  expect(await screen.findByText('请输入有效的邮箱')).toBeInTheDocument()
  expect(screen.getByLabelText('昵称')).toHaveAccessibleDescription('昵称最多 20 个字')
  expect(screen.getByLabelText('昵称')).toHaveFocus()
})

it('RATE_LIMITED 倒计时', async () => {
  vi.useFakeTimers({
    toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'],
    shouldAdvanceTime: true,
  })
  const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
  onRegister(() =>
    HttpResponse.json(errorBody('RATE_LIMITED'), {
      status: 429,
      headers: { 'Retry-After': '2' },
    }),
  )
  renderWithProviders(<RegisterForm />)
  await fill(user)
  await user.click(screen.getByRole('button', { name: '创建账号' }))
  expect(await screen.findByText('尝试过于频繁，请 2 秒后再试')).toBeInTheDocument()
  expect(screen.getByRole('button', { name: '创建账号' })).toBeDisabled()
  await act(() => vi.advanceTimersByTimeAsync(1000))
  await act(() => vi.advanceTimersByTimeAsync(1000))
  expect(screen.queryByText(/尝试过于频繁/)).not.toBeInTheDocument()
  expect(screen.getByRole('button', { name: '创建账号' })).toBeEnabled()
})

it('切换链接带上 next', () => {
  search = new URLSearchParams('next=/chat/abc')
  renderWithProviders(<RegisterForm />)
  expect(screen.getByRole('link', { name: '已有账号？登录' })).toHaveAttribute(
    'href',
    '/login?next=%2Fchat%2Fabc',
  )
})
