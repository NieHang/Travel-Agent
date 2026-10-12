import { fetchEventSource } from '@microsoft/fetch-event-source'
import {
  TripStreamEventSchema,
  type SendTurnRequest,
  type TripStreamEvent,
} from '@autix/contracts'
import { apiFetch, ApiRequestError } from '@/features/auth/api-client'

export async function streamTurn(
  path: string,
  request: SendTurnRequest,
  signal: AbortSignal,
  onEvent: (event: TripStreamEvent) => void,
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
        if (event.event && event.event !== 'message') return
        let raw: unknown
        try {
          raw = JSON.parse(event.data)
        } catch {
          throw new ApiRequestError('NETWORK', 0)
        }
        const validated = TripStreamEventSchema.safeParse(raw)
        if (!validated.success) throw new ApiRequestError('NETWORK', 0)
        const parsed = validated.data
        terminal = parsed.type === 'done' || parsed.type === 'error'
        notify(() => onEvent(parsed))
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
