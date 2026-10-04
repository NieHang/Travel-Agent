import type { AuthResult, LoginRequest, RegisterRequest, User } from '@autix/contracts'
import type { QueryClient } from '@tanstack/react-query'
import { API_BASE_URL } from '@/lib/api-base'
import { writeLocaleCookie } from '@/i18n/locale'
import { api } from './api-client'
import { authStore } from './auth-store'

const CHANNEL_NAME = 'hilda:auth'
export const LOGOUT_TIMEOUT_MS = 5000
type AuthMessage = { type: 'logout' }

// 发送与监听共用同一个实例：BroadcastChannel 实例收不到自己发出的消息
let channel: BroadcastChannel | null = null
let channelCtor: typeof BroadcastChannel | undefined

function getChannel(): BroadcastChannel | null {
  if (typeof BroadcastChannel === 'undefined') return null
  if (!channel || channelCtor !== BroadcastChannel) {
    try {
      channel = new BroadcastChannel(CHANNEL_NAME)
      channelCtor = BroadcastChannel
    } catch {
      channel = null
    }
  }
  return channel
}

/** 仅测试使用：丢弃共用的广播频道实例。 */
export function resetChannelForTests(): void {
  channel?.close()
  channel = null
  channelCtor = undefined
}

async function authenticate(path: string, body: unknown): Promise<User> {
  const result = await api<AuthResult>(path, { method: 'POST', body })
  // 在发布登录态（会触发路由跳转）前写入，目标页面的服务端渲染才能读取账号语言。
  writeLocaleCookie(result.user.locale)
  authStore.setAuthed(result)
  return result.user
}

export function login(body: LoginRequest): Promise<User> {
  return authenticate('/api/auth/login', body)
}

export function register(body: RegisterRequest): Promise<User> {
  return authenticate('/api/auth/register', body)
}

/** 调登出接口（失败或超时忽略）→ setGuest() → 清空查询缓存 → 广播。永不抛错。 */
export async function logout(queryClient: QueryClient): Promise<void> {
  // 该接口只读 refresh Cookie：不带 Authorization，也不走刷新逻辑
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), LOGOUT_TIMEOUT_MS)
  try {
    await fetch(`${API_BASE_URL}/api/auth/logout`, {
      method: 'POST',
      credentials: 'include',
      signal: controller.signal,
    })
  } catch {
    // 登出在本地始终生效
  } finally {
    clearTimeout(timer)
  }
  // 自己置为 guest（代数加一），进行中的刷新不能再把用户登录回来
  authStore.setGuest()
  queryClient.clear()
  const message: AuthMessage = { type: 'logout' }
  try {
    getChannel()?.postMessage(message)
  } catch {
    // 广播失败不影响本标签页
  }
}

/** 订阅其他标签页的登出；返回取消订阅函数。BroadcastChannel 不存在时为空操作。 */
export function listenForLogout(queryClient: QueryClient): () => void {
  const ch = getChannel()
  if (!ch) return () => {}
  const onMessage = (event: MessageEvent<AuthMessage>) => {
    if (event.data?.type !== 'logout') return
    authStore.setGuest()
    queryClient.clear()
  }
  ch.addEventListener('message', onMessage)
  return () => ch.removeEventListener('message', onMessage)
}
