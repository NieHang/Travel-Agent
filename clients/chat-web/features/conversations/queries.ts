'use client'

import type { Conversation, Message, Page } from '@autix/contracts'
import {
  useInfiniteQuery,
  useMutation,
  useQueryClient,
  type InfiniteData,
  type QueryClient,
  type QueryKey,
  type UseInfiniteQueryResult,
  type UseMutationResult,
} from '@tanstack/react-query'
import { useTranslations } from 'next-intl'
import { ApiRequestError } from '@/features/auth/api-client'
import { toast } from '@/components/ui/toast'
import {
  deleteConversation,
  listConversations,
  listMessages,
  renameConversation,
} from './api'

type ConversationPages = InfiniteData<Page<Conversation>>
type RenameContext = { previousTitle: string | undefined }
type Removed = {
  key: QueryKey
  pageIndex: number
  index: number
  item: Conversation
}
type DeleteContext = { removed: Removed[] }

const CONVERSATIONS_ROOT = ['conversations'] as const
const MAX_RETRIES = 3

export const conversationsKey = (q: string) =>
  ['conversations', { q }] as const
export const messagesKey = (id: string | null) => ['messages', id] as const

function retryUnlessNotFound(count: number, error: Error): boolean {
  if (error instanceof ApiRequestError && error.code === 'CONVERSATION_NOT_FOUND') {
    return false
  }
  return count < MAX_RETRIES
}

export function useConversations(
  q: string,
): UseInfiniteQueryResult<InfiniteData<Page<Conversation>>, ApiRequestError> {
  return useInfiniteQuery<
    Page<Conversation>,
    ApiRequestError,
    InfiniteData<Page<Conversation>>,
    ReturnType<typeof conversationsKey>,
    string | undefined
  >({
    queryKey: conversationsKey(q),
    queryFn: ({ pageParam }) => listConversations({ cursor: pageParam, q }),
    initialPageParam: undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  })
}

export function useMessages(
  id: string | null,
  paused = false,
): UseInfiniteQueryResult<InfiniteData<Page<Message>>, ApiRequestError> {
  const client = useQueryClient()
  return useInfiniteQuery<
    Page<Message>,
    ApiRequestError,
    InfiniteData<Page<Message>>,
    ReturnType<typeof messagesKey>,
    string | undefined
  >({
    queryKey: messagesKey(id),
    queryFn: async ({ pageParam, signal }) => {
      const page = await listMessages(id as string, { cursor: pageParam }, signal)
      if (pageParam !== undefined) return page
      const existing = client.getQueryData<InfiniteData<Page<Message>>>(messagesKey(id))?.pages.flatMap(p => p.items) ?? []
      const pending = existing.filter((message, index) => {
        if (!message.id.startsWith('local-')) return false
        const anchor = existing.slice(index + 1).find(row => row.role === 'USER')
        const serverIndex = page.items.findIndex(row => row.id === anchor?.id)
        return serverIndex <= 0 || page.items[serverIndex - 1].role !== 'ASSISTANT'
      })
      return { ...page, items: [...pending, ...page.items] }
    },
    initialPageParam: undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    enabled: id !== null && !paused,
    staleTime: Infinity,
    refetchInterval: (query) => !paused && query.state.data?.pages.some(page => page.items.some(message => message.id.startsWith('local-'))) ? 1000 : false,
    retry: retryUnlessNotFound,
  })
}

function mapItems(
  queryClient: QueryClient,
  transform: (items: Conversation[]) => Conversation[],
) {
  queryClient.setQueriesData<ConversationPages>(
    { queryKey: CONVERSATIONS_ROOT },
    (data) =>
      data && {
        ...data,
        pages: data.pages.map((page) => ({
          ...page,
          items: transform(page.items),
        })),
      },
  )
}

function findTitle(queryClient: QueryClient, id: string): string | undefined {
  const entries = queryClient.getQueriesData<ConversationPages>({
    queryKey: CONVERSATIONS_ROOT,
  })
  for (const [, data] of entries) {
    for (const page of data?.pages ?? []) {
      const found = page.items.find((c) => c.id === id)
      if (found) return found.title
    }
  }
  return undefined
}

export function useRenameConversation(): UseMutationResult<
  Conversation,
  ApiRequestError,
  { id: string; title: string },
  RenameContext
> {
  const queryClient = useQueryClient()
  const t = useTranslations('drawer')
  return useMutation<
    Conversation,
    ApiRequestError,
    { id: string; title: string },
    RenameContext
  >({
    mutationFn: ({ id, title }) => renameConversation(id, title),
    onMutate: async ({ id, title }) => {
      await queryClient.cancelQueries({ queryKey: CONVERSATIONS_ROOT })
      const previousTitle = findTitle(queryClient, id)
      mapItems(queryClient, (items) =>
        items.map((c) => (c.id === id ? { ...c, title } : c)),
      )
      return { previousTitle }
    },
    onError: (_error, { id }, context) => {
      // 只还原本条的标题，不动并发变更对其他条目的修改
      const previous = context?.previousTitle
      if (previous !== undefined) {
        mapItems(queryClient, (items) =>
          items.map((c) => (c.id === id ? { ...c, title: previous } : c)),
        )
      }
      toast(t('renameFailed'), { tone: 'danger' })
      // 被取消的请求不会自动补回，失败后与服务端对齐
      void queryClient.invalidateQueries({ queryKey: CONVERSATIONS_ROOT })
    },
  })
}

export function useDeleteConversation(): UseMutationResult<
  void,
  ApiRequestError,
  { id: string },
  DeleteContext
> {
  const queryClient = useQueryClient()
  const t = useTranslations('drawer')
  return useMutation<void, ApiRequestError, { id: string }, DeleteContext>({
    mutationFn: ({ id }) => deleteConversation(id),
    onMutate: async ({ id }) => {
      await queryClient.cancelQueries({ queryKey: CONVERSATIONS_ROOT })
      const removed: Removed[] = []
      for (const [key, data] of queryClient.getQueriesData<ConversationPages>({
        queryKey: CONVERSATIONS_ROOT,
      })) {
        data?.pages.forEach((page, pageIndex) => {
          const index = page.items.findIndex((c) => c.id === id)
          if (index >= 0) {
            removed.push({ key, pageIndex, index, item: page.items[index] })
          }
        })
      }
      mapItems(queryClient, (items) => items.filter((c) => c.id !== id))
      return { removed }
    },
    onError: (_error, _vars, context) => {
      // 只把本条放回原页原位，不动其他条目
      for (const { key, pageIndex, index, item } of context?.removed ?? []) {
        queryClient.setQueryData<ConversationPages>(key, (data) => {
          if (!data || data.pages.length === 0) return data
          const target = Math.min(pageIndex, data.pages.length - 1)
          const pages = data.pages.map((page, i) => {
            if (i !== target || page.items.some((c) => c.id === item.id)) {
              return page
            }
            const items = [...page.items]
            items.splice(Math.min(index, items.length), 0, item)
            return { ...page, items }
          })
          return { ...data, pages }
        })
      }
      toast(t('deleteFailed'), { tone: 'danger' })
    },
    onSuccess: (_data, { id }) => {
      queryClient.removeQueries({ queryKey: messagesKey(id) })
    },
    // 取消过的请求不会自动补回；无论成败都重新对齐分页
    onSettled: () =>
      queryClient.invalidateQueries({ queryKey: CONVERSATIONS_ROOT }),
  })
}
