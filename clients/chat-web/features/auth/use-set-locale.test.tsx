import { renderHook, waitFor } from '@testing-library/react'
import { NextIntlClientProvider } from 'next-intl'
import type { ReactNode } from 'react'
import { http, HttpResponse } from 'msw'
import { server, apiUrl } from '@/test/server'
import { makeUser } from '@/test/fixtures'
import zh from '@/messages/zh.json'
import { authStore } from './auth-store'
import { useSetLocale } from './use-set-locale'

const refresh = vi.fn()
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh }),
  usePathname: () => '/',
  useSearchParams: () => new URLSearchParams(),
}))

const wrapper = ({ children }: { children: ReactNode }) => (
  <NextIntlClientProvider locale="zh" messages={zh} timeZone="UTC">
    {children}
  </NextIntlClientProvider>
)

let patchBodies: unknown[]
let patchStatus = 200

beforeEach(() => {
  authStore.reset()
  refresh.mockClear()
  patchBodies = []
  patchStatus = 200
  document.cookie = 'hilda_locale=; path=/; max-age=0'
  server.use(
    http.patch(apiUrl('/api/users/me'), async ({ request }) => {
      patchBodies.push(await request.json())
      if (patchStatus !== 200) return new HttpResponse(null, { status: patchStatus })
      return HttpResponse.json(makeUser({ locale: 'en' }))
    }),
  )
})

it('未登录：写 Cookie 并 refresh，不发请求', async () => {
  authStore.setGuest()
  const { result } = renderHook(() => useSetLocale(), { wrapper })
  result.current('en')
  expect(document.cookie).toContain('hilda_locale=en')
  expect(refresh).toHaveBeenCalledTimes(1)
  await new Promise((r) => setTimeout(r, 20))
  expect(patchBodies).toEqual([])
})

it('已登录：另发 PATCH { locale: "en" }，成功后 store 里的 user.locale 更新', async () => {
  authStore.setAuthed({ accessToken: 't', user: makeUser({ locale: 'zh' }) })
  const { result } = renderHook(() => useSetLocale(), { wrapper })
  result.current('en')
  expect(document.cookie).toContain('hilda_locale=en')
  expect(refresh).toHaveBeenCalledTimes(1)
  await waitFor(() => {
    const state = authStore.getState()
    expect(state.status === 'authed' && state.user.locale).toBe('en')
  })
  expect(patchBodies).toEqual([{ locale: 'en' }])
})

it('PATCH 失败：Cookie 仍已写入，没有提示，不抛错', async () => {
  patchStatus = 500
  authStore.setAuthed({ accessToken: 't', user: makeUser({ locale: 'zh' }) })
  const { result } = renderHook(() => useSetLocale(), { wrapper })
  expect(() => result.current('en')).not.toThrow()
  await waitFor(() => expect(patchBodies).toHaveLength(1))
  await new Promise((r) => setTimeout(r, 20))
  expect(document.cookie).toContain('hilda_locale=en')
  const state = authStore.getState()
  expect(state.status === 'authed' && state.user.locale).toBe('zh')
})

it('选中当前语言：不写 Cookie、不 refresh、不发请求', async () => {
  authStore.setAuthed({ accessToken: 't', user: makeUser() })
  const { result } = renderHook(() => useSetLocale(), { wrapper })
  result.current('zh')
  expect(document.cookie).not.toContain('hilda_locale')
  expect(refresh).not.toHaveBeenCalled()
  await new Promise((r) => setTimeout(r, 20))
  expect(patchBodies).toEqual([])
})

it('账号切换后迟到的语言响应不能覆盖新账号资料', async () => {
  let release!: () => void
  const gate = new Promise<void>(resolve => { release = resolve })
  server.use(http.patch(apiUrl('/api/users/me'), async () => {
    await gate
    return HttpResponse.json(makeUser({ id: 'A', locale: 'en' }))
  }))
  authStore.setAuthed({ accessToken: 'A', user: makeUser({ id: 'A' }) })
  const { result } = renderHook(() => useSetLocale(), { wrapper })
  result.current('en')
  authStore.setAuthed({ accessToken: 'B', user: makeUser({ id: 'B' }) })
  release()
  await new Promise(resolve => setTimeout(resolve, 50))
  expect(authStore.getState()).toMatchObject({ accessToken: 'B', user: { id: 'B' } })
})
