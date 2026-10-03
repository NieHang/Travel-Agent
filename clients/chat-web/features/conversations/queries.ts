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
type Snapshot = [QueryKey, ConversationPages | undefined][]

const CONVERSATIONS_ROOT = ['conversations'] as const
const MAX_RETRIES = 3

export const conversationsKey = (q: string) =>
  ['conversations', { q }] as const
export const messagesKey = (id: string) => ['messages', id] as const

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
): UseInfiniteQueryResult<InfiniteData<Page<Message>>, ApiRequestError> {
  return useInfiniteQuery<
    Page<Message>,
    ApiRequestError,
    InfiniteData<Page<Message>>,
    readonly ['messages', string | null],
    string | undefined
  >({
    queryKey: ['messages', id],
    queryFn: ({ pageParam }) => listMessages(id as string, { cursor: pageParam }),
    initialPageParam: undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    enabled: id !== null,
    staleTime: Infinity,
    retry: retryUnlessNotFound,
  })
}

/** 取消在途的列表查询、快照所有 ['conversations', *] 缓存，再套用乐观变换。 */
async function applyOptimistic(
  queryClient: QueryClient,
  transform: (items: Conversation[]) => Conversation[],
): Promise<Snapshot> {
  await queryClient.cancelQueries({ queryKey: CONVERSATIONS_ROOT })
  const snapshot = queryClient.getQueriesData<ConversationPages>({
    queryKey: CONVERSATIONS_ROOT,
  })
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
  return snapshot
}

function restore(queryClient: QueryClient, snapshot: Snapshot | undefined) {
  for (const [key, data] of snapshot ?? []) queryClient.setQueryData(key, data)
}

export function useRenameConversation(): UseMutationResult<
  Conversation,
  ApiRequestError,
  { id: string; title: string },
  Snapshot
> {
  const queryClient = useQueryClient()
  const t = useTranslations('drawer')
  return useMutation<
    Conversation,
    ApiRequestError,
    { id: string; title: string },
    Snapshot
  >({
    mutationFn: ({ id, title }) => renameConversation(id, title),
    onMutate: ({ id, title }) =>
      applyOptimistic(queryClient, (items) =>
        items.map((c) => (c.id === id ? { ...c, title } : c)),
      ),
    onError: (_error, _vars, snapshot) => {
      restore(queryClient, snapshot)
      toast(t('renameFailed'), { tone: 'danger' })
    },
  })
}

export function useDeleteConversation(): UseMutationResult<
  void,
  ApiRequestError,
  { id: string },
  Snapshot
> {
  const queryClient = useQueryClient()
  const t = useTranslations('drawer')
  return useMutation<void, ApiRequestError, { id: string }, Snapshot>({
    mutationFn: ({ id }) => deleteConversation(id),
    onMutate: ({ id }) =>
      applyOptimistic(queryClient, (items) => items.filter((c) => c.id !== id)),
    onError: (_error, _vars, snapshot) => {
      restore(queryClient, snapshot)
      toast(t('deleteFailed'), { tone: 'danger' })
    },
    onSuccess: (_data, { id }) => {
      queryClient.removeQueries({ queryKey: messagesKey(id) })
    },
  })
}
