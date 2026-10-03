import type { ChatStreamEvent, Message, Requirement } from '@autix/contracts'
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { StrictMode } from 'react'
import { authStore } from '@/features/auth/auth-store'
import { resetRefreshForTests } from '@/features/auth/refresh'
import { PENDING_KEY } from '@/features/auth/pending-prompt'
import { makeConversation, makeMessage, makeUser, sseController } from '@/test/fixtures'
import { renderWithProviders } from '@/test/render'
import { apiUrl, server } from '@/test/server'
import { ChatScreen, conversationIdFromPath } from './ChatScreen'

const nav = vi.hoisted(() => {
  const listeners = new Set<() => void>()
  return {
    path: '/chat',
    listeners,
    set(next: string) {
      nav.path = next
      for (const listener of [...listeners]) listener()
    },
    push: vi.fn(),
    replace: vi.fn(),
    refresh: vi.fn(),
  }
})
vi.mock('next/navigation', async () => {
  const { useSyncExternalStore } = await import('react')
  return {
    usePathname: () =>
      useSyncExternalStore(
        (cb) => {
          nav.listeners.add(cb)
          return () => nav.listeners.delete(cb)
        },
        () => nav.path,
        () => nav.path,
      ),
    useRouter: () => ({ push: nav.push, replace: nav.replace, refresh: nav.refresh }),
  }
})

const toastMock = vi.hoisted(() => vi.fn())
vi.mock('@/components/ui/toast', () => ({
  toast: (...args: unknown[]) => toastMock(...args),
}))

const NEW_ID = 'conv_new'
const requirement: Requirement = {
  action: '规划里斯本行程',
  constraints: ['5 天', '预算 3000'],
  entities: ['里斯本'],
}

const userMsg = (over: Partial<Message> = {}) =>
  makeMessage({ id: 'u1', conversationId: NEW_ID, role: 'USER', content: '里斯本 5 天', ...over })
const assistantMsg = (over: Partial<Message> = {}) =>
  makeMessage({
    id: 'a1',
    conversationId: NEW_ID,
    role: 'ASSISTANT',
    content: '好的，这是行程',
    ...over,
  })

const ev = {
  userMessage: (m: Message = userMsg()): ChatStreamEvent => ({
    event: 'user_message',
    data: { message: m },
  }),
  delta: (text: string): ChatStreamEvent => ({ event: 'delta', data: { text } }),
  requirement: (...requirements: Requirement[]): ChatStreamEvent => ({
    event: 'requirement',
    data: { requirements },
  }),
  done: (m: Message = assistantMsg()): ChatStreamEvent => ({ event: 'done', data: { message: m } }),
}

const sseResponse = (body: ReadableStream<Uint8Array>) =>
  new HttpResponse(body, { headers: { 'Content-Type': 'text/event-stream' } })

let log: string[]
let creates: number
let sends: number
let listCursors: (string | null)[]
let replaceState: ReturnType<typeof vi.spyOn>
const requests: string[] = []

function onCreate() {
  server.use(
    http.post(apiUrl('/api/conversations'), () => {
      creates += 1
      log.push('create')
      return HttpResponse.json(makeConversation({ id: NEW_ID }))
    }),
  )
}

function onSend(handler: () => Response | Promise<Response>) {
  server.use(
    http.post(apiUrl('/api/conversations/:id/messages'), async () => {
      sends += 1
      log.push('send')
      return handler()
    }),
  )
}

function onList(
  pages: Record<string, { items: Message[]; nextCursor: string | null }>,
  opts: { gate?: Promise<void> } = {},
) {
  server.use(
    http.get(apiUrl('/api/conversations/:id/messages'), async ({ request }) => {
      const cursor = new URL(request.url).searchParams.get('cursor')
      listCursors.push(cursor)
      await opts.gate
      return HttpResponse.json(pages[cursor ?? 'first'])
    }),
  )
}

function renderScreen(ui = <ChatScreen />) {
  return renderWithProviders(ui)
}

const SEND_FAILED: [string, { tone: 'danger' }] = ['发送失败，请重试', { tone: 'danger' }]

const input = () => screen.getByRole('textbox')

async function typeAndSend(user: ReturnType<typeof renderScreen>['user'], text: string) {
  await user.type(input(), text)
  await user.keyboard('{Enter}')
}

beforeEach(() => {
  toastMock.mockClear()
  log = []
  creates = 0
  sends = 0
  listCursors = []
  requests.length = 0
  nav.path = '/chat'
  nav.push.mockClear()
  authStore.reset()
  resetRefreshForTests()
  authStore.setAuthed({ accessToken: 't', user: makeUser({ nickname: 'Ann' }) })
  replaceState = vi.spyOn(window.history, 'replaceState').mockImplementation((_s, _t, url) => {
    log.push('replace')
    act(() => nav.set(String(url)))
  })
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  authStore.reset()
})

it('conversationIdFromPath', () => {
  expect(conversationIdFromPath('/chat')).toBeNull()
  expect(conversationIdFromPath('/chat/')).toBeNull()
  expect(conversationIdFromPath('/chat/abc')).toBe('abc')
  expect(conversationIdFromPath('/chat/abc/x')).toBe('abc')
})

it('新对话：显示「嗨，Ann，想去哪？」与四个建议 chip', () => {
  renderScreen()
  expect(screen.getByRole('heading', { name: '嗨，Ann，想去哪？' })).toBeInTheDocument()
  for (const chip of ['150 欧以内的酒店', '阿尔法玛最佳步行路线', '当地人去哪吃', '把第 3 天换成海滩']) {
    expect(screen.getByRole('button', { name: chip })).toBeInTheDocument()
  }
  expect(screen.getByText('你的旅行助手 · 在线')).toBeInTheDocument()
})

it('点击 chip：文字填入输入框并聚焦，不发请求；输入框非空时 chip 隐藏', async () => {
  const unhandled = vi.fn()
  server.events.on('request:start', unhandled)
  const { user } = renderScreen()
  await user.click(screen.getByRole('button', { name: '当地人去哪吃' }))
  expect(input()).toHaveValue('当地人去哪吃')
  expect(input()).toHaveFocus()
  expect(unhandled).not.toHaveBeenCalled()
  expect(screen.queryByRole('button', { name: '当地人去哪吃' })).not.toBeInTheDocument()
  server.events.removeListener('request:start', unhandled)
})

it('新对话发出第一条：先 POST /api/conversations，再 replaceState 到 /chat/{id}，然后流式显示回复与需求卡片', async () => {
  onCreate()
  const stream = sseController()
  onSend(() => sseResponse(stream.body))
  const { user } = renderScreen()
  await typeAndSend(user, '里斯本 5 天')

  await waitFor(() => expect(log).toEqual(['create', 'replace', 'send']))
  expect(replaceState).toHaveBeenCalledWith(null, '', '/chat/' + NEW_ID)
  expect(input()).toHaveValue('')

  act(() => stream.push(ev.userMessage(), ev.delta('好的'), ev.requirement(requirement)))
  expect(await screen.findByText('里斯本 5 天')).toBeInTheDocument()
  expect(await screen.findByText('好的')).toBeInTheDocument()
  expect(screen.getByText('规划里斯本行程')).toBeInTheDocument()
  expect(screen.getByText('5 天 · 预算 3000')).toBeInTheDocument()
  // 地址同步后流没有被中断
  expect(screen.getByRole('button', { name: '停止' })).toBeInTheDocument()

  act(() => stream.push(ev.done(assistantMsg({ content: '好的，这是行程', metadata: { requirements: [requirement] } }))))
  expect(await screen.findByText('好的，这是行程')).toBeInTheDocument()
  expect(screen.getByText('规划里斯本行程')).toBeInTheDocument()
  await waitFor(() => expect(screen.getByRole('button', { name: '发送' })).toBeInTheDocument())
})

it('新对话里连按两次回车：只创建一个会话，只发一条消息', async () => {
  onCreate()
  const stream = sseController()
  onSend(() => sseResponse(stream.body))
  const { user } = renderScreen()
  await user.type(input(), '里斯本 5 天')
  act(() => {
    fireEvent.keyDown(input(), { key: 'Enter' })
    fireEvent.keyDown(input(), { key: 'Enter' })
  })
  await waitFor(() => expect(sends).toBe(1))
  expect(creates).toBe(1)
  act(() => stream.close())
})

it('已有会话：加载中显示三条骨架气泡，之后按时间正序显示', async () => {
  nav.path = '/chat/conv_1'
  let open!: () => void
  const gate = new Promise<void>((resolve) => (open = resolve))
  const m = (id: string, role: Message['role'], content: string, minute: number) =>
    makeMessage({
      id,
      conversationId: 'conv_1',
      role,
      content,
      createdAt: `2026-10-03T08:0${minute}:00.000Z`,
    })
  onList(
    {
      first: {
        items: [m('m3', 'USER', '第三条', 3), m('m2', 'ASSISTANT', '第二条', 2), m('m1', 'USER', '第一条', 1)],
        nextCursor: null,
      },
    },
    { gate },
  )
  renderScreen()
  const skeleton = screen.getByTestId('skeleton-bubbles')
  expect(skeleton.children).toHaveLength(3)
  act(() => open())
  await screen.findByText('第一条')
  expect(screen.queryByTestId('skeleton-bubbles')).not.toBeInTheDocument()
  const texts = ['第一条', '第二条', '第三条'].map((t) => screen.getByText(t))
  expect(texts[0].compareDocumentPosition(texts[1]) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  expect(texts[1].compareDocumentPosition(texts[2]) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
})

it('会话不存在：显示「找不到这段对话」，按钮跳 /chat', async () => {
  nav.path = '/chat/ghost'
  server.use(
    http.get(apiUrl('/api/conversations/:id/messages'), () =>
      HttpResponse.json({ code: 'CONVERSATION_NOT_FOUND', message: '' }, { status: 404 }),
    ),
  )
  const { user } = renderScreen()
  expect(await screen.findByText('找不到这段对话')).toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: '开始新对话' }))
  expect(nav.push).toHaveBeenCalledWith('/chat')
})

it('生成中：副标题为「正在输入…」，首个 delta 前显示三点；chip 隐藏', async () => {
  nav.path = '/chat/conv_1'
  onList({ first: { items: [makeMessage({ conversationId: 'conv_1', content: '旧消息' })], nextCursor: null } })
  const stream = sseController()
  onSend(() => sseResponse(stream.body))
  const { user } = renderScreen()
  await screen.findByText('旧消息')
  expect(screen.getByRole('button', { name: '当地人去哪吃' })).toBeInTheDocument()

  await typeAndSend(user, '继续')
  await screen.findByRole('status', { name: '正在输入…' })
  expect(screen.getByText('正在输入…', { selector: 'p' })).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: '当地人去哪吃' })).not.toBeInTheDocument()

  act(() => stream.push(ev.userMessage(userMsg({ conversationId: 'conv_1', content: '继续' })), ev.delta('好')))
  expect(await screen.findByText('好')).toBeInTheDocument()
  expect(screen.queryByRole('status', { name: '正在输入…' })).not.toBeInTheDocument()
  act(() => stream.close())
})

it('流开始前失败（500）：弹提示「发送失败，请重试」，文字回到输入框', async () => {
  nav.path = '/chat/conv_1'
  onList({ first: { items: [], nextCursor: null } })
  onSend(() => HttpResponse.json({ code: 'INTERNAL_ERROR', message: '' }, { status: 500 }))
  const { user } = renderScreen()
  await waitFor(() => expect(screen.queryByTestId('skeleton-bubbles')).not.toBeInTheDocument())
  await typeAndSend(user, '你好')
  await waitFor(() => expect(toastMock).toHaveBeenCalledWith(...SEND_FAILED))
  expect(input()).toHaveValue('你好')
})

it('创建会话失败：同样提示并把文字放回输入框', async () => {
  server.use(
    http.post(apiUrl('/api/conversations'), () =>
      HttpResponse.json({ code: 'INTERNAL_ERROR', message: '' }, { status: 500 }),
    ),
  )
  const { user } = renderScreen()
  await typeAndSend(user, '你好')
  await waitFor(() => expect(toastMock).toHaveBeenCalledWith(...SEND_FAILED))
  expect(input()).toHaveValue('你好')
  expect(replaceState).not.toHaveBeenCalled()
})

it('发送返回 RATE_LIMITED（Retry-After: 4）：显示 C9 倒计时，文字回到输入框，不弹提示', async () => {
  nav.path = '/chat/conv_1'
  onList({ first: { items: [], nextCursor: null } })
  onSend(() =>
    HttpResponse.json(
      { code: 'RATE_LIMITED', message: '' },
      { status: 429, headers: { 'Retry-After': '4' } },
    ),
  )
  const { user } = renderScreen()
  await waitFor(() => expect(screen.queryByTestId('skeleton-bubbles')).not.toBeInTheDocument())
  await typeAndSend(user, '你好')
  expect(await screen.findByText('发送太快了，请 4 秒后再试')).toBeInTheDocument()
  expect(input()).toHaveValue('你好')
  expect(toastMock).not.toHaveBeenCalled()
  expect(screen.getByRole('button', { name: '发送' })).toBeDisabled()
})

it('send 抛出异常（编程错误）也按发送失败处理：提示并恢复文字，没有未处理的 rejection', async () => {
  nav.path = '/chat/conv_1'
  onList({ first: { items: [], nextCursor: null } })
  const stream = sseController()
  onSend(() => sseResponse(stream.body))
  const { user, queryClient } = renderScreen()
  await waitFor(() => expect(screen.queryByTestId('skeleton-bubbles')).not.toBeInTheDocument())
  vi.spyOn(queryClient, 'setQueryData').mockImplementation(() => {
    throw new Error('boom')
  })
  await typeAndSend(user, '你好')
  await waitFor(() => expect(sends).toBe(1))
  act(() => stream.push(ev.userMessage(userMsg({ conversationId: 'conv_1' }))))
  await waitFor(() => expect(toastMock).toHaveBeenCalledWith(...SEND_FAILED))
  expect(input()).toHaveValue('你好')
})

it('发送返回 CONVERSATION_NOT_FOUND：显示「找不到这段对话」', async () => {
  nav.path = '/chat/conv_1'
  onList({ first: { items: [], nextCursor: null } })
  onSend(() => HttpResponse.json({ code: 'CONVERSATION_NOT_FOUND', message: '' }, { status: 404 }))
  const { user } = renderScreen()
  await waitFor(() => expect(screen.queryByTestId('skeleton-bubbles')).not.toBeInTheDocument())
  await typeAndSend(user, '你好')
  expect(await screen.findByText('找不到这段对话')).toBeInTheDocument()
  expect(toastMock).not.toHaveBeenCalled()
})

it('点击停止：已生成部分保留并标注「已停止」', async () => {
  nav.path = '/chat/conv_1'
  const first = { items: [] as Message[], nextCursor: null }
  const partial = assistantMsg({ id: 'a-server', conversationId: 'conv_1', content: '好的，我先', status: 'partial' })
  const sent = userMsg({ conversationId: 'conv_1' })
  let afterStop = false
  server.use(
    http.get(apiUrl('/api/conversations/:id/messages'), () =>
      HttpResponse.json(afterStop ? { items: [partial, sent], nextCursor: null } : first),
    ),
  )
  const stream = sseController()
  onSend(() => sseResponse(stream.body))
  const { user } = renderScreen()
  await waitFor(() => expect(screen.queryByTestId('skeleton-bubbles')).not.toBeInTheDocument())
  await typeAndSend(user, '里斯本 5 天')
  act(() => stream.push(ev.userMessage(sent), ev.delta('好的，我先')))
  await screen.findByText('好的，我先')
  afterStop = true
  await user.click(screen.getByRole('button', { name: '停止' }))
  expect(await screen.findByText('已停止')).toBeInTheDocument()
  expect(screen.getByText('好的，我先')).toBeInTheDocument()
  expect(screen.getByText('里斯本 5 天')).toBeInTheDocument()
})

it('暂存输入 { prompt }（新对话）：自动创建会话并发送，只发一次', async () => {
  sessionStorage.setItem(PENDING_KEY, JSON.stringify({ prompt: '里斯本 5 天' }))
  onCreate()
  const stream = sseController()
  onSend(() => sseResponse(stream.body))
  renderScreen(
    <StrictMode>
      <ChatScreen />
    </StrictMode>,
  )
  await waitFor(() => expect(sends).toBe(1))
  expect(creates).toBe(1)
  expect(log).toEqual(['create', 'replace', 'send'])
  expect(sessionStorage.getItem(PENDING_KEY)).toBeNull()
  act(() => stream.close())
})

it('暂存输入 { prompt, conversationId } 与当前会话一致：直接发送，不创建会话', async () => {
  nav.path = '/chat/conv_1'
  sessionStorage.setItem(PENDING_KEY, JSON.stringify({ prompt: '里斯本 5 天', conversationId: 'conv_1' }))
  onList({ first: { items: [], nextCursor: null } })
  onCreate()
  const stream = sseController()
  onSend(() => sseResponse(stream.body))
  renderScreen()
  await waitFor(() => expect(sends).toBe(1))
  expect(creates).toBe(0)
  expect(replaceState).not.toHaveBeenCalled()
  act(() => stream.close())
})

it('暂存输入带 conversationId：首次消息拉取返回前不发送，返回后恰好发送一次', async () => {
  nav.path = '/chat/conv_1'
  sessionStorage.setItem(PENDING_KEY, JSON.stringify({ prompt: '里斯本 5 天', conversationId: 'conv_1' }))
  let open!: () => void
  const gate = new Promise<void>((resolve) => (open = resolve))
  onList({ first: { items: [], nextCursor: null } }, { gate })
  const stream = sseController()
  onSend(() => sseResponse(stream.body))
  renderScreen()
  await waitFor(() => expect(listCursors).toHaveLength(1))
  await act(() => new Promise((resolve) => setTimeout(resolve, 50)))
  expect(sends).toBe(0)
  act(() => open())
  await waitFor(() => expect(sends).toBe(1))
  await act(() => new Promise((resolve) => setTimeout(resolve, 50)))
  expect(sends).toBe(1)
  act(() => stream.close())
})

it('首次消息拉取期间手动发送：忽略，输入框内容保留', async () => {
  nav.path = '/chat/conv_1'
  let open!: () => void
  const gate = new Promise<void>((resolve) => (open = resolve))
  onList({ first: { items: [], nextCursor: null } }, { gate })
  onSend(() => HttpResponse.json({}))
  const { user } = renderScreen()
  await typeAndSend(user, '你好')
  expect(sends).toBe(0)
  expect(input()).toHaveValue('你好')
  act(() => open())
})

it('回复完成后，流式气泡与需求卡片是同一个 DOM 节点（不重播入场动画）', async () => {
  nav.path = '/chat/conv_1'
  onList({ first: { items: [], nextCursor: null } })
  const stream = sseController()
  onSend(() => sseResponse(stream.body))
  const { user } = renderScreen()
  await waitFor(() => expect(screen.queryByTestId('skeleton-bubbles')).not.toBeInTheDocument())
  await typeAndSend(user, '里斯本 5 天')
  const sent = userMsg({ conversationId: 'conv_1' })
  act(() => stream.push(ev.userMessage(sent), ev.delta('好的'), ev.requirement(requirement)))
  // 用户消息写入缓存之后，流式气泡才有稳定的 key
  await screen.findByText('里斯本 5 天')
  const bubble = await screen.findByText('好的')
  const card = await screen.findByText('规划里斯本行程')
  const cardWrapper = card.closest('[data-requirement]')

  act(() =>
    stream.push(
      ev.done(
        assistantMsg({
          conversationId: 'conv_1',
          content: '好的',
          metadata: { requirements: [requirement] },
        }),
      ),
    ),
  )
  await waitFor(() => expect(screen.getByRole('button', { name: '发送' })).toBeInTheDocument())
  expect(screen.getByText('好的')).toBe(bubble)
  expect(screen.getByText('规划里斯本行程').closest('[data-requirement]')).toBe(cardWrapper)
})

it('暂存输入的 conversationId 与当前会话不一致：丢弃，不发送', async () => {
  nav.path = '/chat/conv_1'
  sessionStorage.setItem(PENDING_KEY, JSON.stringify({ prompt: '里斯本 5 天', conversationId: 'other' }))
  onList({ first: { items: [], nextCursor: null } })
  onSend(() => HttpResponse.json({}))
  renderScreen()
  await waitFor(() => expect(sessionStorage.getItem(PENDING_KEY)).toBeNull())
  await act(() => new Promise((resolve) => setTimeout(resolve, 20)))
  expect(sends).toBe(0)
})

describe('滚动', () => {
  class FakeObserver {
    static instances: FakeObserver[] = []
    // 真实的 IntersectionObserver 在 observe() 之后会立刻报告当前可见状态
    static autoFire = false
    disconnected = false
    constructor(readonly callback: (entries: { isIntersecting: boolean }[]) => void) {
      FakeObserver.instances.push(this)
    }
    observe() {
      if (FakeObserver.autoFire) queueMicrotask(() => this.callback([{ isIntersecting: true }]))
    }
    unobserve() {}
    disconnect() {
      this.disconnected = true
    }
    takeRecords() {
      return []
    }
  }

  beforeEach(() => {
    FakeObserver.instances = []
    FakeObserver.autoFire = false
    vi.stubGlobal('IntersectionObserver', FakeObserver)
  })

  const page = (n: number, base: string): Message[] =>
    Array.from({ length: n }, (_, i) =>
      makeMessage({ id: `${base}${n - i}`, conversationId: 'conv_1', content: `${base}${n - i}` }),
    )

  it('滚到顶部哨兵可见：请求下一页（带 cursor）', async () => {
    nav.path = '/chat/conv_1'
    onList({
      first: { items: page(2, 'new'), nextCursor: 'c2' },
      c2: { items: page(2, 'old'), nextCursor: null },
    })
    renderScreen()
    await screen.findByText('new1')
    expect(listCursors).toEqual([null])
    const live = FakeObserver.instances.filter((o) => !o.disconnected).at(-1)!
    act(() => live.callback([{ isIntersecting: true }]))
    await screen.findByText('old1')
    expect(listCursors).toEqual([null, 'c2'])
  })

  it('加载更早消息失败：不再自动重试，顶部出现重试按钮，点击后才再次请求', async () => {
    nav.path = '/chat/conv_1'
    FakeObserver.autoFire = true
    let olderOk = false
    server.use(
      http.get(apiUrl('/api/conversations/:id/messages'), ({ request }) => {
        const cursor = new URL(request.url).searchParams.get('cursor')
        listCursors.push(cursor)
        if (cursor === null) return HttpResponse.json({ items: page(2, 'new'), nextCursor: 'c2' })
        if (!olderOk) return HttpResponse.json({ code: 'INTERNAL_ERROR', message: '' }, { status: 500 })
        return HttpResponse.json({ items: page(2, 'old'), nextCursor: null })
      }),
    )
    const { user } = renderScreen()
    await screen.findByText('new1')
    // 查询自带的重试结束后才会出现重试按钮
    const retry = await screen.findByRole('button', { name: '重试' }, { timeout: 12000 })
    const settled = listCursors.length
    await act(() => new Promise((resolve) => setTimeout(resolve, 300)))
    expect(listCursors).toHaveLength(settled)
    expect(screen.getByText('加载失败')).toBeInTheDocument()

    olderOk = true
    await user.click(retry)
    await screen.findByText('old1')
    expect(listCursors.length).toBeGreaterThan(settled)
  }, 20000)

  const scrollTo = (el: HTMLElement, scrollTop: number) => {
    for (const [key, value] of Object.entries({ scrollTop, scrollHeight: 2000, clientHeight: 500 })) {
      Object.defineProperty(el, key, { value, configurable: true, writable: true })
    }
    act(() => {
      el.dispatchEvent(new Event('scroll'))
    })
  }

  it('距底部超过 80px：出现「回到最新」按钮，点击后调用 scrollToBottom；在底部时不出现', async () => {
    nav.path = '/chat/conv_1'
    onList({ first: { items: page(2, 'm'), nextCursor: null } })
    const scrollToSpy = vi.fn()
    Element.prototype.scrollTo = scrollToSpy as typeof Element.prototype.scrollTo
    const { user } = renderScreen()
    await screen.findByText('m1')
    const scroller = screen.getByTestId('message-scroll')
    scrollTo(scroller, 1420)
    expect(screen.queryByRole('button', { name: '回到最新' })).not.toBeInTheDocument()
    scrollTo(scroller, 1419)
    await user.click(screen.getByRole('button', { name: '回到最新' }))
    expect(scrollToSpy).toHaveBeenCalledWith({ top: 2000, behavior: 'smooth' })
    scrollTo(scroller, 1500)
    expect(screen.queryByRole('button', { name: '回到最新' })).not.toBeInTheDocument()
    Element.prototype.scrollTo = () => {}
  })
})

it('顶栏：抽屉开关切换图标但标签不变；头像菜单在顶栏里', async () => {
  const { user } = renderScreen()
  const toggle = screen.getByRole('button', { name: '历史对话' })
  await user.click(toggle)
  expect(screen.getByRole('button', { name: '历史对话' })).toBeInTheDocument()
  expect(within(screen.getByRole('banner')).getByRole('button', { name: '账号菜单' })).toBeInTheDocument()
})
