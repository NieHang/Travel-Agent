'use client'

import { useEffect, useRef, useState, type FormEvent } from 'react'
import { api } from '@/features/auth/api-client'
import { ComponentRenderer } from './ComponentRenderer'
import type { AIUIResponse, UIAction, UIResponse } from './types'
import { fieldClass, primaryButtonClass } from './styles'

export interface AIChatContainerProps {
  /** Omit to create a new session for this mounted container. */
  sessionId?: string
  locale?: string
  className?: string
}

export interface AIChatMessage {
  id: string
  role: 'user' | 'assistant'
  message: string
  components: UIResponse[]
  action?: UIAction
}

function actionMessage(action: UIAction, component: UIResponse): string {
  switch (action.type) {
    case 'selection': return component.type === 'selection' ? action.values.map(value => component.options.find(option => option.value === value)?.label ?? value).join('、') : '提交选择'
    case 'form_submit': return component.type === 'form' ? component.submitLabel : '提交表单'
    case 'confirmation': return component.type === 'confirmation' ? (action.confirmed ? component.confirmLabel : component.cancelLabel) : '提交确认'
    case 'button_click': return component.type === 'action_buttons' ? component.buttons.find(button => button.id === action.buttonId)?.label ?? '执行操作' : '执行操作'
  }
}

/** Changing sessionId remounts the conversation and cancels in-flight requests. */
export function AIChatContainer(props: AIChatContainerProps) {
  return <Conversation key={props.sessionId ?? 'new-session'} {...props} />
}

function Conversation({ sessionId, locale, className = '' }: AIChatContainerProps) {
  const [history, setHistory] = useState<AIChatMessage[]>([])
  const [input, setInput] = useState('')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const generatedSessionId = useRef<string | null>(null)
  const request = useRef<AbortController | null>(null)
  const log = useRef<HTMLDivElement>(null)
  const latestAssistant = history.findLastIndex(message => message.role === 'assistant')

  useEffect(() => () => request.current?.abort(), [])
  useEffect(() => {
    log.current?.scrollTo({ top: log.current.scrollHeight, behavior: 'auto' })
  }, [history, pending])

  async function send(action?: UIAction) {
    // The ref closes the gap before React renders disabled controls.
    if (request.current) return
    const text = input.trim()
    const component = action ? history[latestAssistant]?.components.find(item => item.id === action.componentId) : undefined
    if (action ? !component : !text) return
    const controller = new AbortController()
    request.current = controller
    setPending(true)
    setError(null)
    generatedSessionId.current ??= crypto.randomUUID()
    const activeSession = sessionId ?? generatedSessionId.current
    const userMessage = action && component ? actionMessage(action, component) : text
    try {
      const response = await api<AIUIResponse>(action ? '/api/ui-chat/action' : '/api/ui-chat/chat', {
        method: 'POST', signal: controller.signal,
        body: { sessionId: activeSession, ...(action ? { action } : { input: text }), ...(locale ? { locale } : {}) },
      })
      if (controller.signal.aborted) return
      if (!response || typeof response.message !== 'string' || !Array.isArray(response.components) || response.components.some(item => !item || typeof item.id !== 'string' || typeof item.type !== 'string')) {
        throw new Error('Invalid UI response')
      }
      setHistory(messages => [
        ...messages,
        { id: crypto.randomUUID(), role: 'user', message: userMessage, components: [], ...(action ? { action } : {}) },
        { id: crypto.randomUUID(), role: 'assistant', message: response.message, components: response.components },
      ])
      if (!action) setInput('')
    } catch {
      if (!controller.signal.aborted) setError('请求失败，请稍后重试。')
    } finally {
      if (!controller.signal.aborted) {
        request.current = null
        setPending(false)
      }
    }
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    void send()
  }

  return (
    <section aria-label="AI 聊天" aria-busy={pending} className={`flex min-h-0 flex-col gap-4 text-gray-900 ${className}`}>
      <div ref={log} role="log" aria-label="聊天历史" aria-live="polite" aria-relevant="additions" className="min-h-0 flex-1 space-y-4 overflow-y-auto">
        {history.length === 0 && <p className="py-6 text-center text-sm text-gray-500">输入消息，开始对话</p>}
        {history.map((message, index) => <article key={message.id} aria-label={message.role === 'user' ? '用户消息' : 'AI 消息'} className={`space-y-3 rounded-xl p-3 ${message.role === 'user' ? 'ml-8 bg-blue-50' : 'mr-2 bg-gray-50'}`}>
          {message.message && <p className="whitespace-pre-wrap break-words text-sm">{message.message}</p>}
          {message.components.map(component => <ComponentRenderer key={component.id} component={component} disabled={pending || index !== latestAssistant} onAction={action => { void send(action) }} />)}
        </article>)}
      </div>
      {pending && <p role="status" className="text-sm text-gray-500">正在回复…</p>}
      {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
      <form onSubmit={submit} className="flex items-end gap-2">
        <label className="min-w-0 flex-1"><span className="sr-only">消息</span><textarea value={input} onChange={event => setInput(event.target.value)} disabled={pending} maxLength={8000} rows={2} placeholder="输入消息…" className={fieldClass} /></label>
        <button type="submit" disabled={pending || !input.trim()} className={primaryButtonClass}>{pending ? '发送中…' : '发送'}</button>
      </form>
    </section>
  )
}
