'use client'

import { usePathname, useRouter } from 'next/navigation'
import { useEffect, type ReactNode } from 'react'
import { BrandLoader } from '@/components/ui/BrandLoader'
import { useAuth } from './auth-store'

// 本标签页主动退出时，登录态变为 guest 后回落地页而不是登录页；别的标签页触发的退出没有该标记
let signOutIntent = false

export function markSignOutIntent(): void {
  signOutIntent = true
}

/** 仅测试使用。 */
export function resetSignOutIntentForTests(): void {
  signOutIntent = false
}

export function AuthGate({ children }: { children: ReactNode }) {
  const auth = useAuth()
  const router = useRouter()
  const pathname = usePathname()
  const isGuest = auth.status === 'guest'

  useEffect(() => {
    if (auth.status === 'authed') signOutIntent = false
    if (!isGuest) return
    // 意图在回到 authed 时才清除：StrictMode 重跑 effect 也不会改道
    router.replace(signOutIntent ? '/' : '/login?next=' + encodeURIComponent(pathname))
  }, [auth.status, isGuest, pathname, router])

  if (auth.status !== 'authed') return <BrandLoader />
  return children
}
