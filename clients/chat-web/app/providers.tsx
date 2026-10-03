'use client'

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useLocale } from 'next-intl'
import { useRouter } from 'next/navigation'
import { useEffect, type ReactNode } from 'react'
import { useAuth } from '@/features/auth/auth-store'
import { bootstrapAuth } from '@/features/auth/refresh'
import { listenForLogout } from '@/features/auth/session'
import { writeLocaleCookie } from '@/i18n/locale'

let browserQueryClient: QueryClient | undefined

function getQueryClient() {
  // 服务端每次渲染一个新的；浏览器端复用同一个
  if (typeof window === 'undefined') return new QueryClient()
  browserQueryClient ??= new QueryClient()
  return browserQueryClient
}

function AuthEffects() {
  const auth = useAuth()
  const locale = useLocale()
  const router = useRouter()
  const userLocale = auth.status === 'authed' ? auth.user.locale : null

  useEffect(() => {
    void bootstrapAuth()
  }, [])

  // 登录后以 User.locale 为准并写回 Cookie
  useEffect(() => {
    if (userLocale && userLocale !== locale) {
      writeLocaleCookie(userLocale)
      router.refresh()
    }
  }, [userLocale, locale, router])

  return null
}

function LogoutListener({ queryClient }: { queryClient: QueryClient }) {
  useEffect(() => listenForLogout(queryClient), [queryClient])
  return null
}

export function Providers({ children }: { children: ReactNode }) {
  const queryClient = getQueryClient()
  return (
    <QueryClientProvider client={queryClient}>
      <AuthEffects />
      <LogoutListener queryClient={queryClient} />
      {children}
    </QueryClientProvider>
  )
}
