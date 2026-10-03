import type { Conversation, Page } from '@autix/contracts'
import { QueryClient, type InfiniteData } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react'
import { delay, http, HttpResponse } from 'msw'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { toast } from '@/components/ui/toast'
import { authStore } from '@/features/auth/auth-store'
import { apiUrl, server } from '@/test/server'
import { makeConversation, makeMessage } from '@/test/fixtures'
import { createWrapper } from '@/test/render'
import {
  conversationsKey,
  messagesKey,
  useConversations,
  useDeleteConversation,
  useMessages,
  useRenameConversation,
} from './queries'

vi.mock('@/components/ui/toast', () => ({ toast: vi.fn() }))

const page = (
  items: Conversation[],
  nextCursor: string | null = null,
): Page<Conversation> => ({ items, nextCursor })

beforeEach(() => vi.mocked(toast).mockClear())
afterEach(() => authStore.reset())

function flat(qc: QueryClient, key: readonly unknown[]) {
  const data = qc.getQueryData<InfiniteData<Page<Conversation>>>(key)
  return data?.pages.flatMap((p) => p.items) ?? []
}

function titleIn(qc: QueryClient, key: readonly unknown[], id: string) {
  return flat(qc, key).find((c) => c.id === id)?.title
}

function idsIn(qc: QueryClient, key: readonly unknown[]) {
  return flat(qc, key).map((c) => c.id)
}

function seed(qc: QueryClient) {
  for (const q of ['', '里']) {
    qc.setQueryData<InfiniteData<Page<Conversation>>>(conversationsKey(q), {
      pages: [
        page([
          makeConversation({ id: 'c1', title: '旧标题' }),
          makeConversation({ id: 'c2', title: '里斯本' }),
        ]),
      ],
      pageParams: [undefined],
    })
  }
}

describe('useConversations', () => {
  it('第一页不带 cursor；fetchNextPage 带上一页的 nextCursor；nextCursor 为 null 时 hasNextPage 为 false', async () => {
    const cursors: (string | null)[] = []
    server.use(
      http.get(apiUrl('/api/conversations'), ({ request }) => {
        const cursor = new URL(request.url).searchParams.get('cursor')
        cursors.push(cursor)
        return HttpResponse.json(
          cursor
            ? page([makeConversation({ id: 'c2' })])
            : page([makeConversation({ id: 'c1' })], 'cur_1'),
        )
      }),
    )
    const { Wrapper } = createWrapper()
    const { result } = renderHook(() => useConversations(''), {
      wrapper: Wrapper,
    })
    await waitFor(() => expect(result.current.data?.pages).toHaveLength(1))
    expect(cursors).toEqual([null])
    expect(result.current.hasNextPage).toBe(true)

    await act(() => result.current.fetchNextPage())
    await waitFor(() => expect(result.current.data?.pages).toHaveLength(2))
    expect(cursors).toEqual([null, 'cur_1'])
    expect(result.current.hasNextPage).toBe(false)
  })

  it('搜索词是查询键的一部分，请求带 q；空白搜索词不带 q', async () => {
    const seen: (string | null)[] = []
    server.use(
      http.get(apiUrl('/api/conversations'), ({ request }) => {
        seen.push(new URL(request.url).searchParams.get('q'))
        return HttpResponse.json(page([]))
      }),
    )
    const { Wrapper, queryClient } = createWrapper()
    const first = renderHook(() => useConversations(' 京都 '), {
      wrapper: Wrapper,
    })
    await waitFor(() => expect(first.result.current.isSuccess).toBe(true))
    const blank = renderHook(() => useConversations('   '), {
      wrapper: Wrapper,
    })
    await waitFor(() => expect(blank.result.current.isSuccess).toBe(true))
    expect(seen).toEqual(['京都', null])
    expect(queryClient.getQueryData(conversationsKey(' 京都 '))).toBeDefined()
    expect(queryClient.getQueryData(conversationsKey('   '))).toBeDefined()
  })
})

describe('useMessages', () => {
  it('id 为 null 时不发请求', async () => {
    let requests = 0
    server.use(
      http.get(apiUrl('/api/conversations/:id/messages'), () => {
        requests += 1
        return HttpResponse.json({ items: [], nextCursor: null })
      }),
    )
    const { Wrapper } = createWrapper()
    const { result } = renderHook(() => useMessages(null), { wrapper: Wrapper })
    await new Promise((r) => setTimeout(r, 50))
    expect(requests).toBe(0)
    expect(result.current.fetchStatus).toBe('idle')
  })

  it('按后端顺序（新到旧）保留消息，并用 nextCursor 翻页', async () => {
    server.use(
      http.get(apiUrl('/api/conversations/c1/messages'), ({ request }) => {
        const cursor = new URL(request.url).searchParams.get('cursor')
        return HttpResponse.json(
          cursor
            ? { items: [makeMessage({ id: 'm1' })], nextCursor: null }
            : {
                items: [makeMessage({ id: 'm3' }), makeMessage({ id: 'm2' })],
                nextCursor: 'cur',
              },
        )
      }),
    )
    const { Wrapper } = createWrapper()
    const { result } = renderHook(() => useMessages('c1'), { wrapper: Wrapper })
    await waitFor(() => expect(result.current.hasNextPage).toBe(true))
    await act(() => result.current.fetchNextPage())
    await waitFor(() => expect(result.current.data?.pages).toHaveLength(2))
    expect(
      result.current.data?.pages.flatMap((p) => p.items.map((m) => m.id)),
    ).toEqual(['m3', 'm2', 'm1'])
  })

  it('CONVERSATION_NOT_FOUND 只请求一次，error.code 可读；其他错误会重试', async () => {
    let notFound = 0
    let failing = 0
    server.use(
      http.get(apiUrl('/api/conversations/gone/messages'), () => {
        notFound += 1
        return HttpResponse.json(
          { code: 'CONVERSATION_NOT_FOUND' },
          { status: 404 },
        )
      }),
      http.get(apiUrl('/api/conversations/boom/messages'), () => {
        failing += 1
        return HttpResponse.json({ code: 'INTERNAL_ERROR' }, { status: 500 })
      }),
    )
    // 保留默认重试，才能验证 hook 自己的规则
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retryDelay: 0 } },
    })
    const { Wrapper } = createWrapper({ queryClient })
    const gone = renderHook(() => useMessages('gone'), { wrapper: Wrapper })
    await waitFor(() => expect(gone.result.current.isError).toBe(true))
    expect(gone.result.current.error?.code).toBe('CONVERSATION_NOT_FOUND')
    expect(notFound).toBe(1)

    const boom = renderHook(() => useMessages('boom'), { wrapper: Wrapper })
    await waitFor(() => expect(boom.result.current.isError).toBe(true))
    expect(failing).toBeGreaterThan(1)
  })
})

describe('useRenameConversation', () => {
  it('乐观更新：请求返回前标题已变；两份缓存都变', async () => {
    server.use(
      http.patch(apiUrl('/api/conversations/c1'), async () => {
        await delay(200)
        return HttpResponse.json(
          makeConversation({ id: 'c1', title: '新标题' }),
        )
      }),
    )
    const { Wrapper, queryClient } = createWrapper()
    seed(queryClient)
    const { result } = renderHook(() => useRenameConversation(), {
      wrapper: Wrapper,
    })
    act(() => result.current.mutate({ id: 'c1', title: '新标题' }))
    await waitFor(() =>
      expect(titleIn(queryClient, conversationsKey(''), 'c1')).toBe('新标题'),
    )
    expect(titleIn(queryClient, conversationsKey('里'), 'c1')).toBe('新标题')
    expect(result.current.isPending).toBe(true)
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(titleIn(queryClient, conversationsKey(''), 'c1')).toBe('新标题')
    expect(toast).not.toHaveBeenCalled()
  })

  it('失败：还原为旧标题并提示「重命名失败」', async () => {
    server.use(
      http.patch(apiUrl('/api/conversations/c1'), () =>
        HttpResponse.json({ code: 'INTERNAL_ERROR' }, { status: 500 }),
      ),
    )
    const { Wrapper, queryClient } = createWrapper()
    seed(queryClient)
    const { result } = renderHook(() => useRenameConversation(), {
      wrapper: Wrapper,
    })
    act(() => result.current.mutate({ id: 'c1', title: '新标题' }))
    await waitFor(() => expect(result.current.isError).toBe(true))
    expect(titleIn(queryClient, conversationsKey(''), 'c1')).toBe('旧标题')
    expect(titleIn(queryClient, conversationsKey('里'), 'c1')).toBe('旧标题')
    expect(toast).toHaveBeenCalledWith('重命名失败', { tone: 'danger' })
  })

  it('取消在途的列表请求，迟到的响应不会覆盖乐观状态', async () => {
    server.use(
      http.get(apiUrl('/api/conversations'), async () => {
        await delay(150)
        return HttpResponse.json(
          page([makeConversation({ id: 'c1', title: '旧标题' })]),
        )
      }),
      http.patch(apiUrl('/api/conversations/c1'), async () => {
        await delay(400)
        return HttpResponse.json(
          makeConversation({ id: 'c1', title: '新标题' }),
        )
      }),
    )
    const { Wrapper, queryClient } = createWrapper()
    seed(queryClient)
    const list = renderHook(() => useConversations(''), { wrapper: Wrapper })
    const rename = renderHook(() => useRenameConversation(), {
      wrapper: Wrapper,
    })
    // 种子数据已过期，挂载即发起列表请求，此刻尚在途中
    await waitFor(() => expect(list.result.current.isFetching).toBe(true))
    act(() => rename.result.current.mutate({ id: 'c1', title: '新标题' }))
    await new Promise((r) => setTimeout(r, 300))
    expect(titleIn(queryClient, conversationsKey(''), 'c1')).toBe('新标题')
  })
})

describe('useDeleteConversation', () => {
  it('乐观更新：条目立即从所有缓存消失；成功后 messagesKey(id) 被移除', async () => {
    server.use(
      http.delete(apiUrl('/api/conversations/c1'), async () => {
        await delay(200)
        return new HttpResponse(null, { status: 204 })
      }),
    )
    const { Wrapper, queryClient } = createWrapper()
    seed(queryClient)
    queryClient.setQueryData(messagesKey('c1'), { pages: [], pageParams: [] })
    const { result } = renderHook(() => useDeleteConversation(), {
      wrapper: Wrapper,
    })
    act(() => result.current.mutate({ id: 'c1' }))
    await waitFor(() =>
      expect(idsIn(queryClient, conversationsKey(''))).toEqual(['c2']),
    )
    expect(idsIn(queryClient, conversationsKey('里'))).toEqual(['c2'])
    expect(queryClient.getQueryData(messagesKey('c1'))).toBeDefined()
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(queryClient.getQueryData(messagesKey('c1'))).toBeUndefined()
  })

  it('失败：条目回到原位置并提示「删除失败」', async () => {
    server.use(
      http.delete(apiUrl('/api/conversations/c1'), () =>
        HttpResponse.json({ code: 'INTERNAL_ERROR' }, { status: 500 }),
      ),
    )
    const { Wrapper, queryClient } = createWrapper()
    seed(queryClient)
    queryClient.setQueryData(messagesKey('c1'), { pages: [], pageParams: [] })
    const { result } = renderHook(() => useDeleteConversation(), {
      wrapper: Wrapper,
    })
    act(() => result.current.mutate({ id: 'c1' }))
    await waitFor(() => expect(result.current.isError).toBe(true))
    expect(idsIn(queryClient, conversationsKey(''))).toEqual(['c1', 'c2'])
    expect(idsIn(queryClient, conversationsKey('里'))).toEqual(['c1', 'c2'])
    expect(queryClient.getQueryData(messagesKey('c1'))).toBeDefined()
    expect(toast).toHaveBeenCalledWith('删除失败', { tone: 'danger' })
  })
})

describe('并发变更与对齐', () => {
  const ok204 = () => new HttpResponse(null, { status: 204 })
  const fail500 = () =>
    HttpResponse.json({ code: 'INTERNAL_ERROR' }, { status: 500 })

  it('重命名失败（延迟）与并发删除 c2（成功）：c1 恢复旧标题，c2 仍被删除', async () => {
    server.use(
      http.patch(apiUrl('/api/conversations/c1'), async () => {
        await delay(200)
        return fail500()
      }),
      http.delete(apiUrl('/api/conversations/c2'), ok204),
    )
    const { Wrapper, queryClient } = createWrapper()
    seed(queryClient)
    const rename = renderHook(() => useRenameConversation(), { wrapper: Wrapper })
    const del = renderHook(() => useDeleteConversation(), { wrapper: Wrapper })
    act(() => rename.result.current.mutate({ id: 'c1', title: '新标题' }))
    await waitFor(() =>
      expect(titleIn(queryClient, conversationsKey(''), 'c1')).toBe('新标题'),
    )
    act(() => del.result.current.mutate({ id: 'c2' }))
    await waitFor(() => expect(rename.result.current.isError).toBe(true))
    await waitFor(() => expect(del.result.current.isSuccess).toBe(true))
    for (const q of ['', '里']) {
      expect(titleIn(queryClient, conversationsKey(q), 'c1')).toBe('旧标题')
      expect(idsIn(queryClient, conversationsKey(q))).toEqual(['c1'])
    }
  })

  it('删除 c2 失败（延迟）与并发重命名 c1（成功）：c2 回到原位，c1 保持新标题', async () => {
    server.use(
      http.delete(apiUrl('/api/conversations/c2'), async () => {
        await delay(200)
        return fail500()
      }),
      http.patch(apiUrl('/api/conversations/c1'), () =>
        HttpResponse.json(makeConversation({ id: 'c1', title: '新标题' })),
      ),
    )
    const { Wrapper, queryClient } = createWrapper()
    seed(queryClient)
    const rename = renderHook(() => useRenameConversation(), { wrapper: Wrapper })
    const del = renderHook(() => useDeleteConversation(), { wrapper: Wrapper })
    act(() => del.result.current.mutate({ id: 'c2' }))
    await waitFor(() =>
      expect(idsIn(queryClient, conversationsKey(''))).toEqual(['c1']),
    )
    act(() => rename.result.current.mutate({ id: 'c1', title: '新标题' }))
    await waitFor(() => expect(rename.result.current.isSuccess).toBe(true))
    await waitFor(() => expect(del.result.current.isError).toBe(true))
    for (const q of ['', '里']) {
      expect(idsIn(queryClient, conversationsKey(q))).toEqual(['c1', 'c2'])
      expect(titleIn(queryClient, conversationsKey(q), 'c1')).toBe('新标题')
    }
  })

  it('目标在第二页：乐观重命名与删除都作用于该页；删除失败后回到第二页原位', async () => {
    server.use(
      http.patch(apiUrl('/api/conversations/c4'), async () => {
        await delay(50)
        return HttpResponse.json(makeConversation({ id: 'c4', title: '改' }))
      }),
      http.delete(apiUrl('/api/conversations/c4'), async () => {
        await delay(100)
        return fail500()
      }),
    )
    const { Wrapper, queryClient } = createWrapper()
    queryClient.setQueryData<InfiniteData<Page<Conversation>>>(
      conversationsKey(''),
      {
        pages: [
          page([makeConversation({ id: 'c1' }), makeConversation({ id: 'c2' })], 'x'),
          page([
            makeConversation({ id: 'c3' }),
            makeConversation({ id: 'c4', title: '原' }),
            makeConversation({ id: 'c5' }),
          ]),
        ],
        pageParams: [undefined, 'x'],
      },
    )
    const rename = renderHook(() => useRenameConversation(), { wrapper: Wrapper })
    const del = renderHook(() => useDeleteConversation(), { wrapper: Wrapper })
    act(() => rename.result.current.mutate({ id: 'c4', title: '改' }))
    await waitFor(() =>
      expect(titleIn(queryClient, conversationsKey(''), 'c4')).toBe('改'),
    )
    await waitFor(() => expect(rename.result.current.isSuccess).toBe(true))
    act(() => del.result.current.mutate({ id: 'c4' }))
    await waitFor(() =>
      expect(idsIn(queryClient, conversationsKey(''))).toEqual(['c1', 'c2', 'c3', 'c5']),
    )
    await waitFor(() => expect(del.result.current.isError).toBe(true))
    const data = queryClient.getQueryData<InfiniteData<Page<Conversation>>>(
      conversationsKey(''),
    )
    expect(data?.pages[0].items.map((c) => c.id)).toEqual(['c1', 'c2'])
    expect(data?.pages[1].items.map((c) => c.id)).toEqual(['c3', 'c4', 'c5'])
  })

  describe('对齐', () => {
    function countList() {
      const count = { n: 0 }
      server.use(
        http.get(apiUrl('/api/conversations'), () => {
          count.n += 1
          return HttpResponse.json(page([makeConversation({ id: 'c1' })]))
        }),
      )
      return count
    }

    it('删除成功后重新请求列表', async () => {
      const count = countList()
      server.use(http.delete(apiUrl('/api/conversations/c1'), ok204))
      const { Wrapper } = createWrapper()
      const list = renderHook(() => useConversations(''), { wrapper: Wrapper })
      const del = renderHook(() => useDeleteConversation(), { wrapper: Wrapper })
      await waitFor(() => expect(list.result.current.isSuccess).toBe(true))
      expect(count.n).toBe(1)
      act(() => del.result.current.mutate({ id: 'c1' }))
      await waitFor(() => expect(count.n).toBe(2))
    })

    it('重命名失败后重新请求列表', async () => {
      const count = countList()
      server.use(http.patch(apiUrl('/api/conversations/c1'), fail500))
      const { Wrapper } = createWrapper()
      const list = renderHook(() => useConversations(''), { wrapper: Wrapper })
      const rename = renderHook(() => useRenameConversation(), { wrapper: Wrapper })
      await waitFor(() => expect(list.result.current.isSuccess).toBe(true))
      act(() => rename.result.current.mutate({ id: 'c1', title: 'x' }))
      await waitFor(() => expect(count.n).toBe(2))
    })

    it('重命名成功后不重新请求列表', async () => {
      const count = countList()
      server.use(
        http.patch(apiUrl('/api/conversations/c1'), () =>
          HttpResponse.json(makeConversation({ id: 'c1', title: 'x' })),
        ),
      )
      const { Wrapper } = createWrapper()
      const list = renderHook(() => useConversations(''), { wrapper: Wrapper })
      const rename = renderHook(() => useRenameConversation(), { wrapper: Wrapper })
      await waitFor(() => expect(list.result.current.isSuccess).toBe(true))
      act(() => rename.result.current.mutate({ id: 'c1', title: 'x' }))
      await waitFor(() => expect(rename.result.current.isSuccess).toBe(true))
      await new Promise((r) => setTimeout(r, 100))
      expect(count.n).toBe(1)
    })
  })
})
