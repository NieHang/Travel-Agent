import { http, HttpResponse } from 'msw'
import { server, apiUrl } from '@/test/server'
import { makeUser } from '@/test/fixtures'
import { authStore } from './auth-store'
import { bootstrapAuth, refreshSession, resetRefreshForTests } from './refresh'

const user = makeUser()
const err = (code: string, status = 401) =>
  HttpResponse.json({ code, message: '' }, { status })
const ok = () => HttpResponse.json({ accessToken: 'new', user })

let calls = 0
function respondWith(...responses: Array<() => Response>) {
  calls = 0
  server.use(
    http.post(apiUrl('/api/auth/refresh'), () => {
      const make = responses[Math.min(calls, responses.length - 1)]
      calls += 1
      return make()
    }),
  )
}

// 假定时器只伪造 setTimeout；用 setImmediate 让 MSW 的异步链真正跑完，
// 否则“过早发出的第二次请求”还没来得及计数
async function flushNetwork() {
  for (let i = 0; i < 50; i += 1) await new Promise((r) => setImmediate(r))
}

beforeEach(() => {
  authStore.reset()
  resetRefreshForTests()
  calls = 0
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
})
afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

it('成功：置为 authed，返回 true，且带凭据', async () => {
  // MSW 重建的 request 看不到 credentials，所以在 fetch 调用处用透传的 spy 断言
  const fetchSpy = vi.spyOn(globalThis, 'fetch')
  respondWith(ok)
  await expect(refreshSession()).resolves.toBe(true)
  expect(authStore.getState()).toMatchObject({ status: 'authed', accessToken: 'new' })
  expect(fetchSpy.mock.calls[0][1]).toMatchObject({ method: 'POST', credentials: 'include' })
})

it('REFRESH_INVALID：300ms 后重试一次，第二次成功', async () => {
  respondWith(() => err('REFRESH_INVALID'), ok)
  const p = refreshSession()
  await vi.advanceTimersByTimeAsync(299)
  await flushNetwork()
  expect(calls).toBe(1)
  await vi.advanceTimersByTimeAsync(1)
  expect(await p).toBe(true)
  expect(calls).toBe(2)
})

it('REFRESH_INVALID 两次：置为 guest，reason 为 null，共 2 次请求', async () => {
  respondWith(() => err('REFRESH_INVALID'))
  const p = refreshSession()
  await vi.advanceTimersByTimeAsync(300)
  expect(await p).toBe(false)
  expect(calls).toBe(2)
  expect(authStore.getState()).toEqual({ status: 'guest', reason: null })
})

it('REFRESH_REUSED：不重试，guest 且 reason 为 reused，共 1 次请求', async () => {
  respondWith(() => err('REFRESH_REUSED'))
  const p = refreshSession()
  await vi.advanceTimersByTimeAsync(1000)
  expect(await p).toBe(false)
  expect(calls).toBe(1)
  expect(authStore.getState()).toEqual({ status: 'guest', reason: 'reused' })
})

it('网络错误：guest，不抛错', async () => {
  respondWith(() => HttpResponse.error())
  await expect(refreshSession()).resolves.toBe(false)
  expect(authStore.getState()).toEqual({ status: 'guest', reason: null })
})

it('并发调用共用一个请求', async () => {
  respondWith(ok)
  const [a, b] = await Promise.all([refreshSession(), refreshSession()])
  expect([a, b]).toEqual([true, true])
  expect(calls).toBe(1)
})

it('bootstrapAuth 调两次只刷新一次', async () => {
  respondWith(ok)
  await bootstrapAuth()
  await bootstrapAuth()
  expect(calls).toBe(1)
  expect(authStore.getState().status).toBe('authed')
})

function gatedRefresh(make: () => Response) {
  let release!: () => void
  const gate = new Promise<void>((r) => (release = r))
  let started!: () => void
  const requestStarted = new Promise<void>((r) => (started = r))
  calls = 0
  server.use(
    http.post(apiUrl('/api/auth/refresh'), async () => {
      calls += 1
      started()
      await gate
      return make()
    }),
  )
  return { release, requestStarted }
}

it('刷新在途时 setGuest：成功的刷新结果被丢弃，状态保持 guest，返回 false', async () => {
  const { release, requestStarted } = gatedRefresh(ok)
  const p = refreshSession()
  await requestStarted
  authStore.setGuest()
  release()
  expect(await p).toBe(false)
  expect(authStore.getState()).toEqual({ status: 'guest', reason: null })
})

it('刷新在途时重新登录：失败的刷新结果被丢弃，保持登录的 token', async () => {
  const { release, requestStarted } = gatedRefresh(() => err('REFRESH_REUSED'))
  const p = refreshSession()
  await requestStarted
  authStore.setAuthed({ accessToken: 'login', user })
  release()
  expect(await p).toBe(false)
  expect(authStore.getState()).toMatchObject({ status: 'authed', accessToken: 'login' })
})
