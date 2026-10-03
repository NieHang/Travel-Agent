import { useSyncExternalStore } from 'react'
import type { AuthResult, User } from '@autix/contracts'

export type AuthState =
  | { status: 'loading' }
  | { status: 'authed'; accessToken: string; user: User }
  | { status: 'guest'; reason: 'reused' | null }

const LOADING: AuthState = { status: 'loading' }

let state: AuthState = LOADING
// 每次外部发起的状态切换（setAuthed / setGuest / reset）加一，供刷新判断自己的结果是否已过期
let generation = 0
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
    generation += 1
    set({ status: 'authed', accessToken: result.accessToken, user: result.user })
  },
  setUser(user: User): void {
    if (state.status !== 'authed') return
    set({ ...state, user })
  },
  setGuest(reason: 'reused' | null = null): void {
    generation += 1
    set({ status: 'guest', reason })
  },
  reset(): void {
    generation += 1
    set(LOADING)
  },
  /** 当前代数；刷新开始时记下，写入时用 *IfCurrent 校验。 */
  getGeneration: (): number => generation,
  /** 仅当代数未变时写入 authed，返回是否写入。 */
  setAuthedIfCurrent(expected: number, result: AuthResult): boolean {
    if (generation !== expected) return false
    authStore.setAuthed(result)
    return true
  },
  /** 仅当代数未变时写入 guest，返回是否写入。 */
  setGuestIfCurrent(expected: number, reason: 'reused' | null): boolean {
    if (generation !== expected) return false
    authStore.setGuest(reason)
    return true
  },
}

export function useAuth(): AuthState {
  return useSyncExternalStore(
    authStore.subscribe,
    authStore.getState,
    () => LOADING,
  )
}
