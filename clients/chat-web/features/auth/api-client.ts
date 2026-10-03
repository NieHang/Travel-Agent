import { ErrorCodeSchema, type ErrorCode } from '@autix/contracts'
import { API_BASE_URL } from '@/lib/api-base'
import { authStore } from './auth-store'
import { refreshSession } from './refresh'

const DEFAULT_RETRY_AFTER_SECONDS = 60

export class ApiRequestError extends Error {
  constructor(
    readonly code: ErrorCode | 'NETWORK' | 'ABORTED',
    readonly status: number,
    readonly details?: unknown,
    readonly retryAfter?: number,
  ) {
    super(code)
    this.name = 'ApiRequestError'
  }
}

function parseRetryAfter(header: string | null): number {
  if (header && /^\d+$/.test(header.trim())) {
    const seconds = Number(header)
    if (seconds > 0) return seconds
  }
  return DEFAULT_RETRY_AFTER_SECONDS
}

/** 把非 2xx 响应转成 ApiRequestError。 */
export async function toApiError(res: Response): Promise<ApiRequestError> {
  let code: ErrorCode = 'INTERNAL_ERROR'
  let details: unknown
  try {
    const body: unknown = await res.json()
    if (body && typeof body === 'object') {
      const parsed = ErrorCodeSchema.safeParse((body as { code?: unknown }).code)
      if (parsed.success) {
        code = parsed.data
        details = (body as { details?: unknown }).details
      }
    }
  } catch {
    // 响应体不是 JSON：保持 INTERNAL_ERROR
  }
  const retryAfter =
    code === 'RATE_LIMITED'
      ? parseRetryAfter(res.headers.get('Retry-After'))
      : undefined
  return new ApiRequestError(code, res.status, details, retryAfter)
}

async function send(
  path: string,
  init: RequestInit | undefined,
  token: string | null,
): Promise<Response> {
  const headers = new Headers(init?.headers)
  if (token) headers.set('Authorization', `Bearer ${token}`)
  let res: Response
  try {
    res = await fetch(API_BASE_URL + path, {
      ...init,
      headers,
      credentials: 'include',
    })
  } catch (error) {
    // 跨 realm（jsdom 与 Node）时 instanceof DOMException 不可靠，只看 name
    const aborted = (error as { name?: unknown } | null)?.name === 'AbortError'
    throw new ApiRequestError(aborted ? 'ABORTED' : 'NETWORK', 0)
  }
  if (!res.ok) throw await toApiError(res)
  return res
}

function currentToken(): string | null {
  const state = authStore.getState()
  return state.status === 'authed' ? state.accessToken : null
}

/** 成功返回原始 Response（供 SSE 读流）；非 2xx 抛 ApiRequestError。 */
export async function apiFetch(
  path: string,
  init?: RequestInit,
): Promise<Response> {
  const usedToken = currentToken()
  try {
    return await send(path, init, usedToken)
  } catch (error) {
    if (!(error instanceof ApiRequestError) || error.code !== 'TOKEN_EXPIRED') {
      throw error
    }
    // 并发请求中别人已经换过 token：直接用新 token 重试，不再刷新
    const latest = currentToken()
    if (latest !== null && latest !== usedToken) {
      return send(path, init, latest)
    }
    if (!(await refreshSession())) throw error
    return send(path, init, currentToken())
  }
}

/** JSON 便捷封装；204 返回 undefined。body 传对象时自动序列化并加 Content-Type。 */
export async function api<T>(
  path: string,
  init?: Omit<RequestInit, 'body'> & { body?: unknown },
): Promise<T> {
  const { body, ...rest } = init ?? {}
  const headers = new Headers(rest.headers)
  let payload: BodyInit | undefined
  if (body !== undefined) {
    headers.set('Content-Type', 'application/json')
    payload = JSON.stringify(body)
  }
  const res = await apiFetch(path, { ...rest, headers, body: payload })
  if (res.status === 204) return undefined as T
  return (await res.json()) as T
}
