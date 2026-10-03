import { act, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { HttpResponse, http } from 'msw'
import { renderWithProviders } from '@/test/render'
import { apiUrl, server } from '@/test/server'
import { makeUser } from '@/test/fixtures'
import { LoginForm } from './LoginForm'
import { authStore } from './auth-store'
import { resetRefreshForTests } from './refresh'
import { PENDING_KEY, savePendingPrompt } from './pending-prompt'

const replace = vi.fn()
const toastMock = vi.fn()
let search = new URLSearchParams()
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace, refresh: vi.fn() }),
  useSearchParams: () => search,
}))
vi.mock('@/components/ui/toast', () => ({
  toast: (...args: unknown[]) => toastMock(...args),
}))

const authResult = { accessToken: 'tok', user: makeUser() }

function onLogin(handler: Parameters<typeof http.post>[1]) {
  const spy = vi.fn()
  server.use(
    http.post(apiUrl('/api/auth/login'), (info) => {
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
async function fill(user: U, email = 'ann@example.com', pw = 'secret123') {
  await user.type(screen.getByLabelText('邮箱'), email)
  await user.type(screen.getByLabelText('密码'), pw)
}

beforeEach(() => {
  authStore.reset()
  authStore.setGuest()
  resetRefreshForTests()
  replace.mockClear()
  toastMock.mockClear()
  search = new URLSearchParams()
})

afterEach(() => {
  vi.useRealTimers()
})

it('加载后焦点在邮箱框', () => {
  renderWithProviders(<LoginForm />)
  expect(screen.getByLabelText('邮箱')).toHaveFocus()
})

it('空表单提交：不发请求，两个框都显示「请填写此项」，焦点在邮箱框', async () => {
  const spy = onLogin(() => HttpResponse.json(authResult))
  const { user } = renderWithProviders(<LoginForm />)
  await user.click(screen.getByLabelText('密码')) // 焦点先离开邮箱框
  await user.click(screen.getByRole('button', { name: '登录' }))
  expect(screen.getAllByText('请填写此项')).toHaveLength(2)
  expect(screen.getByLabelText('邮箱')).toHaveFocus()
  expect(spy).not.toHaveBeenCalled()
})

it('邮箱失焦校验：「请输入有效的邮箱」', async () => {
  const { user } = renderWithProviders(<LoginForm />)
  await user.type(screen.getByLabelText('邮箱'), 'a@')
  await user.tab()
  expect(screen.getByText('请输入有效的邮箱')).toBeInTheDocument()
})

it('成功：router.replace 到 next', async () => {
  search = new URLSearchParams('next=/chat/abc')
  const spy = onLogin(() => HttpResponse.json(authResult))
  const { user } = renderWithProviders(<LoginForm />)
  await fill(user, ' Ann@Example.com ')
  await user.click(screen.getByRole('button', { name: '登录' }))
  await waitFor(() => expect(replace).toHaveBeenCalledWith('/chat/abc'))
  expect(await spy.mock.calls[0][0].json()).toEqual({
    email: 'Ann@Example.com',
    password: 'secret123',
  })
  expect(authStore.getState().status).toBe('authed')
})

it('next 为 //evil.com 时到 /chat', async () => {
  search = new URLSearchParams('next=//evil.com')
  onLogin(() => HttpResponse.json(authResult))
  const { user } = renderWithProviders(<LoginForm />)
  await fill(user)
  await user.click(screen.getByRole('button', { name: '登录' }))
  await waitFor(() => expect(replace).toHaveBeenCalledWith('/chat'))
})

it('INVALID_CREDENTIALS：表单级错误，密码框被清空并获得焦点；修改任一输入后错误消失', async () => {
  onLogin(() => HttpResponse.json(errorBody('INVALID_CREDENTIALS'), { status: 401 }))
  const { user } = renderWithProviders(<LoginForm />)
  await fill(user)
  await user.click(screen.getByRole('button', { name: '登录' }))
  expect(await screen.findByText('邮箱或密码不正确')).toBeInTheDocument()
  const pw = screen.getByLabelText('密码') as HTMLInputElement
  expect(pw.value).toBe('')
  expect(pw).toHaveFocus()
  expect(screen.getByLabelText('邮箱')).toHaveValue('ann@example.com')
  await user.type(pw, 'x')
  expect(screen.queryByText('邮箱或密码不正确')).not.toBeInTheDocument()
})

it('RATE_LIMITED（Retry-After: 3）：显示倒计时，按钮禁用，归零后可再次提交', async () => {
  vi.useFakeTimers({
    toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'],
    shouldAdvanceTime: true,
  })
  const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
  let calls = 0
  onLogin(() => {
    calls += 1
    return calls === 1
      ? HttpResponse.json(errorBody('RATE_LIMITED'), {
          status: 429,
          headers: { 'Retry-After': '3' },
        })
      : HttpResponse.json(authResult)
  })
  renderWithProviders(<LoginForm />)
  await fill(user)
  await user.click(screen.getByRole('button', { name: '登录' }))
  expect(await screen.findByText('尝试过于频繁，请 3 秒后再试')).toBeInTheDocument()
  expect(screen.getByRole('button', { name: '登录' })).toBeDisabled()
  await act(() => vi.advanceTimersByTimeAsync(1000))
  expect(screen.getByText('尝试过于频繁，请 2 秒后再试')).toBeInTheDocument()
  await act(() => vi.advanceTimersByTimeAsync(1000))
  await act(() => vi.advanceTimersByTimeAsync(1000))
  expect(screen.queryByText(/尝试过于频繁/)).not.toBeInTheDocument()
  expect(screen.getByRole('button', { name: '登录' })).toBeEnabled()
  await user.click(screen.getByRole('button', { name: '登录' }))
  await waitFor(() => expect(replace).toHaveBeenCalledWith('/chat'))
  expect(calls).toBe(2)
})

it('网络错误：弹提示「网络异常，请重试」，邮箱与密码保留', async () => {
  onLogin(() => HttpResponse.error())
  const { user } = renderWithProviders(<LoginForm />)
  await fill(user)
  await user.click(screen.getByRole('button', { name: '登录' }))
  await waitFor(() =>
    expect(toastMock).toHaveBeenCalledWith('网络异常，请重试', { tone: 'danger' }),
  )
  expect(screen.getByLabelText('邮箱')).toHaveValue('ann@example.com')
  expect(screen.getByLabelText('密码')).toHaveValue('secret123')
  expect(screen.getByRole('button', { name: '登录' })).toBeEnabled()
})

it('INTERNAL_ERROR：同样弹网络提示', async () => {
  onLogin(() => HttpResponse.json(errorBody('INTERNAL_ERROR'), { status: 500 }))
  const { user } = renderWithProviders(<LoginForm />)
  await fill(user)
  await user.click(screen.getByRole('button', { name: '登录' }))
  await waitFor(() => expect(toastMock).toHaveBeenCalledTimes(1))
})

it('VALIDATION_FAILED：错误显示在对应输入框下并聚焦', async () => {
  onLogin(() =>
    HttpResponse.json(
      errorBody('VALIDATION_FAILED', { fieldErrors: { email: ['Invalid email'] } }),
      { status: 400 },
    ),
  )
  const { user } = renderWithProviders(<LoginForm />)
  await fill(user)
  await user.click(screen.getByRole('button', { name: '登录' }))
  expect(await screen.findByText('请输入有效的邮箱')).toBeInTheDocument()
  expect(screen.getByLabelText('邮箱')).toHaveFocus()
})

it('VALIDATION_FAILED 指向客户端认为合法的字段：弹通用提示、不显示错误文案、仍聚焦该字段', async () => {
  onLogin(() =>
    HttpResponse.json(
      errorBody('VALIDATION_FAILED', { fieldErrors: { password: ['bad'] } }),
      { status: 400 },
    ),
  )
  const { user } = renderWithProviders(<LoginForm />)
  await fill(user)
  await user.click(screen.getByRole('button', { name: '登录' }))
  await waitFor(() =>
    expect(toastMock).toHaveBeenCalledWith('出了点问题，请重试', { tone: 'danger' }),
  )
  expect(screen.queryByText('请填写此项')).not.toBeInTheDocument()
  expect(screen.getByLabelText('密码')).toHaveFocus()
})

it('RATE_LIMITED 期间修改输入：提示与禁用保持', async () => {
  vi.useFakeTimers({
    toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'],
    shouldAdvanceTime: true,
  })
  const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
  onLogin(() =>
    HttpResponse.json(errorBody('RATE_LIMITED'), {
      status: 429,
      headers: { 'Retry-After': '30' },
    }),
  )
  renderWithProviders(<LoginForm />)
  await fill(user)
  await user.click(screen.getByRole('button', { name: '登录' }))
  expect(await screen.findByText(/尝试过于频繁/)).toBeInTheDocument()
  await user.type(screen.getByLabelText('邮箱'), 'x')
  expect(screen.getByText(/尝试过于频繁/)).toBeInTheDocument()
  expect(screen.getByRole('button', { name: '登录' })).toBeDisabled()
})

it('请求进行中：按钮为加载态，再次提交不发第二个请求', async () => {
  let release: () => void = () => {}
  const gate = new Promise<void>((r) => {
    release = r
  })
  const spy = onLogin(async () => {
    await gate
    return HttpResponse.json(authResult)
  })
  const { user } = renderWithProviders(<LoginForm />)
  await fill(user)
  await user.click(screen.getByRole('button', { name: '登录' }))
  const button = await screen.findByRole('button', { name: '登录' })
  expect(button).toHaveAttribute('aria-busy', 'true')
  await user.click(button)
  await user.type(screen.getByLabelText('密码'), '{Enter}')
  release()
  await waitFor(() => expect(replace).toHaveBeenCalled())
  expect(spy).toHaveBeenCalledTimes(1)
})

it('切换链接带上 next：/register?next=%2Fchat%2Fabc', () => {
  search = new URLSearchParams('next=/chat/abc')
  renderWithProviders(<LoginForm />)
  expect(screen.getByRole('link', { name: '还没有账号？注册' })).toHaveAttribute(
    'href',
    '/register?next=%2Fchat%2Fabc',
  )
})

it('没有 next 时切换链接不带参数', () => {
  renderWithProviders(<LoginForm />)
  expect(screen.getByRole('link', { name: '还没有账号？注册' })).toHaveAttribute(
    'href',
    '/register',
  )
})

it('存在暂存输入：标题下显示提示；50 个字的内容截到 40 字加省略号；不消费暂存', () => {
  savePendingPrompt({ prompt: '旅'.repeat(50) })
  renderWithProviders(<LoginForm />)
  expect(
    screen.getByText(`登录后将为你规划：「${'旅'.repeat(40)}…」`),
  ).toBeInTheDocument()
  expect(sessionStorage.getItem(PENDING_KEY)).not.toBeNull()
})

it('没有暂存输入时不显示提示', () => {
  renderWithProviders(<LoginForm />)
  expect(screen.queryByText(/登录后将为你规划/)).not.toBeInTheDocument()
})

it('store 为 guest 且 reason 为 reused：显示「登录状态已失效，请重新登录」', () => {
  authStore.setGuest('reused')
  renderWithProviders(<LoginForm />)
  expect(screen.getByText('登录状态已失效，请重新登录')).toBeInTheDocument()
})

it('普通 guest 不显示失效提示', () => {
  renderWithProviders(<LoginForm />)
  expect(screen.queryByText('登录状态已失效，请重新登录')).not.toBeInTheDocument()
})
