'use client'

import type {
  Component,
  Message,
  SendTurnRequest,
  TripView,
} from '@autix/contracts'
import { useQueryClient, type QueryClient } from '@tanstack/react-query'
import { useCallback, useEffect, useRef, useState } from 'react'
import { apiFetch, ApiRequestError } from '@/features/auth/api-client'
import { accountId } from '@/features/auth/account-cache'
import { authStore } from '@/features/auth/auth-store'
import { messagesKey } from '@/features/conversations/queries'
import { upsertMessage } from './message-cache'
import { streamTurn } from './ui-stream-client'
import { uiStateKey } from './ui-state'
import {
  createAIUIStore,
  type ProgressPhase,
  type StreamOutcome,
} from '@/stores/ai-ui.store'
import { useStore } from 'zustand'

export type StreamPhase = 'idle' | 'sending' | 'streaming'
export type SendOutcome = { ok: true } | { ok: false; error: ApiRequestError }

const CONVERSATIONS_ROOT = ['conversations'] as const

const aborted = () => new ApiRequestError('ABORTED', 0)

function localAssistantMessage(
  conversationId: string,
  content: string,
  status: 'partial' | 'error',
): Message {
  return {
    id: `local-${crypto.randomUUID()}`,
    conversationId,
    role: 'ASSISTANT',
    content,
    status,
    metadata: null,
    createdAt: new Date().toISOString(),
  }
}

function invalidateMessages(queryClient: QueryClient, conversationId: string) {
  void queryClient.invalidateQueries({ queryKey: uiStateKey(conversationId) })
  return queryClient.invalidateQueries({
    queryKey: messagesKey(conversationId),
  })
}

/** signal 中止时让 promise 立即以 ABORTED 失败，把阻塞在 reader.read() 上的等待唤醒。 */
function abortable<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(aborted())
    if (signal.aborted) return onAbort()
    signal.addEventListener('abort', onAbort, { once: true })
    promise.then(
      (value) => {
        signal.removeEventListener('abort', onAbort)
        resolve(value)
      },
      (error: unknown) => {
        signal.removeEventListener('abort', onAbort)
        reject(error)
      },
    )
  })
}

export function useChatStream(conversationId: string | null): {
  phase: StreamPhase
  text: string
  activeConversationId: string | null
  components: Component[]
  progressPhase: ProgressPhase | null
  trip: TripView | null | undefined
  streamConversationId: string | null
  outcome: StreamOutcome
  send(conversationId: string, request: SendTurnRequest): Promise<SendOutcome>
  stop(): void
} {
  const queryClient = useQueryClient()
  const [uiStore] = useState(createAIUIStore)
  const ui = useStore(uiStore)
  const [phase, setPhase] = useState<StreamPhase>('idle')
  const [text, setText] = useState('')
  const [activeConversationId, setActiveConversationId] = useState<
    string | null
  >(null)

  // 同步镜像：send 在同一个事件循环里被连续调用时，state 还没更新，必须靠 ref 判断
  const phaseRef = useRef<StreamPhase>('idle')
  const activeRef = useRef<string | null>(null)
  const controllerRef = useRef<AbortController | null>(null)
  // 初始为 true：挂载 effect 之前发起的 send 也要能更新状态；只有卸载清理把它置 false
  const mountedRef = useRef(true)

  const stop = useCallback(() => {
    const requestId = uiStore.getState().requestId
    if (requestId) uiStore.getState().cancel(requestId)
    controllerRef.current?.abort()
  }, [uiStore])

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      controllerRef.current?.abort()
    }
  }, [])

  useEffect(() => {
    if (activeRef.current !== null && conversationId !== activeRef.current) {
      controllerRef.current?.abort()
      uiStore.getState().reset()
    } else if (
      activeRef.current === null &&
      uiStore.getState().conversationId !== conversationId
    )
      uiStore.getState().reset()
  }, [conversationId, uiStore])

  const send = useCallback(
    async (
      targetId: string,
      request: SendTurnRequest,
    ): Promise<SendOutcome> => {
      if (phaseRef.current !== 'idle') return { ok: false, error: aborted() }

      const controller = new AbortController()
      const requestId = crypto.randomUUID()
      uiStore.getState().begin(requestId, targetId)
      const sourceAccount = accountId()
      const accountChanged = () => sourceAccount !== accountId()
      const unsubscribeAccount = authStore.subscribe(() => {
        if (accountChanged()) {
          controller.abort()
          uiStore.getState().reset()
        }
      })
      const { signal } = controller
      controllerRef.current = controller
      phaseRef.current = 'sending'
      activeRef.current = targetId

      const live = (fn: () => void) => {
        if (mountedRef.current) fn()
      }
      live(() => {
        setPhase('sending')
        setText('')
        setActiveConversationId(targetId)
      })

      const finish = () => {
        phaseRef.current = 'idle'
        activeRef.current = null
        if (controllerRef.current === controller) controllerRef.current = null
        live(() => {
          setPhase('idle')
          setText('')
            setActiveConversationId(null)
        })
      }

      let accText = ''
      let gotUserMessage = false

      try {
        // InfiniteQuery 分页会按请求开始时的快照写回，发送前先取消它。
        await queryClient.cancelQueries({ queryKey: messagesKey(targetId) })
        await queryClient.cancelQueries({ queryKey: uiStateKey(targetId) })
        if (signal.aborted || accountChanged())
          return { ok: false, error: aborted() }
        let completed = false
        let failed = false
        try {
          await streamTurn(
            `/api/conversations/${encodeURIComponent(targetId)}/messages`,
            request,
            signal,
            (event) => {
              if (accountChanged() || signal.aborted || completed) return
              uiStore.getState().receive(requestId, event)
              phaseRef.current = 'streaming'
              live(() => setPhase('streaming'))
              switch (event.type) {
                case 'start':
                  gotUserMessage = true
                  upsertMessage(queryClient, targetId, event.userMessage)
                  void queryClient.invalidateQueries({ queryKey: CONVERSATIONS_ROOT })
                  break
                case 'text':
                  accText += event.delta
                  break
                case 'done':
                  upsertMessage(queryClient, targetId, event.message)
                  queryClient.setQueryData(uiStateKey(targetId), {
                    revision: event.message.metadata?.revision ?? 0,
                    trip: event.trip,
                    components: event.components,
                  })
                  completed = true
                  break
                case 'error':
                  if (event.message) upsertMessage(queryClient, targetId, event.message)
                  completed = true
                  failed = true
                  break
              }
            },
          )
        } catch (error) {
          if (!signal.aborted && !(error instanceof ApiRequestError))
            throw error
          if (!gotUserMessage) {
            if (
              !accountChanged() &&
              (signal.aborted ||
                (
                  (error as ApiRequestError).details as
                    { streamOpened?: boolean } | undefined
                )?.streamOpened)
            )
              void invalidateMessages(queryClient, targetId)
            return {
              ok: false,
              error: signal.aborted
                ? aborted()
                : error instanceof ApiRequestError
                  ? error
                  : new ApiRequestError('NETWORK', 0),
            }
          }
        }

        if (accountChanged()) return { ok: false, error: aborted() }
        if (failed)
          return { ok: false, error: new ApiRequestError('MODEL_FAILED', 502) }
        if (completed && !signal.aborted) {
          finish()
          // 助手消息已写入、顺序变了：列表重新排序
          void queryClient.invalidateQueries({ queryKey: CONVERSATIONS_ROOT })
          return { ok: true }
        }

        if (signal.aborted) {
          uiStore.getState().cancel(requestId)
          if (!gotUserMessage) {
            void invalidateMessages(queryClient, targetId)
            return { ok: false, error: aborted() }
          }
          // 先写本地消息再失效：setQueryData 会清掉失效标记，顺序反了则没有观察者时永远不会重新拉取
          upsertMessage(
            queryClient,
            targetId,
            localAssistantMessage(targetId, accText, 'partial'),
          )
          void invalidateMessages(queryClient, targetId)
          return { ok: true }
        }

        // 流结束但没有 done / error：不能把已收到的 delta 当成完整回复
        if (!gotUserMessage) {
          void invalidateMessages(queryClient, targetId)
          return { ok: false, error: new ApiRequestError('NETWORK', 0) }
        }
        upsertMessage(
          queryClient,
          targetId,
          localAssistantMessage(targetId, accText, 'error'),
        )
        void invalidateMessages(queryClient, targetId)
        return { ok: true }
      } finally {
        unsubscribeAccount()
        if (signal.aborted) uiStore.getState().cancel(requestId)
        else if (!uiStore.getState().terminal)
          uiStore.getState().receive(requestId, { type: 'error', code: 'MODEL_FAILED' })
        finish()
      }
    },
    [queryClient, uiStore],
  )

  return {
    phase,
    text: phase === 'idle' ? '' : ui.text || text,
    activeConversationId,
    send,
    stop,
    components: ui.components,
    progressPhase: ui.phase,
    trip: ui.trip,
    streamConversationId: ui.conversationId,
    outcome: ui.outcome,
  }
}
