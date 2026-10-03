'use client'

import { useLocale } from 'next-intl'
import { useRouter } from 'next/navigation'
import { useCallback } from 'react'
import type { Locale, User } from '@autix/contracts'
import { writeLocaleCookie } from '@/i18n/locale'
import { api } from './api-client'
import { authStore } from './auth-store'

export function useSetLocale(): (locale: Locale) => void {
  const current = useLocale()
  const router = useRouter()
  return useCallback(
    (locale: Locale) => {
      if (locale === current) return
      writeLocaleCookie(locale)
      router.refresh()
      if (authStore.getState().status !== 'authed') return
      api<User>('/api/users/me', { method: 'PATCH', body: { locale } })
        .then((user) => authStore.setUser(user))
        .catch(() => {
          // 失败不回滚界面语言，也不提示
        })
    },
    [current, router],
  )
}
