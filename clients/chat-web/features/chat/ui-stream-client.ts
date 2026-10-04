import { fetchEventSource } from '@microsoft/fetch-event-source'
import {
  ChatStreamEventSchema,
  StreamMessageSchema,
  type SendMessageRequest,
  type StreamMessage,
  type ChatStreamEvent,
} from '@autix/contracts'
import { apiFetch, ApiRequestError } from '@/features/auth/api-client'

export async function streamUIChat(
  path: string,
  request: SendMessageRequest,
  signal: AbortSignal,
  onMessage: (message: StreamMessage) => void,
  onLegacy?: (message: ChatStreamEvent) => void,
): Promise<void> {
  let terminal = false
  let streamOpened = false
  let callbackFailure: unknown
  const notify = (callback: () => void) => {
    try {
      callback()
    } catch (error) {
      callbackFailure = error
      throw error
    }
  }
  const transport = new AbortController()
  const abort = () => transport.abort()
  if (signal.aborted) abort()
  else signal.addEventListener('abort', abort, { once: true })
  try {
    await fetchEventSource(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(request),
      signal: transport.signal,
      openWhenHidden: true,
      fetch: (_url, init) => apiFetch(path, init),
      onopen: async (response) => {
        if (
          !response.headers
            .get('Content-Type')
            ?.includes('text/event-stream') ||
          !response.body
        )
          throw new ApiRequestError('NETWORK', 0)
        streamOpened = true
      },
      onmessage: (event) => {
        if (signal.aborted || terminal || !event.data) return
        if (event.event && event.event !== 'message') {
          // Compatibility for previously deployed servers during rollout.
          if (!onLegacy) return
          let raw: unknown
          try {
            raw = JSON.parse(event.data)
          } catch {
            return
          }
          const parsed = ChatStreamEventSchema.safeParse({
            event: event.event,
            data: raw,
          })
          if (!parsed.success) return
          terminal =
            parsed.data.event === 'done' || parsed.data.event === 'error'
          notify(() => onLegacy(parsed.data))
          if (terminal) transport.abort()
          return
        }
        let raw: unknown
        try {
          raw = JSON.parse(event.data)
        } catch {
          throw new ApiRequestError('NETWORK', 0)
        }
        const validated = StreamMessageSchema.safeParse(raw)
        if (!validated.success) throw new ApiRequestError('NETWORK', 0)
        const parsed = validated.data
        terminal =
          parsed.messageType === 'done' || parsed.messageType === 'error'
        notify(() => onMessage(parsed))
        if (terminal) transport.abort()
      },
      onclose: () => {
        if (!terminal && !signal.aborted)
          throw new ApiRequestError('NETWORK', 0, { streamOpened: true })
      },
      onerror: (error) => {
        throw error === callbackFailure || error instanceof ApiRequestError
          ? error
          : new ApiRequestError('NETWORK', 0, { streamOpened })
      },
    })
  } finally {
    signal.removeEventListener('abort', abort)
  }
}
