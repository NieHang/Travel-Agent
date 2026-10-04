import type { QueryClient } from '@tanstack/react-query'
import { authStore } from './auth-store'

export function accountId(): string | null {
  const state = authStore.getState()
  return state.status === 'authed' ? state.user.id : null
}

/** 同步订阅：会话失效或账号切换时，在下一次页面渲染前移除私人缓存。 */
export function bindAccountCache(client: QueryClient): () => void {
  let previous = accountId()
  return authStore.subscribe(() => {
    const next = accountId()
    if (next !== previous) client.clear()
    previous = next
  })
}
