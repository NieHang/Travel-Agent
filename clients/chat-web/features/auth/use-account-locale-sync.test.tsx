import { act, renderHook } from '@testing-library/react'
import { NextIntlClientProvider } from 'next-intl'
import type { ReactNode } from 'react'
import { makeUser } from '@/test/fixtures'
import en from '@/messages/en.json'
import zh from '@/messages/zh.json'
import { authStore } from './auth-store'
import { useAccountLocaleSync } from './use-account-locale-sync'

const refresh = vi.fn()
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh }),
  usePathname: () => '/',
  useSearchParams: () => new URLSearchParams(),
}))

let uiLocale: 'zh' | 'en' = 'zh'

function Wrapper({ children }: { children: ReactNode }) {
  return (
    <NextIntlClientProvider locale={uiLocale} messages={uiLocale === 'zh' ? zh : en} timeZone="UTC">
      {children}
    </NextIntlClientProvider>
  )
}

function setup(initial: 'zh' | 'en' = 'zh') {
  uiLocale = initial
  const view = renderHook(() => useAccountLocaleSync(), { wrapper: Wrapper })
  return {
    changeLocale(next: 'zh' | 'en') {
      uiLocale = next
      view.rerender()
    },
  }
}

beforeEach(() => {
  authStore.reset()
  refresh.mockClear()
  document.cookie = 'hilda_locale=; path=/; max-age=0'
})

it('loading -> authed 且账号语言与界面不同：写 Cookie 并 refresh 一次', () => {
  setup('zh')
  act(() => authStore.setAuthed({ accessToken: 't', user: makeUser({ locale: 'en' }) }))
  expect(document.cookie).toContain('hilda_locale=en')
  expect(refresh).toHaveBeenCalledTimes(1)
})

it('已登录后界面语言变化（手动切换）：不写 Cookie、不 refresh', () => {
  authStore.setAuthed({ accessToken: 't', user: makeUser({ locale: 'zh' }) })
  const { changeLocale } = setup('zh')
  changeLocale('en')
  expect(document.cookie).not.toContain('hilda_locale')
  expect(refresh).not.toHaveBeenCalled()
})

it('账号语言与界面一致：什么都不做', () => {
  setup('zh')
  act(() => authStore.setAuthed({ accessToken: 't', user: makeUser({ locale: 'zh' }) }))
  expect(document.cookie).not.toContain('hilda_locale')
  expect(refresh).not.toHaveBeenCalled()
})

it('登出后换另一个语言不同的用户登录：再次应用', () => {
  setup('zh')
  act(() => authStore.setAuthed({ accessToken: 't', user: makeUser({ id: 'u1', locale: 'zh' }) }))
  expect(refresh).not.toHaveBeenCalled()
  act(() => authStore.setGuest())
  act(() => authStore.setAuthed({ accessToken: 't', user: makeUser({ id: 'u2', locale: 'en' }) }))
  expect(document.cookie).toContain('hilda_locale=en')
  expect(refresh).toHaveBeenCalledTimes(1)
})
