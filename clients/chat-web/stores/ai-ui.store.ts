import { createStore } from 'zustand/vanilla'
import type { Component, TracePhase, TripStreamEvent, TripView, TurnTrace } from '@autix/contracts'

export type StreamOutcome = 'running' | 'completed' | 'failed' | 'cancelled'
export type TraceStep = TurnTrace['steps'][number]

type State = {
  requestId: string | null
  conversationId: string | null
  text: string
  /** The itinerary markdown while it is written; shown in the panel, never in the chat. */
  draft: string
  components: Component[]
  /** Phases this reply has reached, in the same shape the server saves as the message's trace. */
  steps: TraceStep[]
  trip: TripView | null | undefined
  revision: number | undefined
  outcome: StreamOutcome
  terminal: boolean
}
const idle: State = {
  requestId: null, conversationId: null, text: '', draft: '', components: [], steps: [],
  trip: undefined, revision: undefined, outcome: 'cancelled', terminal: true,
}

function reach(steps: TraceStep[], phase: TracePhase): TraceStep[] {
  return steps.at(-1)?.phase === phase ? steps : [...steps, { phase, at: new Date().toISOString() }]
}

export function createAIUIStore() {
  return createStore<State & {
    begin: (id: string, conversationId: string) => void
    receive: (id: string, event: TripStreamEvent) => void
    cancel: (id: string) => void
    reset: () => void
  }>((set, get) => ({
    ...idle,
    begin: (requestId, conversationId) =>
      set({ ...idle, requestId, conversationId, steps: reach([], 'understanding'), outcome: 'running', terminal: false }),
    receive: (id, event) => {
      if (get().requestId !== id || get().terminal) return
      const steps = get().steps
      switch (event.type) {
        case 'start':
          break
        case 'status':
          set(event.phase === 'searching'
            ? { steps: reach(steps, event.phase), text: '', draft: '' }
            : { steps: reach(steps, event.phase) })
          break
        // Only status events move the phase, matching the trace the server saves.
        case 'text':
          set({ text: get().text + event.delta })
          break
        case 'draft':
          set({ draft: get().draft + event.delta })
          break
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
      if (get().requestId === id && !get().terminal) set({ terminal: true, outcome: 'cancelled' })
    },
    reset: () => set(idle),
  }))
}
