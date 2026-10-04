'use client'
import { useQuery } from '@tanstack/react-query'
import {
  UIConversationStateSchema,
  type UIConversationState,
} from '@autix/contracts'
import { api } from '@/features/auth/api-client'

export const uiStateKey = (id: string | null) =>
  ['conversation-ui', id] as const
export function useUIState(id: string | null) {
  return useQuery({
    queryKey: uiStateKey(id),
    enabled: id !== null,
    retry: false,
    queryFn: async ({ signal }): Promise<UIConversationState> =>
      UIConversationStateSchema.parse(
        await api(`/api/conversations/${encodeURIComponent(id!)}/ui-state`, {
          signal,
        }),
      ),
  })
}
