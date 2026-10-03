import type { AuthResult, LoginRequest, RegisterRequest, User } from '@autix/contracts'
import type { QueryClient } from '@tanstack/react-query'
import { api, apiFetch } from './api-client'
import { authStore } from './auth-store'

const CHANNEL_NAME = 'hilda:auth'
type AuthMessage = { type: 'logout' }

function openChannel(): BroadcastChannel | null {
  if (typeof BroadcastChannel === 'undefined') return null
  try {
    return new BroadcastChannel(CHANNEL_NAME)
  } catch {
    return null
  }
}

async function authenticate(path: string, body: unknown): Promise<User> {
  const result = await api<AuthResult>(path, { method: 'POST', body })
  authStore.setAuthed(result)
  return result.user
}

export function login(body: LoginRequest): Promise<User> {
  return authenticate('/api/auth/login', body)
}

export function register(body: RegisterRequest): Promise<User> {
  return authenticate('/api/auth/register', body)
}

/** 调登出接口（失败忽略）→ setGuest() → 清空查询缓存 → 广播。永不抛错。 */
export async function logout(queryClient: QueryClient): Promise<void> {
  try {
    await apiFetch('/api/auth/logout', { method: 'POST' })
  } catch {
    // 登出在本地始终生效
  }
  // 自己置为 guest（代数加一），进行中的刷新不能再把用户登录回来
  authStore.setGuest()
  queryClient.clear()
  const channel = openChannel()
  if (channel) {
    const message: AuthMessage = { type: 'logout' }
    channel.postMessage(message)
    channel.close()
  }
}

/** 订阅其他标签页的登出；返回取消订阅函数。BroadcastChannel 不存在时为空操作。 */
export function listenForLogout(queryClient: QueryClient): () => void {
  const channel = openChannel()
  if (!channel) return () => {}
  channel.onmessage = (event: MessageEvent<AuthMessage>) => {
    if (event.data?.type !== 'logout') return
    authStore.setGuest()
    queryClient.clear()
  }
  return () => channel.close()
}
