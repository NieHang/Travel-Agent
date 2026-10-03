'use client'

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useEffect, type ReactNode } from 'react'
import { useAccountLocaleSync } from '@/features/auth/use-account-locale-sync'
import { bootstrapAuth } from '@/features/auth/refresh'
import { listenForLogout } from '@/features/auth/session'

let browserQueryClient: QueryClient | undefined

function getQueryClient() {
  // 服务端每次渲染一个新的；浏览器端复用同一个
  if (typeof window === 'undefined') return new QueryClient()
  browserQueryClient ??= new QueryClient()
  return browserQueryClient
}

function AuthEffects() {
  useAccountLocaleSync()
  useEffect(() => {
    void bootstrapAuth()
  }, [])
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
