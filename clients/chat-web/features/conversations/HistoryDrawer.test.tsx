import type { Conversation } from '@autix/contracts'
import { QueryClient } from '@tanstack/react-query'
import { act, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { useRef, useState } from 'react'
import { makeConversation } from '@/test/fixtures'
import { renderWithProviders } from '@/test/render'
import { apiUrl, server } from '@/test/server'
import { HistoryDrawer } from './HistoryDrawer'

const nav = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn() }))
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: nav.push, replace: nav.replace }),
}))

const toastMock = vi.hoisted(() => vi.fn())
vi.mock('@/components/ui/toast', () => ({
  toast: (...args: unknown[]) => toastMock(...args),
}))

const conv = (id: string, title: string, over: Partial<Conversation> = {}) =>
  makeConversation({ id, title, ...over })

type Page = { items: Conversation[]; nextCursor: string | null }

let listRequests: { q: string | null; cursor: string | null }[]

function onList(handler: (q: string | null, cursor: string | null) => Page | Promise<Page>) {
  server.use(
    http.get(apiUrl('/api/conversations'), async ({ request }) => {
      const url = new URL(request.url)
      const q = url.searchParams.get('q')
      const cursor = url.searchParams.get('cursor')
      listRequests.push({ q, cursor })
      return HttpResponse.json(await handler(q, cursor))
    }),
  )
}

const ABC: Page = {
  items: [conv('c1', 'Lisbon trip'), conv('c2', 'Kyoto trip'), conv('c3', 'Rome trip')],
  nextCursor: null,
}

function Host({
  activeId = null,
  isBlankNewChat = false,
}: {
  activeId?: string | null
  isBlankNewChat?: boolean
}) {
  const [open, setOpen] = useState(true)
  const returnFocusRef = useRef<HTMLButtonElement>(null)
  return (
    <>
      <button ref={returnFocusRef} onClick={() => setOpen((v) => !v)}>
        toggle
      </button>
      <HistoryDrawer
        open={open}
        onClose={() => setOpen(false)}
        activeId={activeId}
        isBlankNewChat={isBlankNewChat}
        returnFocusRef={returnFocusRef}
      />
    </>
  )
}

class FakeObserver {
  static instances: FakeObserver[] = []
  disconnected = false
  constructor(readonly callback: (entries: { isIntersecting: boolean }[]) => void) {
    FakeObserver.instances.push(this)
  }
  observe() {}
  unobserve() {}
  disconnect() {
    this.disconnected = true
  }
  takeRecords() {
    return []
  }
  static live() {
    return FakeObserver.instances.filter((o) => !o.disconnected).at(-1)
  }
}

beforeEach(() => {
  listRequests = []
  nav.push.mockClear()
  nav.replace.mockClear()
  toastMock.mockClear()
  FakeObserver.instances = []
  vi.stubGlobal('IntersectionObserver', FakeObserver)
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

async function renderOpen(props: Parameters<typeof Host>[0] = {}, queryClient?: QueryClient) {
  const utils = renderWithProviders(<Host {...props} />, { queryClient })
  await screen.findByRole('dialog', { name: '历史对话' })
  return utils
}

const row = (title: string) => screen.getByRole('button', { name: new RegExp(title) })

it('打开后焦点在抽屉内；Tab 不会离开抽屉', async () => {
  onList(() => ABC)
  const { user } = await renderOpen()
  const dialog = screen.getByRole('dialog', { name: '历史对话' })
  expect(dialog).toHaveAttribute('aria-modal', 'true')
  await screen.findByText('Lisbon trip')
  expect(dialog).toContainElement(document.activeElement as HTMLElement)
  for (let i = 0; i < 8; i += 1) {
    await user.tab()
    expect(dialog).toContainElement(document.activeElement as HTMLElement)
  }
})

it('Esc 关闭并把焦点还给 returnFocusRef；点击遮罩关闭', async () => {
  onList(() => ABC)
  const { user } = await renderOpen()
  await screen.findByText('Lisbon trip')
  await user.keyboard('{Escape}')
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  expect(screen.getByRole('button', { name: 'toggle' })).toHaveFocus()

  await user.click(screen.getByRole('button', { name: 'toggle' }))
  await screen.findByRole('dialog', { name: '历史对话' })
  await user.click(screen.getByTestId('drawer-scrim'))
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  expect(screen.getByRole('button', { name: 'toggle' })).toHaveFocus()
})

it('列表：标题与相对时间；当前会话 aria-current', async () => {
  onList(() => ABC)
  await renderOpen({ activeId: 'c2' })
  const lisbon = await screen.findByRole('button', { name: /Lisbon trip/ })
  expect(lisbon).toHaveTextContent(/4\s*小时前/)
  expect(lisbon).not.toHaveAttribute('aria-current')
  expect(row('Kyoto trip')).toHaveAttribute('aria-current', 'page')
})

it('列表为空且无搜索词：「还没有对话，从一个目的地开始吧」', async () => {
  onList(() => ({ items: [], nextCursor: null }))
  await renderOpen()
  expect(await screen.findByText('还没有对话，从一个目的地开始吧')).toBeInTheDocument()
})

it('搜索：输入后 299ms 不请求，300ms 后带 q 请求；无结果显示「没有匹配的对话」', async () => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'], shouldAdvanceTime: true })
  onList((q) => (q ? { items: [], nextCursor: null } : ABC))
  await renderOpen()
  await screen.findByText('Lisbon trip')
  expect(listRequests).toEqual([{ q: null, cursor: null }])
  const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
  await user.type(screen.getByRole('searchbox', { name: '搜索对话' }), 'zzz')
  expect(screen.getByRole('searchbox', { name: '搜索对话' })).toHaveValue('zzz')
  act(() => vi.advanceTimersByTime(299 - 0))
  expect(listRequests).toHaveLength(1)
  act(() => vi.advanceTimersByTime(2))
  expect(await screen.findByText('没有匹配的对话')).toBeInTheDocument()
  expect(listRequests.at(-1)).toEqual({ q: 'zzz', cursor: null })
  expect(screen.queryByText('还没有对话，从一个目的地开始吧')).not.toBeInTheDocument()
})

it('清空按钮仅在搜索框非空时出现；点击后搜索词清空且焦点回到搜索框', async () => {
  onList(() => ABC)
  const { user } = await renderOpen()
  await screen.findByText('Lisbon trip')
  const input = screen.getByRole('searchbox', { name: '搜索对话' })
  expect(screen.queryByRole('button', { name: '清空' })).not.toBeInTheDocument()
  await user.type(input, 'ky')
  await user.click(screen.getByRole('button', { name: '清空' }))
  expect(input).toHaveValue('')
  expect(input).toHaveFocus()
  expect(screen.queryByRole('button', { name: '清空' })).not.toBeInTheDocument()
})

it('下方向键移到下一条，回车调用 router.push("/chat/{id}") 并关闭', async () => {
  onList(() => ABC)
  const { user } = await renderOpen()
  const first = await screen.findByRole('button', { name: /Lisbon trip/ })
  act(() => first.focus())
  await user.keyboard('{ArrowDown}')
  expect(row('Kyoto trip')).toHaveFocus()
  await user.keyboard('{ArrowUp}{ArrowDown}{ArrowDown}')
  expect(row('Rome trip')).toHaveFocus()
  await user.keyboard('{ArrowUp}{Enter}')
  expect(nav.push).toHaveBeenCalledWith('/chat/c2')
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
})

it('新对话：router.push("/chat") 并关闭；isBlankNewChat 时只关闭不跳转', async () => {
  onList(() => ABC)
  const first = await renderOpen()
  await first.user.click(await screen.findByRole('button', { name: '新对话' }))
  expect(nav.push).toHaveBeenCalledWith('/chat')
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  first.unmount()

  nav.push.mockClear()
  const second = await renderOpen({ isBlankNewChat: true })
  await second.user.click(await screen.findByRole('button', { name: '新对话' }))
  expect(nav.push).not.toHaveBeenCalled()
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
})

async function startRename(user: ReturnType<typeof userEvent.setup>, title: string) {
  const item = (await screen.findByText(title)).closest('li') as HTMLElement
  await user.click(within(item).getByRole('button', { name: '更多操作' }))
  await user.click(await screen.findByRole('menuitem', { name: '重命名' }))
  return screen.findByRole('textbox', { name: '重命名' })
}

it('重命名：标题变为输入框且全选；回车保存，请求体为去空白后的标题', async () => {
  onList(() => ABC)
  const bodies: unknown[] = []
  server.use(
    http.patch(apiUrl('/api/conversations/c1'), async ({ request }) => {
      const body = (await request.json()) as { title: string }
      bodies.push(body)
      return HttpResponse.json(conv('c1', body.title))
    }),
  )
  const { user } = await renderOpen()
  const input = (await startRename(user, 'Lisbon trip')) as HTMLInputElement
  expect(input).toHaveFocus()
  expect(input).toHaveAttribute('maxlength', '60')
  expect(input.value).toBe('Lisbon trip')
  expect(input.selectionStart).toBe(0)
  expect(input.selectionEnd).toBe('Lisbon trip'.length)
  await user.keyboard('  Porto  {Enter}')
  expect(await screen.findByText('Porto')).toBeInTheDocument()
  await waitFor(() => expect(bodies).toEqual([{ title: 'Porto' }]))
  expect(screen.queryByRole('textbox', { name: '重命名' })).not.toBeInTheDocument()
})

it('重命名：Esc 取消；清空后失焦不发请求；未改动不发请求', async () => {
  onList(() => ABC)
  let patches = 0
  server.use(
    http.patch(apiUrl('/api/conversations/:id'), () => {
      patches += 1
      return HttpResponse.json(conv('c1', 'x'))
    }),
  )
  const { user } = await renderOpen()

  await startRename(user, 'Lisbon trip')
  await user.keyboard('changed{Escape}')
  expect(screen.queryByRole('textbox', { name: '重命名' })).not.toBeInTheDocument()
  expect(screen.getByRole('dialog', { name: '历史对话' })).toBeInTheDocument()
  expect(screen.getByText('Lisbon trip')).toBeInTheDocument()

  await startRename(user, 'Kyoto trip')
  await user.clear(screen.getByRole('textbox', { name: '重命名' }))
  await user.click(screen.getByRole('searchbox', { name: '搜索对话' }))
  expect(screen.queryByRole('textbox', { name: '重命名' })).not.toBeInTheDocument()
  expect(screen.getByText('Kyoto trip')).toBeInTheDocument()

  await startRename(user, 'Rome trip')
  await user.keyboard('{Enter}')
  expect(screen.queryByRole('textbox', { name: '重命名' })).not.toBeInTheDocument()
  expect(patches).toBe(0)
})

it('重命名失败：标题还原并提示「重命名失败」', async () => {
  onList(() => ABC)
  server.use(
    http.patch(apiUrl('/api/conversations/c1'), () =>
      HttpResponse.json({ code: 'INTERNAL', message: 'x' }, { status: 500 }),
    ),
  )
  const { user } = await renderOpen()
  await startRename(user, 'Lisbon trip')
  await user.keyboard('Porto{Enter}')
  await waitFor(() =>
    expect(toastMock).toHaveBeenCalledWith('重命名失败', { tone: 'danger' }),
  )
  expect(await screen.findByText('Lisbon trip')).toBeInTheDocument()
  expect(toastMock).toHaveBeenCalledTimes(1)
})

async function openDeleteConfirm(user: ReturnType<typeof userEvent.setup>, title: string) {
  const item = (await screen.findByText(title)).closest('li') as HTMLElement
  await user.click(within(item).getByRole('button', { name: '更多操作' }))
  await user.click(await screen.findByRole('menuitem', { name: '删除' }))
  return screen.findByRole('alertdialog')
}

it('删除：确认框默认聚焦「取消」；确认后条目消失', async () => {
  let deleted = false
  onList(() => ({ ...ABC, items: ABC.items.filter((item) => !deleted || item.id !== 'c2') }))
  server.use(
    http.delete(apiUrl('/api/conversations/c2'), () => { deleted = true; return new HttpResponse(null, { status: 204 }) }),
  )
  const { user } = await renderOpen()
  const confirm = await openDeleteConfirm(user, 'Kyoto trip')
  expect(within(confirm).getByText('删除这段对话？')).toBeInTheDocument()
  expect(within(confirm).getByText('删除后无法恢复')).toBeInTheDocument()
  await waitFor(() => expect(within(confirm).getByRole('button', { name: '取消' })).toHaveFocus())
  await user.click(within(confirm).getByRole('button', { name: '删除' }))
  await waitFor(() => expect(screen.queryByText('Kyoto trip')).not.toBeInTheDocument(), {
    timeout: 3000,
  })
  expect(nav.replace).not.toHaveBeenCalled()
  expect(screen.getByText('Lisbon trip')).toBeInTheDocument()
})

it('删除：取消不发请求、条目保留', async () => {
  onList(() => ABC)
  let deletes = 0
  server.use(
    http.delete(apiUrl('/api/conversations/:id'), () => {
      deletes += 1
      return new HttpResponse(null, { status: 204 })
    }),
  )
  const { user } = await renderOpen()
  const confirm = await openDeleteConfirm(user, 'Kyoto trip')
  await user.click(within(confirm).getByRole('button', { name: '取消' }))
  await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument())
  expect(deletes).toBe(0)
  expect(screen.getByText('Kyoto trip')).toBeInTheDocument()
  expect(screen.getByRole('dialog', { name: '历史对话' })).toBeInTheDocument()
})

it('删除当前会话：router.replace("/chat")', async () => {
  onList(() => ABC)
  server.use(
    http.delete(apiUrl('/api/conversations/c2'), () => new HttpResponse(null, { status: 204 })),
  )
  const { user } = await renderOpen({ activeId: 'c2' })
  const confirm = await openDeleteConfirm(user, 'Kyoto trip')
  await user.click(within(confirm).getByRole('button', { name: '删除' }))
  await waitFor(() => expect(nav.replace).toHaveBeenCalledWith('/chat'))
})

it('删除失败：条目恢复并提示「删除失败」', async () => {
  onList(() => ABC)
  server.use(
    http.delete(apiUrl('/api/conversations/c2'), () =>
      HttpResponse.json({ code: 'INTERNAL', message: 'x' }, { status: 500 }),
    ),
  )
  const { user } = await renderOpen()
  const confirm = await openDeleteConfirm(user, 'Kyoto trip')
  await user.click(within(confirm).getByRole('button', { name: '删除' }))
  await waitFor(() =>
    expect(toastMock).toHaveBeenCalledWith('删除失败', { tone: 'danger' }),
  )
  expect(await screen.findByText('Kyoto trip', undefined, { timeout: 3000 })).toBeInTheDocument()
  expect(toastMock).toHaveBeenCalledTimes(1)
})

describe('加载更多', () => {
  const paged = (cursor: string | null): Page =>
    cursor === 'c2'
      ? { items: [conv('c4', 'Oslo trip')], nextCursor: null }
      : { items: [conv('c1', 'Lisbon trip')], nextCursor: 'c2' }

  it('滚到底部哨兵：请求下一页并显示三行骨架；失败时显示「加载失败」与「重试」，点击重试再次请求', async () => {
    let failNext = true
    let release: () => void = () => {}
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    onList(async (_q, cursor) => {
      if (cursor === 'c2') {
        if (failNext) throw HttpResponse.json({ code: 'INTERNAL', message: 'x' }, { status: 500 })
        await gate
      }
      return paged(cursor)
    })
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false, retryDelay: 0 } },
    })
    const { user } = await renderOpen({}, queryClient)
    await screen.findByText('Lisbon trip')

    // 第一次翻页失败：不再自动重试，出现重试按钮
    act(() => FakeObserver.live()!.callback([{ isIntersecting: true }]))
    expect(await screen.findByText('加载失败')).toBeInTheDocument()
    expect(listRequests.filter((r) => r.cursor === 'c2')).toHaveLength(1)
    const armed = FakeObserver.live()
    expect(armed).toBeUndefined()

    failNext = false
    await user.click(screen.getByRole('button', { name: '重试' }))
    expect(await screen.findAllByTestId('drawer-skeleton')).toHaveLength(3)
    expect(listRequests.filter((r) => r.cursor === 'c2')).toHaveLength(2)
    act(() => release())
    expect(await screen.findByText('Oslo trip')).toBeInTheDocument()
    expect(screen.queryByTestId('drawer-skeleton')).not.toBeInTheDocument()
    expect(screen.queryByText('加载失败')).not.toBeInTheDocument()
  })
})

it('标题为空字符串的会话显示「新对话」', async () => {
  onList(() => ({ items: [conv('c9', '')], nextCursor: null }))
  await renderOpen()
  const item = (await screen.findByRole('list')).querySelector('li') as HTMLElement
  expect(within(item).getByText('新对话')).toBeInTheDocument()
})
