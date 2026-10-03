'use client'

import { usePathname, useRouter } from 'next/navigation'
import { useEffect, type ReactNode } from 'react'
import { BrandLoader } from '@/components/ui/BrandLoader'
import { useAuth } from './auth-store'

export function AuthGate({ children }: { children: ReactNode }) {
  const auth = useAuth()
  const router = useRouter()
  const pathname = usePathname()
  const isGuest = auth.status === 'guest'

  useEffect(() => {
    if (isGuest) router.replace('/login?next=' + encodeURIComponent(pathname))
  }, [isGuest, pathname, router])

  if (auth.status !== 'authed') return <BrandLoader />
  return children
}
