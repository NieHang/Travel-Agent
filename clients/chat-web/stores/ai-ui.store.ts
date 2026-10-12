import { createStore } from 'zustand/vanilla'
import type { Component, StatusPhase, TripStreamEvent, TripView } from '@autix/contracts'

export type StreamOutcome = 'running' | 'completed' | 'failed' | 'cancelled'
export type ProgressPhase = 'waiting' | StatusPhase

type State = {
  requestId: string | null
  conversationId: string | null
  text: string
  components: Component[]
  phase: ProgressPhase | null
  trip: TripView | null | undefined
  revision: number | undefined
  outcome: StreamOutcome
  terminal: boolean
}
const idle: State = {
  requestId: null, conversationId: null, text: '', components: [], phase: null,
  trip: undefined, revision: undefined, outcome: 'cancelled', terminal: true,
}

export function createAIUIStore() {
  return createStore<State & {
    begin(id: string, conversationId: string): void
    receive(id: string, event: TripStreamEvent): void
    cancel(id: string): void
    reset(): void
  }>((set, get) => ({
    ...idle,
    begin: (requestId, conversationId) =>
      set({ ...idle, requestId, conversationId, phase: 'waiting', outcome: 'running', terminal: false }),
    receive: (id, event) => {
      if (get().requestId !== id || get().terminal) return
      switch (event.type) {
        case 'start':
          break
        case 'status':
          set({ phase: event.phase })
          break
        case 'text':
          set({ text: get().text + event.delta, phase: 'writing' })
          break
        // done/error keep the last phase so the ring can show 100% or the failure; cancel clears it.
        case 'done':
          set({
            terminal: true,
            outcome: 'completed',
            components: event.components,
            trip: event.trip,
            revision: event.message.metadata?.revision,
          })
          break
        case 'error':
          set({ terminal: true, outcome: 'failed' })
          break
      }
    },
    cancel: (id) => {
      if (get().requestId === id && !get().terminal) set({ terminal: true, outcome: 'cancelled', phase: null })
    },
    reset: () => set(idle),
  }))
}
