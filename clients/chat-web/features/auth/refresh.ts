import { AuthResultSchema } from '@autix/contracts'
import { API_BASE_URL } from '@/lib/api-base'
import { ApiRequestError, toApiError } from './api-client'
import { authStore } from './auth-store'

export const REFRESH_RETRY_DELAY_MS = 300

let inflight: Promise<boolean> | null = null
let bootstrap: Promise<void> | null = null

async function requestRefresh(): Promise<void> {
  let res: Response
  try {
    res = await fetch(`${API_BASE_URL}/api/auth/refresh`, {
      method: 'POST',
      credentials: 'include',
    })
  } catch {
    throw new ApiRequestError('NETWORK', 0)
  }
  if (!res.ok) throw await toApiError(res)
  let result
  try {
    result = AuthResultSchema.parse(await res.json())
  } catch {
    throw new ApiRequestError('INTERNAL_ERROR', res.status)
  }
  authStore.setAuthed(result)
}

async function runRefresh(): Promise<boolean> {
  try {
    try {
      await requestRefresh()
    } catch (error) {
      if (!(error instanceof ApiRequestError) || error.code !== 'REFRESH_INVALID') {
        throw error
      }
      // 多标签页并发刷新时，另一个请求可能已写入新 Cookie：等一会再试一次
      await new Promise((resolve) => setTimeout(resolve, REFRESH_RETRY_DELAY_MS))
      await requestRefresh()
    }
    return true
  } catch (error) {
    const reused = error instanceof ApiRequestError && error.code === 'REFRESH_REUSED'
    authStore.setGuest(reused ? 'reused' : null)
    return false
  }
}

/** 单飞。成功置为 authed 并返回 true；失败置为 guest 并返回 false；不抛错。 */
export function refreshSession(): Promise<boolean> {
  inflight ??= runRefresh().finally(() => {
    inflight = null
  })
  return inflight
}

/** 幂等，整个页面生命周期只真正刷新一次。 */
export function bootstrapAuth(): Promise<void> {
  bootstrap ??= refreshSession().then(() => undefined)
  return bootstrap
}

/** 仅测试使用：清掉模块级的单飞与启动状态。 */
export function resetRefreshForTests(): void {
  inflight = null
  bootstrap = null
}
