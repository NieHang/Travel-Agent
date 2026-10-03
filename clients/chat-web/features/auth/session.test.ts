import { QueryClient } from '@tanstack/react-query'
import { http, HttpResponse } from 'msw'
import { server, apiUrl } from '@/test/server'
import { makeUser } from '@/test/fixtures'
import { ApiRequestError } from './api-client'
import { authStore } from './auth-store'
import { resetRefreshForTests } from './refresh'
import { listenForLogout, login, logout, register } from './session'

const user = makeUser()

class FakeChannel {
  static instances: FakeChannel[] = []
  posted: unknown[] = []
  closed = false
  onmessage: ((event: { data: unknown }) => void) | null = null
  constructor(readonly name: string) {
    FakeChannel.instances.push(this)
  }
  postMessage(data: unknown) {
    this.posted.push(data)
  }
  close() {
    this.closed = true
  }
  deliver(data: unknown) {
    this.onmessage?.({ data })
  }
}

let queryClient: QueryClient

beforeEach(() => {
  authStore.reset()
  resetRefreshForTests()
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
  const channel = FakeChannel.instances[0]
  channel.deliver({ type: 'logout' })
  expect(authStore.getState()).toEqual({ status: 'guest', reason: null })
  expect(queryClient.getQueryCache().getAll()).toHaveLength(0)
  expect(FakeChannel.instances.flatMap((c) => c.posted)).toEqual([])
  off()
  expect(channel.closed).toBe(true)
})

it('无关消息被忽略', () => {
  authStore.setAuthed({ accessToken: 't', user })
  listenForLogout(queryClient)
  FakeChannel.instances[0].deliver({ type: 'other' })
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
