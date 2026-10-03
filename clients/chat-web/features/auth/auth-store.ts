import { useSyncExternalStore } from 'react'
import type { AuthResult, User } from '@autix/contracts'

export type AuthState =
  | { status: 'loading' }
  | { status: 'authed'; accessToken: string; user: User }
  | { status: 'guest'; reason: 'reused' | null }

const LOADING: AuthState = { status: 'loading' }

let state: AuthState = LOADING
const listeners = new Set<() => void>()

function set(next: AuthState) {
  state = next
  for (const listener of [...listeners]) listener()
}

export const authStore = {
  getState: (): AuthState => state,
  subscribe(listener: () => void): () => void {
    listeners.add(listener)
    return () => {
      listeners.delete(listener)
    }
  },
  setAuthed(result: AuthResult): void {
    set({ status: 'authed', accessToken: result.accessToken, user: result.user })
  },
  setUser(user: User): void {
    if (state.status !== 'authed') return
    set({ ...state, user })
  },
  setGuest(reason: 'reused' | null = null): void {
    set({ status: 'guest', reason })
  },
  reset(): void {
    set(LOADING)
  },
}

export function useAuth(): AuthState {
  return useSyncExternalStore(
    authStore.subscribe,
    authStore.getState,
    () => LOADING,
  )
}
