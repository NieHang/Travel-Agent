import { QueryClient } from '@tanstack/react-query'
import { http, HttpResponse } from 'msw'
import { server, apiUrl } from '@/test/server'
import { makeUser } from '@/test/fixtures'
import { ApiRequestError } from './api-client'
import { authStore } from './auth-store'
import { resetRefreshForTests } from './refresh'
import {
  LOGOUT_TIMEOUT_MS,
  listenForLogout,
  login,
  logout,
  register,
  resetChannelForTests,
} from './session'

const user = makeUser()

class FakeChannel {
  static instances: FakeChannel[] = []
  posted: unknown[] = []
  closed = false
  private listeners = new Set<(event: { data: unknown }) => void>()
  constructor(readonly name: string) {
    FakeChannel.instances.push(this)
  }
  // like the real one: delivered to sibling instances of the same name, never to the sender
  postMessage(data: unknown) {
    this.posted.push(data)
    for (const other of FakeChannel.instances) {
      if (other !== this && other.name === this.name && !other.closed) other.receive(data)
    }
  }
  addEventListener(_type: string, fn: (event: { data: unknown }) => void) {
    this.listeners.add(fn)
  }
  removeEventListener(_type: string, fn: (event: { data: unknown }) => void) {
    this.listeners.delete(fn)
  }
  close() {
    this.closed = true
  }
  receive(data: unknown) {
    for (const fn of [...this.listeners]) fn({ data })
  }
}

let queryClient: QueryClient

beforeEach(() => {
  authStore.reset()
  resetRefreshForTests()
  resetChannelForTests()
  FakeChannel.instances = []
  vi.stubGlobal('BroadcastChannel', FakeChannel)
  queryClient = new QueryClient()
})
afterEach(() => {
  vi.unstubAllGlobals()
})

const seedCache = () =>
  queryClient.setQueryData(['conversations', { q: '' }], { pages: [], pageParams: [] })

it('login 成功后为 authed 并返回 user', async () => {
  server.use(
    http.post(apiUrl('/api/auth/login'), () =>
      HttpResponse.json({ accessToken: 'tok', user }),
    ),
  )
  const result = await login({ email: 'hilda@example.com', password: 'Password123' })
  expect(result).toEqual(user)
  expect(authStore.getState()).toEqual({ status: 'authed', accessToken: 'tok', user })
})

it('register 成功后为 authed 并返回 user', async () => {
  server.use(
    http.post(apiUrl('/api/auth/register'), () =>
      HttpResponse.json({ accessToken: 'tok2', user }),
    ),
  )
  const result = await register({
    email: 'hilda@example.com',
    password: 'Password123',
    nickname: 'Hilda',
    locale: 'zh',
  })
  expect(result).toEqual(user)
  expect(authStore.getState().status).toBe('authed')
})

it('login 失败抛 ApiRequestError，状态不变', async () => {
  server.use(
    http.post(apiUrl('/api/auth/login'), () =>
      HttpResponse.json({ code: 'INVALID_CREDENTIALS', message: '' }, { status: 401 }),
    ),
  )
  const error = await login({ email: 'a@b.co', password: 'Password123' }).catch((e) => e)
  expect(error).toBeInstanceOf(ApiRequestError)
  expect(error.code).toBe('INVALID_CREDENTIALS')
  expect(authStore.getState()).toEqual({ status: 'loading' })
})

it('logout：接口 500 也照常置为 guest、清空缓存', async () => {
  server.use(
    http.post(apiUrl('/api/auth/logout'), () => new HttpResponse(null, { status: 500 })),
  )
  seedCache()
  await logout(queryClient)
  expect(authStore.getState()).toEqual({ status: 'guest', reason: null })
  expect(queryClient.getQueryCache().getAll()).toHaveLength(0)
})

it('logout：网络错误也不抛错', async () => {
  server.use(http.post(apiUrl('/api/auth/logout'), () => HttpResponse.error()))
  await expect(logout(queryClient)).resolves.toBeUndefined()
  expect(authStore.getState().status).toBe('guest')
})

it('logout 广播给其他标签页', async () => {
  server.use(
    http.post(apiUrl('/api/auth/logout'), () => new HttpResponse(null, { status: 204 })),
  )
  await logout(queryClient)
  const sent = FakeChannel.instances.find((c) => c.posted.length > 0)
  expect(sent?.name).toBe('hilda:auth')
  expect(sent?.posted).toEqual([{ type: 'logout' }])
})

it('收到广播：置为 guest 并清空缓存，且不再广播', () => {
  authStore.setAuthed({ accessToken: 't', user })
  seedCache()
  const off = listenForLogout(queryClient)
  const other = new FakeChannel('hilda:auth')
  other.postMessage({ type: 'logout' })
  expect(authStore.getState()).toEqual({ status: 'guest', reason: null })
  expect(queryClient.getQueryCache().getAll()).toHaveLength(0)
  expect(FakeChannel.instances.filter((c) => c !== other).flatMap((c) => c.posted)).toEqual([])
  off()
})

it('无关消息被忽略', () => {
  authStore.setAuthed({ accessToken: 't', user })
  listenForLogout(queryClient)
  new FakeChannel('hilda:auth').postMessage({ type: 'other' })
  expect(authStore.getState().status).toBe('authed')
})

it('BroadcastChannel 不存在时 logout 与 listenForLogout 都不抛错', async () => {
  vi.stubGlobal('BroadcastChannel', undefined)
  server.use(
    http.post(apiUrl('/api/auth/logout'), () => new HttpResponse(null, { status: 204 })),
  )
  const off = listenForLogout(queryClient)
  expect(() => off()).not.toThrow()
  await expect(logout(queryClient)).resolves.toBeUndefined()
  expect(authStore.getState().status).toBe('guest')
})

it('同一标签页既监听又登出：不会收到自己的广播，只置 guest 与清缓存各一次', async () => {
  server.use(
    http.post(apiUrl('/api/auth/logout'), () => new HttpResponse(null, { status: 204 })),
  )
  authStore.setAuthed({ accessToken: 't', user })
  seedCache()
  const clear = vi.spyOn(queryClient, 'clear')
  const off = listenForLogout(queryClient)
  const before = authStore.getGeneration()
  await logout(queryClient)
  expect(authStore.getGeneration()).toBe(before + 1)
  expect(clear).toHaveBeenCalledTimes(1)
  off()
})

it('logout 请求不带 Authorization，也不触发刷新', async () => {
  let auth: string | null = 'unset'
  let refreshCalls = 0
  server.use(
    http.post(apiUrl('/api/auth/logout'), ({ request }) => {
      auth = request.headers.get('Authorization')
      return HttpResponse.json({ code: 'TOKEN_EXPIRED', message: '' }, { status: 401 })
    }),
    http.post(apiUrl('/api/auth/refresh'), () => {
      refreshCalls += 1
      return HttpResponse.json({ accessToken: 'new', user })
    }),
  )
  authStore.setAuthed({ accessToken: 'secret', user })
  await logout(queryClient)
  expect(auth).toBeNull()
  expect(refreshCalls).toBe(0)
  expect(authStore.getState().status).toBe('guest')
})

it('logout 请求无响应：超时后仍置为 guest', async () => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
  try {
    server.use(http.post(apiUrl('/api/auth/logout'), () => new Promise<Response>(() => {})))
    authStore.setAuthed({ accessToken: 't', user })
    const done = logout(queryClient)
    for (let i = 0; i < 20; i += 1) await new Promise((r) => setImmediate(r))
    expect(authStore.getState().status).toBe('authed')
    await vi.advanceTimersByTimeAsync(LOGOUT_TIMEOUT_MS)
    await done
    expect(authStore.getState().status).toBe('guest')
  } finally {
    vi.useRealTimers()
  }
})
