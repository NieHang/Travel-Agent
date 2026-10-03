import { http, HttpResponse, delay } from 'msw'
import { server, apiUrl } from '@/test/server'
import { makeUser } from '@/test/fixtures'
import { api, ApiRequestError } from './api-client'
import { authStore } from './auth-store'
import { resetRefreshForTests } from './refresh'

const user = makeUser()
const expired = () =>
  HttpResponse.json({ code: 'TOKEN_EXPIRED', message: '' }, { status: 401 })

let refreshCalls = 0
let thingCalls = 0

function useRefresh() {
  server.use(
    http.post(apiUrl('/api/auth/refresh'), () => {
      refreshCalls += 1
      return HttpResponse.json({ accessToken: 'new', user })
    }),
  )
}

beforeEach(() => {
  resetRefreshForTests()
  authStore.reset()
  authStore.setAuthed({ accessToken: 'old', user })
  refreshCalls = 0
  thingCalls = 0
})

async function catchError(p: Promise<unknown>): Promise<ApiRequestError> {
  try {
    await p
  } catch (e) {
    return e as ApiRequestError
  }
  throw new Error('expected rejection')
}

it('带上 Authorization 与凭据', async () => {
  // MSW 重建的 request 会把 credentials 还原为默认值，所以凭据模式在 fetch 调用处用透传的 spy 断言
  const fetchSpy = vi.spyOn(globalThis, 'fetch')
  let auth: string | null = null
  server.use(
    http.get(apiUrl('/api/things'), ({ request }) => {
      auth = request.headers.get('authorization')
      return HttpResponse.json({ ok: true })
    }),
  )
  await api('/api/things')
  expect(auth).toBe('Bearer old')
  expect(fetchSpy).toHaveBeenCalledTimes(1)
  expect(fetchSpy.mock.calls[0][1]).toMatchObject({ credentials: 'include' })
  fetchSpy.mockRestore()
})

it('TOKEN_EXPIRED：刷新后用新 token 重试一次并成功', async () => {
  server.use(
    http.get(apiUrl('/api/things'), ({ request }) => {
      thingCalls += 1
      return request.headers.get('authorization') === 'Bearer new'
        ? HttpResponse.json({ ok: true })
        : expired()
    }),
  )
  useRefresh()
  await expect(api('/api/things')).resolves.toEqual({ ok: true })
  expect(refreshCalls).toBe(1)
  expect(thingCalls).toBe(2)
  expect(authStore.getState()).toMatchObject({ status: 'authed', accessToken: 'new' })
})

it('并发的三个 TOKEN_EXPIRED 只触发一次刷新', async () => {
  server.use(
    http.get(apiUrl('/api/things'), ({ request }) =>
      request.headers.get('authorization') === 'Bearer new'
        ? HttpResponse.json({ ok: true })
        : expired(),
    ),
  )
  useRefresh()
  await Promise.all([api('/api/things'), api('/api/things'), api('/api/things')])
  expect(refreshCalls).toBe(1)
})

it('别的请求已换过 token：迟到的 TOKEN_EXPIRED 直接用新 token 重试，不再刷新', async () => {
  server.use(
    http.get(apiUrl('/api/things'), async ({ request }) => {
      if (request.headers.get('authorization') === 'Bearer new') {
        return HttpResponse.json({ ok: true })
      }
      // 带 ?slow 的请求晚于快请求的整个刷新流程才返回过期
      if (new URL(request.url).searchParams.has('slow')) await delay(150)
      return expired()
    }),
  )
  useRefresh()
  const slow = api('/api/things?slow=1')
  await api('/api/things')
  await expect(slow).resolves.toEqual({ ok: true })
  expect(refreshCalls).toBe(1)
})

it('重试后仍是 TOKEN_EXPIRED：不再刷新，抛出', async () => {
  server.use(
    http.get(apiUrl('/api/things'), () => {
      thingCalls += 1
      return expired()
    }),
  )
  useRefresh()
  await expect(api('/api/things')).rejects.toMatchObject({ code: 'TOKEN_EXPIRED' })
  expect(thingCalls).toBe(2)
  expect(refreshCalls).toBe(1)
})

it('刷新失败：抛原来的 TOKEN_EXPIRED，状态为 guest', async () => {
  server.use(http.get(apiUrl('/api/things'), expired))
  server.use(
    http.post(apiUrl('/api/auth/refresh'), () =>
      HttpResponse.json({ code: 'REFRESH_REUSED', message: '' }, { status: 401 }),
    ),
  )
  await expect(api('/api/things')).rejects.toMatchObject({ code: 'TOKEN_EXPIRED' })
  expect(authStore.getState()).toEqual({ status: 'guest', reason: 'reused' })
})

it('TOKEN_INVALID 不触发刷新', async () => {
  server.use(
    http.get(apiUrl('/api/things'), () =>
      HttpResponse.json({ code: 'TOKEN_INVALID', message: '' }, { status: 401 }),
    ),
  )
  useRefresh()
  await expect(api('/api/things')).rejects.toMatchObject({ code: 'TOKEN_INVALID', status: 401 })
  expect(refreshCalls).toBe(0)
})

it('RATE_LIMITED 带 retryAfter', async () => {
  server.use(
    http.get(apiUrl('/api/things'), () =>
      HttpResponse.json(
        { code: 'RATE_LIMITED', message: '' },
        { status: 429, headers: { 'Retry-After': '17' } },
      ),
    ),
  )
  const e = await catchError(api('/api/things'))
  expect(e).toBeInstanceOf(ApiRequestError)
  expect(e).toMatchObject({ code: 'RATE_LIMITED', status: 429, retryAfter: 17 })
})

it.each([
  ['缺失', undefined],
  ['abc', 'abc'],
  ['0', '0'],
])('Retry-After %s 时取 60', async (_name, header) => {
  server.use(
    http.get(apiUrl('/api/things'), () =>
      HttpResponse.json(
        { code: 'RATE_LIMITED', message: '' },
        { status: 429, headers: header ? { 'Retry-After': header } : {} },
      ),
    ),
  )
  const e = await catchError(api('/api/things'))
  expect(e.retryAfter).toBe(60)
})

it('VALIDATION_FAILED 保留 details', async () => {
  const details = { fieldErrors: { email: ['bad'] } }
  server.use(
    http.get(apiUrl('/api/things'), () =>
      HttpResponse.json({ code: 'VALIDATION_FAILED', message: '', details }, { status: 400 }),
    ),
  )
  const e = await catchError(api('/api/things'))
  expect(e).toMatchObject({ code: 'VALIDATION_FAILED', status: 400 })
  expect((e.details as typeof details).fieldErrors.email).toEqual(['bad'])
})

it('错误体不是 JSON → INTERNAL_ERROR，status 保留', async () => {
  server.use(
    http.get(apiUrl('/api/things'), () =>
      new HttpResponse('<html>bad gateway</html>', {
        status: 502,
        headers: { 'Content-Type': 'text/html' },
      }),
    ),
  )
  await expect(api('/api/things')).rejects.toMatchObject({ code: 'INTERNAL_ERROR', status: 502 })
})

it('code 不在契约里 → INTERNAL_ERROR', async () => {
  server.use(
    http.get(apiUrl('/api/things'), () =>
      HttpResponse.json({ code: 'WAT', message: '' }, { status: 418 }),
    ),
  )
  await expect(api('/api/things')).rejects.toMatchObject({ code: 'INTERNAL_ERROR', status: 418 })
})

it('网络失败 → NETWORK', async () => {
  server.use(http.get(apiUrl('/api/things'), () => HttpResponse.error()))
  await expect(api('/api/things')).rejects.toMatchObject({ code: 'NETWORK', status: 0 })
})

it('中止 → ABORTED', async () => {
  server.use(
    http.get(apiUrl('/api/things'), async () => {
      await delay('infinite')
      return HttpResponse.json({})
    }),
  )
  const controller = new AbortController()
  const p = api('/api/things', { signal: controller.signal })
  setTimeout(() => controller.abort(), 10)
  await expect(p).rejects.toMatchObject({ code: 'ABORTED', status: 0 })
})

it('204 返回 undefined', async () => {
  server.use(http.delete(apiUrl('/api/x'), () => new HttpResponse(null, { status: 204 })))
  await expect(api('/api/x', { method: 'DELETE' })).resolves.toBeUndefined()
})

it('body 传对象时序列化并带 Content-Type: application/json', async () => {
  let contentType: string | null = null
  let received: unknown
  server.use(
    http.post(apiUrl('/api/x'), async ({ request }) => {
      contentType = request.headers.get('content-type')
      received = await request.json()
      return HttpResponse.json({ ok: true })
    }),
  )
  await api('/api/x', { method: 'POST', body: { a: 1 } })
  expect(contentType).toBe('application/json')
  expect(received).toEqual({ a: 1 })
})
