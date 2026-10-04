import { createStore } from 'zustand/vanilla'
import type {
  StreamMessage,
  UIResponse,
  ProgressPayload,
  TripSnapshot,
  ComponentInteractionState,
} from '@autix/contracts'
export type StreamOutcome = 'running' | 'completed' | 'failed' | 'cancelled'
export function createAIUIStore() {
  return createStore<{
    requestId: string | null
    conversationId: string | null
    text: string
    components: UIResponse[]
    interactionState?: ComponentInteractionState
    progress: ProgressPayload | null
    trip: TripSnapshot | null | undefined
    outcome: StreamOutcome
    terminal: boolean
    begin(id: string, conversationId: string): void
    receive(id: string, message: StreamMessage): void
    cancel(id: string): void
    reset(): void
  }>((set, get) => ({
    requestId: null,
    conversationId: null,
    text: '',
    components: [],
    progress: null,
    trip: undefined,
    outcome: 'cancelled',
    terminal: true,
    begin: (requestId, conversationId) =>
      set({
        requestId,
        conversationId,
        text: '',
        components: [],
        interactionState: undefined,
        progress: null,
        trip: undefined,
        outcome: 'running',
        terminal: false,
      }),
    receive: (id, message) => {
      if (get().requestId !== id || get().terminal) return
      switch (message.messageType) {
        case 'markdown':
          set({
            text: message.payload.isChunk
              ? get().text + message.payload.content
              : message.payload.content,
          })
          break
        case 'ui':
          set({
            components: message.payload.components,
            interactionState: message.payload.interactionState,
          })
          break
        case 'progress':
          set({ progress: message.payload })
          break
        case 'meta':
          if ('trip' in message.payload) set({ trip: message.payload.trip })
          break
        case 'done':
          set({
            terminal: true,
            outcome: 'completed',
            trip: message.payload.trip,
          })
          break
        case 'error':
          set({ terminal: true, outcome: 'failed' })
          break
      }
    },
    cancel: (id) => {
      if (get().requestId === id && !get().terminal)
        set({ terminal: true, outcome: 'cancelled', progress: null })
    },
    reset: () =>
      set({
        requestId: null,
        conversationId: null,
        text: '',
        components: [],
        interactionState: undefined,
        progress: null,
        trip: undefined,
        terminal: true,
        outcome: 'cancelled',
      }),
  }))
}
