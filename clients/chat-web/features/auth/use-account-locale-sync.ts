'use client'

import { useLocale } from 'next-intl'
import { useRouter } from 'next/navigation'
import { useEffect, useRef } from 'react'
import { writeLocaleCookie } from '@/i18n/locale'
import { useAuth } from './auth-store'

/**
 * 账号语言只在登录用户切换时应用（登录、注册、启动刷新），
 * 已登录期间界面语言变化（手动切换）不会被它改回去。
 */
export function useAccountLocaleSync(): void {
  const auth = useAuth()
  const locale = useLocale()
  const router = useRouter()
  const userId = auth.status === 'authed' ? auth.user.id : null
  const userLocale = auth.status === 'authed' ? auth.user.locale : null
  const lastUserId = useRef<string | null>(null)

  useEffect(() => {
    if (userId === lastUserId.current) return
    lastUserId.current = userId
    if (userId && userLocale && userLocale !== locale) {
      writeLocaleCookie(userLocale)
      router.refresh()
    }
  }, [userId, userLocale, locale, router])
}
