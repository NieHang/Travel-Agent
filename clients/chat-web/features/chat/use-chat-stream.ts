'use client'

import type { Message, Requirement } from '@autix/contracts'
import { useQueryClient, type QueryClient } from '@tanstack/react-query'
import { useCallback, useEffect, useRef, useState } from 'react'
import { apiFetch, ApiRequestError } from '@/features/auth/api-client'
import { messagesKey } from '@/features/conversations/queries'
import { upsertMessage } from './message-cache'
import { createSseParser } from './sse'

export type StreamPhase = 'idle' | 'sending' | 'streaming'
export type SendOutcome = { ok: true } | { ok: false; error: ApiRequestError }

const CONVERSATIONS_ROOT = ['conversations'] as const

const aborted = () => new ApiRequestError('ABORTED', 0)

function localAssistantMessage(
  conversationId: string,
  content: string,
  status: 'partial' | 'error',
  requirements: Requirement[],
): Message {
  return {
    id: `local-${crypto.randomUUID()}`,
    conversationId,
    role: 'ASSISTANT',
    content,
    status,
    metadata: requirements.length > 0 ? { requirements } : null,
    createdAt: new Date().toISOString(),
  }
}

function invalidateMessages(queryClient: QueryClient, conversationId: string) {
  return queryClient.invalidateQueries({ queryKey: messagesKey(conversationId) })
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
  requirements: Requirement[]
  activeConversationId: string | null
  send(conversationId: string, content: string): Promise<SendOutcome>
  stop(): void
} {
  const queryClient = useQueryClient()
  const [phase, setPhase] = useState<StreamPhase>('idle')
  const [text, setText] = useState('')
  const [requirements, setRequirements] = useState<Requirement[]>([])
  const [activeConversationId, setActiveConversationId] = useState<string | null>(null)

  // 同步镜像：send 在同一个事件循环里被连续调用时，state 还没更新，必须靠 ref 判断
  const phaseRef = useRef<StreamPhase>('idle')
  const activeRef = useRef<string | null>(null)
  const controllerRef = useRef<AbortController | null>(null)
  // 初始为 true：挂载 effect 之前发起的 send 也要能更新状态；只有卸载清理把它置 false
  const mountedRef = useRef(true)

  const stop = useCallback(() => {
    controllerRef.current?.abort()
  }, [])

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
    }
  }, [conversationId])

  const send = useCallback(
    async (targetId: string, content: string): Promise<SendOutcome> => {
      if (phaseRef.current !== 'idle') return { ok: false, error: aborted() }

      const controller = new AbortController()
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
        setRequirements([])
        setActiveConversationId(targetId)
      })

      const finish = () => {
        phaseRef.current = 'idle'
        activeRef.current = null
        if (controllerRef.current === controller) controllerRef.current = null
        live(() => {
          setPhase('idle')
          setText('')
          setRequirements([])
          setActiveConversationId(null)
        })
      }

      let accText = ''
      let accRequirements: Requirement[] = []
      let gotUserMessage = false

      try {
        let response: Response
        try {
          response = await apiFetch(
            `/api/conversations/${encodeURIComponent(targetId)}/messages`,
            {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ content }),
              signal,
            },
          )
        } catch (error) {
          if (signal.aborted) {
            // 请求可能已到达服务端，重新拉取以对齐
            void invalidateMessages(queryClient, targetId)
            return { ok: false, error: aborted() }
          }
          return {
            ok: false,
            error: error instanceof ApiRequestError ? error : new ApiRequestError('NETWORK', 0),
          }
        }

        const reader = response.body?.getReader()
        const parser = createSseParser()
        let completed = false

        try {
          while (reader && !completed) {
            let chunk: ReadableStreamReadResult<Uint8Array>
            try {
              chunk = await abortable(reader.read(), signal)
            } catch {
              // 只吞读流本身的失败：中止走下面的 stop 分支，其余按「流提前结束」处理。
              // 事件处理里的异常不在此捕获，会在清理后向上抛出
              break
            }
            if (chunk.done) break
            for (const event of parser.push(chunk.value)) {
              if (signal.aborted) break
              phaseRef.current = 'streaming'
              live(() => setPhase('streaming'))
              switch (event.event) {
                case 'user_message':
                  gotUserMessage = true
                  upsertMessage(queryClient, targetId, event.data.message)
                  void queryClient.invalidateQueries({ queryKey: CONVERSATIONS_ROOT })
                  break
                case 'delta':
                  accText += event.data.text
                  live(() => setText(accText))
                  break
                case 'requirement':
                  accRequirements = event.data.requirements
                  live(() => setRequirements(accRequirements))
                  break
                case 'done':
                case 'error':
                  upsertMessage(queryClient, targetId, event.data.message)
                  completed = true
                  break
              }
              if (completed) break
            }
            if (signal.aborted) break
          }
        } finally {
          void reader?.cancel().catch(() => {})
        }

        if (completed && !signal.aborted) {
          finish()
          // 助手消息已写入、顺序变了：列表重新排序
          void queryClient.invalidateQueries({ queryKey: CONVERSATIONS_ROOT })
          return { ok: true }
        }

        if (signal.aborted) {
          if (!gotUserMessage) {
            void invalidateMessages(queryClient, targetId)
            return { ok: false, error: aborted() }
          }
          // 先写本地消息再失效：setQueryData 会清掉失效标记，顺序反了则没有观察者时永远不会重新拉取
          upsertMessage(
            queryClient,
            targetId,
            localAssistantMessage(targetId, accText, 'partial', accRequirements),
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
          localAssistantMessage(targetId, accText, 'error', accRequirements),
        )
        void invalidateMessages(queryClient, targetId)
        return { ok: true }
      } finally {
        finish()
      }
    },
    [queryClient],
  )

  return { phase, text, requirements, activeConversationId, send, stop }
}
