import type {
  ChatStreamEvent,
  Message,
  Page,
  Requirement,
} from '@autix/contracts'
import { QueryClient, type InfiniteData } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react'
import { StrictMode } from 'react'
import { http, HttpResponse } from 'msw'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { authStore } from '@/features/auth/auth-store'
import { resetRefreshForTests } from '@/features/auth/refresh'
import { messagesKey, useMessages } from '@/features/conversations/queries'
import { makeMessage, makeUser, sseBody, sseController } from '@/test/fixtures'
import { createWrapper } from '@/test/render'
import { apiUrl, server } from '@/test/server'
import { useChatStream, type SendOutcome } from './use-chat-stream'

const u = makeMessage({ id: 'u1', conversationId: 'c1', role: 'USER', content: '里斯本 5 天' })
const a = makeMessage({
  id: 'a1',
  conversationId: 'c1',
  role: 'ASSISTANT',
  content: '好的，这是行程',
})
const aError = makeMessage({
  id: 'a2',
  conversationId: 'c1',
  role: 'ASSISTANT',
  content: '好的',
  status: 'error',
})
const r: Requirement = { action: '规划里斯本行程', constraints: ['5 天'], entities: ['里斯本'] }

const userMessage = (m: Message = u): ChatStreamEvent => ({
  event: 'user_message',
  data: { message: m },
})
const delta = (text: string): ChatStreamEvent => ({ event: 'delta', data: { text } })
const requirement = (...requirements: Requirement[]): ChatStreamEvent => ({
  event: 'requirement',
  data: { requirements },
})
const done = (m: Message = a): ChatStreamEvent => ({ event: 'done', data: { message: m } })
const errorEvent = (m: Message = aError): ChatStreamEvent => ({
  event: 'error',
  data: { code: 'MODEL_FAILED', message: m },
})

const sseResponse = (body: ReadableStream<Uint8Array>) =>
  new HttpResponse(body, { headers: { 'Content-Type': 'text/event-stream' } })
const json = (status: number, code: string, headers: Record<string, string> = {}) =>
  HttpResponse.json({ code, message: '' }, { status, headers })

let queryClient: QueryClient
let messageListCalls = 0
let postCalls = 0
let listGate: Promise<void>
let openListGate: () => void

function useStreamHandler(resolver: Parameters<typeof http.post>[1]) {
  server.use(
    http.post(apiUrl('/api/conversations/:id/messages'), (info) => {
      postCalls += 1
      return resolver(info)
    }),
  )
}

beforeEach(() => {
  authStore.reset()
  resetRefreshForTests()
  messageListCalls = 0
  postCalls = 0
  listGate = Promise.resolve()
  openListGate = () => {}
  server.use(
    http.get(apiUrl('/api/conversations/:id/messages'), async () => {
      messageListCalls += 1
      await listGate
      return HttpResponse.json({ items: [], nextCursor: null })
    }),
  )
})

afterEach(() => {
  authStore.reset()
  vi.restoreAllMocks()
})

/** 让消息列表的重新拉取停在半路，使缓存内容可以在拉取返回前断言。 */
function holdMessageList() {
  listGate = new Promise<void>((resolve) => (openListGate = resolve))
}

function setup(initialId: string | null = 'c1') {
  const { Wrapper, queryClient: qc } = createWrapper()
  queryClient = qc
  // 消息缓存预置为空页，且 useMessages 的 staleTime 为 Infinity：挂载时不会请求
  qc.setQueryData<InfiniteData<Page<Message>>>(messagesKey('c1'), {
    pages: [{ items: [], nextCursor: null }],
    pageParams: [undefined],
  })
  return renderHook(
    ({ id }: { id: string | null }) => ({
      stream: useChatStream(id),
      messages: useMessages('c1'),
    }),
    { wrapper: Wrapper, initialProps: { id: initialId } },
  )
}

const cached = () =>
  queryClient
    .getQueryData<InfiniteData<Page<Message>>>(messagesKey('c1'))
    ?.pages.flatMap((p) => p.items) ?? []
const cachedIds = () => cached().map((m) => m.id)

type Hook = ReturnType<typeof setup>

function start(hook: Hook, content = '里斯本 5 天'): Promise<SendOutcome> {
  let p!: Promise<SendOutcome>
  act(() => {
    p = hook.result.current.stream.send('c1', content)
  })
  return p
}

async function settle(p: Promise<SendOutcome>): Promise<SendOutcome> {
  let outcome!: SendOutcome
  await act(async () => {
    outcome = await p
  })
  return outcome
}

describe('useChatStream', () => {
  it('停止时服务端尚未保存：保留 partial 并轮询到真实助手行', async () => {
    const stream = sseController()
    let persisted = false
    useStreamHandler(() => sseResponse(stream.body))
    const hook = setup()
    server.use(http.get(apiUrl('/api/conversations/:id/messages'), () => {
      messageListCalls += 1
      return HttpResponse.json({ items: persisted ? [a, u] : [u], nextCursor: null })
    }))
    const p = start(hook)
    await act(async () => stream.push(userMessage(), delta('保留部分')))
    await waitFor(() => expect(hook.result.current.stream.text).toBe('保留部分'))
    act(() => hook.result.current.stream.stop())
    await settle(p)
    await waitFor(() => expect(messageListCalls).toBeGreaterThan(0))
    expect(cached()[0]).toMatchObject({ status: 'partial', content: '保留部分' })
    persisted = true
    await waitFor(() => expect(cachedIds()).toEqual([a.id, u.id]), { timeout: 3500 })
  })

  it('分页请求在发送前取消，迟到页不会覆盖流缓存', async () => {
    const stream = sseController()
    useStreamHandler(() => sseResponse(stream.body))
    const hook = setup()
    queryClient.setQueryData(messagesKey('c1'), { pages: [{ items: [], nextCursor: 'older' }], pageParams: [undefined] })
    let release!: () => void
    const gate = new Promise<void>(resolve => { release = resolve })
    server.use(http.get(apiUrl('/api/conversations/:id/messages'), async () => {
      messageListCalls += 1
      await gate
      return HttpResponse.json({ items: [makeMessage({ id: 'old' })], nextCursor: null })
    }))
    let pagination!: Promise<unknown>
    act(() => { pagination = hook.result.current.messages.fetchNextPage() })
    await waitFor(() => expect(messageListCalls).toBe(1))
    const p = start(hook)
    await act(async () => stream.push(userMessage(), done()))
    await settle(p)
    release()
    await act(async () => { await pagination })
    expect(cachedIds()).toContain(u.id)
    expect(cachedIds()).toContain(a.id)
  })

  it('退出清缓存后流卸载，不再写回原账号消息', async () => {
    authStore.setAuthed({ accessToken: 'A', user: makeUser({ id: 'A' }) })
    const stream = sseController()
    useStreamHandler(() => sseResponse(stream.body))
    const hook = setup()
    const p = start(hook)
    await act(async () => stream.push(userMessage(), delta('私密回复')))
    await waitFor(() => expect(hook.result.current.stream.text).toBe('私密回复'))
    authStore.setGuest()
    queryClient.clear()
    hook.unmount()
    await p
    expect(queryClient.getQueryCache().getAll()).toHaveLength(0)
  })
  it('完成：缓存里先后出现用户消息与助手消息，本地状态清空', async () => {
    useStreamHandler(() =>
      sseResponse(
        sseBody([userMessage(), delta('好的，'), delta('这是'), requirement(r), done()]),
      ),
    )
    const hook = setup()
    const outcome = await act(() => hook.result.current.stream.send('c1', '里斯本 5 天'))
    expect(outcome).toEqual({ ok: true })
    expect(cachedIds()).toEqual([a.id, u.id])
    expect(hook.result.current.stream).toMatchObject({
      phase: 'idle',
      text: '',
      requirements: [],
      activeConversationId: null,
    })
  })

  it('流进行中：phase 依次为 sending → streaming，text 累计，requirements 可读', async () => {
    let release!: () => void
    const gate = new Promise<void>((resolve) => (release = resolve))
    const stream = sseController()
    useStreamHandler(async () => {
      await gate
      return sseResponse(stream.body)
    })
    const hook = setup()
    const p = start(hook)
    expect(hook.result.current.stream).toMatchObject({
      phase: 'sending',
      activeConversationId: 'c1',
    })
    release()
    await act(async () => stream.push(userMessage()))
    await waitFor(() => expect(hook.result.current.stream.phase).toBe('streaming'))
    expect(cachedIds()).toEqual([u.id])
    await act(async () => stream.push(delta('好的，')))
    await waitFor(() => expect(hook.result.current.stream.text).toBe('好的，'))
    await act(async () => stream.push(delta('这是'), requirement(r)))
    await waitFor(() => expect(hook.result.current.stream.text).toBe('好的，这是'))
    expect(hook.result.current.stream.requirements).toEqual([r])
    await act(async () => stream.push(done()))
    expect(await settle(p)).toEqual({ ok: true })
    expect(hook.result.current.stream.phase).toBe('idle')
  })

  it('请求带 Authorization 且 body 为 { content }', async () => {
    authStore.setAuthed({ accessToken: 'tok', user: makeUser() })
    let auth: string | null = null
    let contentType: string | null = null
    let body: unknown
    useStreamHandler(async ({ request }) => {
      auth = request.headers.get('authorization')
      contentType = request.headers.get('content-type')
      body = await request.json()
      return sseResponse(sseBody([userMessage(), done()]))
    })
    const hook = setup()
    await act(() => hook.result.current.stream.send('c1', '里斯本 5 天'))
    expect(auth).toBe('Bearer tok')
    expect(contentType).toContain('application/json')
    expect(body).toEqual({ content: '里斯本 5 天' })
  })

  it('一个汉字跨两个网络块：text 无乱码', async () => {
    useStreamHandler(() =>
      sseResponse(
        sseBody([userMessage(), delta('好的，'), delta('这是')], {
          chunkBytes: 1,
          close: false,
        }),
      ),
    )
    const hook = setup()
    const p = start(hook)
    await waitFor(() => expect(hook.result.current.stream.text).toBe('好的，这是'))
    holdMessageList()
    act(() => hook.result.current.stream.stop())
    await settle(p)
    openListGate()
  })

  it('user_message 与 done 都使会话列表失效（标题、顺序会变）', async () => {
    useStreamHandler(() => sseResponse(sseBody([userMessage(), done()])))
    const hook = setup()
    const spy = vi.spyOn(queryClient, 'invalidateQueries')
    await act(() => hook.result.current.stream.send('c1', 'x'))
    const roots = spy.mock.calls.filter(
      ([f]) => JSON.stringify(f?.queryKey) === JSON.stringify(['conversations']),
    )
    expect(roots).toHaveLength(2)
  })

  it('error 事件：助手消息以 status error 进缓存，返回 ok', async () => {
    useStreamHandler(() =>
      sseResponse(sseBody([userMessage(), delta('好的'), errorEvent()])),
    )
    const hook = setup()
    const outcome = await act(() => hook.result.current.stream.send('c1', 'x'))
    expect(outcome).toEqual({ ok: true })
    expect(cached()[0]).toMatchObject({ id: 'a2', status: 'error' })
    expect(cachedIds()).toEqual(['a2', u.id])
    expect(hook.result.current.stream).toMatchObject({ phase: 'idle', text: '' })
  })

  it('手动停止（已有 delta）：缓存里多一条 partial 本地消息，内容为已累计文本，随后重新拉取消息', async () => {
    const stream = sseController()
    useStreamHandler(() => sseResponse(stream.body))
    const hook = setup()
    holdMessageList()
    const p = start(hook)
    await act(async () => stream.push(userMessage(), delta('好的，')))
    await waitFor(() => expect(hook.result.current.stream.text).toBe('好的，'))
    act(() => hook.result.current.stream.stop())
    expect(await settle(p)).toEqual({ ok: true })
    expect(cached()[0]).toMatchObject({
      role: 'ASSISTANT',
      status: 'partial',
      content: '好的，',
      metadata: null,
      conversationId: 'c1',
    })
    expect(cached()[0].id).toMatch(/^local-/)
    expect(cached()[1].id).toBe(u.id)
    expect(hook.result.current.stream).toMatchObject({
      phase: 'idle',
      text: '',
      activeConversationId: null,
    })
    await waitFor(() => expect(messageListCalls).toBe(1))
    openListGate()
  })

  it('停止时已有需求：本地消息的 metadata 带 requirements', async () => {
    const stream = sseController()
    useStreamHandler(() => sseResponse(stream.body))
    const hook = setup()
    holdMessageList()
    const p = start(hook)
    await act(async () => stream.push(userMessage(), requirement(r)))
    await waitFor(() => expect(hook.result.current.stream.requirements).toEqual([r]))
    act(() => hook.result.current.stream.stop())
    await settle(p)
    expect(cached()[0]).toMatchObject({
      status: 'partial',
      content: '',
      metadata: { requirements: [r] },
    })
    openListGate()
  })

  it('收到 user_message 之前停止：不写缓存，返回 ABORTED', async () => {
    const stream = sseController()
    useStreamHandler(() => sseResponse(stream.body))
    const hook = setup()
    holdMessageList()
    const p = start(hook)
    await waitFor(() => expect(postCalls).toBe(1))
    act(() => hook.result.current.stream.stop())
    const outcome = await settle(p)
    expect(outcome).toMatchObject({ ok: false, error: { code: 'ABORTED' } })
    expect(cached()).toEqual([])
    expect(hook.result.current.stream.phase).toBe('idle')
    await waitFor(() => expect(messageListCalls).toBe(1))
    openListGate()
  })

  it('响应头到达之前停止：同样返回 ABORTED 并重新拉取', async () => {
    useStreamHandler(() => new Promise<Response>(() => {}))
    const hook = setup()
    holdMessageList()
    const p = start(hook)
    await waitFor(() => expect(postCalls).toBe(1))
    act(() => hook.result.current.stream.stop())
    const outcome = await settle(p)
    expect(outcome).toMatchObject({ ok: false, error: { code: 'ABORTED' } })
    expect(cached()).toEqual([])
    expect(hook.result.current.stream.phase).toBe('idle')
    await waitFor(() => expect(messageListCalls).toBe(1))
    openListGate()
  })

  it('流没有 done 或 error 就结束：写入 status 为 error 的本地消息，内容为已累计文本', async () => {
    useStreamHandler(() =>
      sseResponse(sseBody([userMessage(), delta('好的，'), requirement(r)])),
    )
    const hook = setup()
    holdMessageList()
    const outcome = await act(() => hook.result.current.stream.send('c1', 'x'))
    expect(outcome).toEqual({ ok: true })
    expect(cached()[0]).toMatchObject({
      role: 'ASSISTANT',
      status: 'error',
      content: '好的，',
      metadata: { requirements: [r] },
    })
    expect(cached()[0].id).toMatch(/^local-/)
    expect(hook.result.current.stream.phase).toBe('idle')
    await waitFor(() => expect(messageListCalls).toBe(1))
    openListGate()
  })

  it('读流中途网络中断：按未完成处理，send 照常返回', async () => {
    let fail!: (reason: unknown) => void
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(
          new TextEncoder().encode(
            `event: user_message\ndata: ${JSON.stringify({ message: u })}\n\n`,
          ),
        )
        fail = (reason) => controller.error(reason)
      },
    })
    useStreamHandler(() => sseResponse(body))
    const hook = setup()
    holdMessageList()
    const p = start(hook)
    await waitFor(() => expect(hook.result.current.stream.phase).toBe('streaming'))
    fail(new TypeError('network'))
    expect(await settle(p)).toEqual({ ok: true })
    expect(cached()[0]).toMatchObject({ status: 'error', content: '' })
    expect(hook.result.current.stream.phase).toBe('idle')
    openListGate()
  })

  it('流在 user_message 之前就结束：不写缓存，返回错误并重新拉取', async () => {
    useStreamHandler(() => sseResponse(sseBody([])))
    const hook = setup()
    holdMessageList()
    const outcome = await act(() => hook.result.current.stream.send('c1', 'x'))
    expect(outcome).toMatchObject({ ok: false, error: { code: 'NETWORK' } })
    expect(cached()).toEqual([])
    expect(hook.result.current.stream.phase).toBe('idle')
    await waitFor(() => expect(messageListCalls).toBe(1))
    openListGate()
  })

  it.each([
    ['网络错误', () => HttpResponse.error(), 'NETWORK'],
    ['404', () => json(404, 'CONVERSATION_NOT_FOUND'), 'CONVERSATION_NOT_FOUND'],
    ['429', () => json(429, 'RATE_LIMITED', { 'Retry-After': '9' }), 'RATE_LIMITED'],
    ['500', () => json(500, 'INTERNAL_ERROR'), 'INTERNAL_ERROR'],
  ])('流开始前失败（%s）：不写缓存，返回对应错误', async (_name, respond, code) => {
    useStreamHandler(respond)
    const hook = setup()
    const outcome = await act(() => hook.result.current.stream.send('c1', 'x'))
    expect(outcome).toMatchObject({ ok: false, error: { code } })
    if (code === 'RATE_LIMITED' && !outcome.ok) expect(outcome.error.retryAfter).toBe(9)
    expect(cached()).toEqual([])
    expect(messageListCalls).toBe(0)
    expect(hook.result.current.stream).toMatchObject({
      phase: 'idle',
      text: '',
      requirements: [],
      activeConversationId: null,
    })
  })

  it('TOKEN_EXPIRED：刷新后重发，流照常完成', async () => {
    authStore.setAuthed({ accessToken: 'old', user: makeUser() })
    const seen: (string | null)[] = []
    server.use(
      http.post(apiUrl('/api/auth/refresh'), () =>
        HttpResponse.json({ accessToken: 'new', user: makeUser() }),
      ),
    )
    useStreamHandler(({ request }) => {
      const auth = request.headers.get('authorization')
      seen.push(auth)
      return auth === 'Bearer new'
        ? sseResponse(sseBody([userMessage(), delta('好'), done()]))
        : json(401, 'TOKEN_EXPIRED')
    })
    const hook = setup()
    const outcome = await act(() => hook.result.current.stream.send('c1', 'x'))
    expect(outcome).toEqual({ ok: true })
    expect(seen).toEqual(['Bearer old', 'Bearer new'])
    expect(cachedIds()).toEqual([a.id, u.id])
  })

  it('生成中再次 send：返回 ABORTED，不发第二个请求', async () => {
    const stream = sseController()
    useStreamHandler(() => sseResponse(stream.body))
    const hook = setup()
    const first = start(hook)
    await waitFor(() => expect(postCalls).toBe(1))
    let second!: SendOutcome
    await act(async () => {
      second = await hook.result.current.stream.send('c1', 'again')
    })
    expect(second).toMatchObject({ ok: false, error: { code: 'ABORTED' } })
    expect(postCalls).toBe(1)
    // 第一次不受影响，可以正常完成
    await act(async () => stream.push(userMessage(), done()))
    expect(await settle(first)).toEqual({ ok: true })
  })

  it('同一事件循环内连续两次 send：只发一个请求', async () => {
    const stream = sseController()
    useStreamHandler(() => sseResponse(stream.body))
    const hook = setup()
    let first!: Promise<SendOutcome>
    let second!: Promise<SendOutcome>
    act(() => {
      first = hook.result.current.stream.send('c1', 'a')
      second = hook.result.current.stream.send('c1', 'b')
    })
    expect(await second).toMatchObject({ ok: false, error: { code: 'ABORTED' } })
    await waitFor(() => expect(postCalls).toBe(1))
    await act(async () => stream.push(userMessage(), done()))
    expect(await settle(first)).toEqual({ ok: true })
  })

  it('完成后可以再发一条', async () => {
    useStreamHandler(() => sseResponse(sseBody([userMessage(), done()])))
    const hook = setup()
    await act(() => hook.result.current.stream.send('c1', 'a'))
    const outcome = await act(() => hook.result.current.stream.send('c1', 'b'))
    expect(outcome).toEqual({ ok: true })
    expect(postCalls).toBe(2)
  })

  describe('自动中止', () => {
    // MSW 在响应已返回后不会把客户端的中止转给处理器的 request.signal，
    // 所以改为透传 fetch 并观察传给它的 signal
    function abortProbe() {
      const signals: AbortSignal[] = []
      const realFetch = globalThis.fetch
      vi.spyOn(globalThis, 'fetch').mockImplementation((input, init) => {
        if (init?.signal && init.method === 'POST') signals.push(init.signal)
        return realFetch(input, init)
      })
      const stream = sseController()
      useStreamHandler(() => sseResponse(stream.body))
      return {
        state: {
          get aborted() {
            return signals.length > 0 && signals.every((s) => s.aborted)
          },
        },
        stream,
      }
    }

    it('卸载时中止请求，且不产生 React 警告', async () => {
      const errors = vi.spyOn(console, 'error').mockImplementation(() => {})
      const { state, stream } = abortProbe()
      const hook = setup()
      holdMessageList()
      const p = start(hook)
      await act(async () => stream.push(userMessage(), delta('好')))
      await waitFor(() => expect(hook.result.current.stream.text).toBe('好'))
      hook.unmount()
      await expect(p).resolves.toEqual({ ok: true })
      expect(state.aborted).toBe(true)
      expect(errors).not.toHaveBeenCalled()
      openListGate()
    })

    it('卸载时请求还没有响应：send 也会结束', async () => {
      useStreamHandler(() => new Promise<Response>(() => {}))
      const hook = setup()
      const p = start(hook)
      await waitFor(() => expect(postCalls).toBe(1))
      hook.unmount()
      await expect(p).resolves.toMatchObject({ ok: false, error: { code: 'ABORTED' } })
    })

    it('conversationId 由 c1 变为 c2：中止', async () => {
      const { state, stream } = abortProbe()
      const hook = setup('c1')
      holdMessageList()
      const p = start(hook)
      await act(async () => stream.push(userMessage()))
      await waitFor(() => expect(hook.result.current.stream.phase).toBe('streaming'))
      hook.rerender({ id: 'c2' })
      expect(await settle(p)).toEqual({ ok: true })
      expect(state.aborted).toBe(true)
      expect(hook.result.current.stream.phase).toBe('idle')
      openListGate()
    })

    it('conversationId 由 null 变为当前流的 c1：不中止，流照常完成', async () => {
      const { state, stream } = abortProbe()
      const hook = setup(null)
      const p = start(hook)
      await act(async () => stream.push(userMessage(), delta('好')))
      await waitFor(() => expect(hook.result.current.stream.text).toBe('好'))
      hook.rerender({ id: 'c1' })
      expect(state.aborted).toBe(false)
      expect(hook.result.current.stream.phase).toBe('streaming')
      await act(async () => stream.push(done()))
      expect(await settle(p)).toEqual({ ok: true })
      expect(state.aborted).toBe(false)
      expect(cachedIds()).toEqual([a.id, u.id])
    })

    it('conversationId 由 null 变为别的会话：中止', async () => {
      const { state, stream } = abortProbe()
      const hook = setup(null)
      holdMessageList()
      const p = start(hook)
      await act(async () => stream.push(userMessage()))
      await waitFor(() => expect(hook.result.current.stream.phase).toBe('streaming'))
      hook.rerender({ id: 'c2' })
      await settle(p)
      expect(state.aborted).toBe(true)
      openListGate()
    })
  })

  describe('与服务端对齐与加固', () => {
    // 没有 useMessages 观察者时（页面已卸载或已切走），invalidate 只会标记失效，
    // 之后再 setQueryData 会清掉失效标记；因此必须先写本地消息再 invalidate
    function setupBare() {
      const { Wrapper, queryClient: qc } = createWrapper()
      queryClient = qc
      qc.setQueryData<InfiniteData<Page<Message>>>(messagesKey('c1'), {
        pages: [{ items: [], nextCursor: null }],
        pageParams: [undefined],
      })
      return renderHook(() => useChatStream('c1'), { wrapper: Wrapper })
    }

    async function expectReconciledOnRemount() {
      expect(queryClient.getQueryState(messagesKey('c1'))?.isInvalidated).toBe(true)
      expect(cached()[0].id).toMatch(/^local-/)
      const serverRow = makeMessage({ id: 'srv1', conversationId: 'c1', role: 'ASSISTANT' })
      server.use(
        http.get(apiUrl('/api/conversations/:id/messages'), () => {
          messageListCalls += 1
          return HttpResponse.json({ items: [serverRow, u], nextCursor: null })
        }),
      )
      const { Wrapper } = createWrapper({ queryClient })
      renderHook(() => useMessages('c1'), { wrapper: Wrapper })
      await waitFor(() => expect(cachedIds()).toEqual(['srv1', u.id]))
      expect(messageListCalls).toBe(1)
    }

    it('卸载导致的停止：本地 partial 之后消息查询仍处于失效，重新进入时被服务端数据替换', async () => {
      const stream = sseController()
      useStreamHandler(() => sseResponse(stream.body))
      const hook = setupBare()
      let p!: Promise<SendOutcome>
      act(() => {
        p = hook.result.current.send('c1', 'x')
      })
      await act(async () => stream.push(userMessage(), delta('好')))
      hook.unmount()
      await expect(p).resolves.toEqual({ ok: true })
      await expectReconciledOnRemount()
    })

    it('流没有 done 就结束（无观察者）：本地 error 消息之后查询仍处于失效', async () => {
      useStreamHandler(() => sseResponse(sseBody([userMessage(), delta('好')])))
      const hook = setupBare()
      await act(() => hook.result.current.send('c1', 'x'))
      await expectReconciledOnRemount()
    })

    it('StrictMode 下挂载后 send：phase 到达 streaming 并正常完成', async () => {
      const stream = sseController()
      useStreamHandler(() => sseResponse(stream.body))
      const { Wrapper, queryClient: qc } = createWrapper()
      queryClient = qc
      const hook = renderHook(() => useChatStream('c1'), {
        wrapper: ({ children }) => (
          <StrictMode>
            <Wrapper>{children}</Wrapper>
          </StrictMode>
        ),
      })
      let p!: Promise<SendOutcome>
      act(() => {
        p = hook.result.current.send('c1', 'x')
      })
      expect(hook.result.current).toMatchObject({ phase: 'sending', activeConversationId: 'c1' })
      await act(async () => stream.push(userMessage(), delta('好')))
      await waitFor(() => expect(hook.result.current.phase).toBe('streaming'))
      expect(hook.result.current.text).toBe('好')
      await act(async () => stream.push(done()))
      expect(await settle(p)).toEqual({ ok: true })
      expect(hook.result.current).toMatchObject({ phase: 'idle', activeConversationId: null })
    })

    it('处理事件时的程序错误不被吞掉：send 以该错误结束，phase 回 idle', async () => {
      useStreamHandler(() => sseResponse(sseBody([userMessage(), done()])))
      const hook = setup()
      const boom = new Error('boom')
      vi.spyOn(queryClient, 'setQueryData').mockImplementationOnce(() => {
        throw boom
      })
      let caught: unknown
      await act(async () => {
        try {
          await hook.result.current.stream.send('c1', 'x')
        } catch (e) {
          caught = e
        }
      })
      expect(caught).toBe(boom)
      expect(hook.result.current.stream).toMatchObject({ phase: 'idle', text: '' })
    })

    // 同一个网络块里的两个事件：处理第一个时调用 stop，第二个必须不生效
    function stopAfterFirstCacheWrite(hook: Hook) {
      let fired = false
      const unsubscribe = queryClient.getQueryCache().subscribe((event) => {
        if (!fired && event.type === 'updated' && event.action.type === 'success') {
          fired = true
          hook.result.current.stream.stop()
        }
      })
      return unsubscribe
    }

    it('同一块里 stop 之后的 delta 不累计到本地 partial 消息', async () => {
      useStreamHandler(() =>
        sseResponse(sseBody([userMessage(), delta('迟到')])),
      )
      const hook = setup()
      holdMessageList()
      stopAfterFirstCacheWrite(hook)
      const outcome = await act(() => hook.result.current.stream.send('c1', 'x'))
      expect(outcome).toEqual({ ok: true })
      expect(cached()[0]).toMatchObject({ status: 'partial', content: '' })
      expect(hook.result.current.stream).toMatchObject({ phase: 'idle', text: '' })
      openListGate()
    })

    it('同一块里 stop 之后的 done 不写入缓存', async () => {
      useStreamHandler(() => sseResponse(sseBody([userMessage(), done()])))
      const hook = setup()
      holdMessageList()
      stopAfterFirstCacheWrite(hook)
      await act(() => hook.result.current.stream.send('c1', 'x'))
      expect(cachedIds()).not.toContain(a.id)
      expect(cached()[0]).toMatchObject({ status: 'partial' })
      openListGate()
    })

    it('done 之后同一块里的事件被忽略', async () => {
      const a3 = makeMessage({ id: 'a3', conversationId: 'c1', role: 'ASSISTANT' })
      useStreamHandler(() =>
        sseResponse(sseBody([userMessage(), done(), delta('x'), done(a3)])),
      )
      const hook = setup()
      const outcome = await act(() => hook.result.current.stream.send('c1', 'x'))
      expect(outcome).toEqual({ ok: true })
      expect(cachedIds()).toEqual([a.id, u.id])
      expect(hook.result.current.stream).toMatchObject({ phase: 'idle', text: '' })
    })
  })
})
