'use client'

import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { Suspense, useEffect, type ReactNode } from 'react'
import { BrandLoader } from '@/components/ui/BrandLoader'
import { LocaleSwitch } from '@/components/ui/LocaleSwitch'
import { Logo } from '@/components/ui/Logo'
import { useAuth } from '@/features/auth/auth-store'
import { safeNext } from '@/features/auth/safe-next'

function AuthShell({ children }: { children: ReactNode }) {
  const auth = useAuth()
  const router = useRouter()
  const next = useSearchParams().get('next')
  const authed = auth.status === 'authed'

  useEffect(() => {
    if (authed) router.replace(safeNext(next))
  }, [authed, next, router])

  if (auth.status !== 'guest') return <BrandLoader />
  return (
    <div className="flex min-h-dvh flex-col bg-stage-yellow">
      <header className="flex items-center justify-between px-4 py-4 sm:px-8">
        <Link href="/" className="inline-flex min-h-11 items-center">
          <Logo />
        </Link>
        <LocaleSwitch />
      </header>
      <main className="flex flex-1 items-center justify-center px-4 pb-12">
        {children}
      </main>
    </div>
  )
}

export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <Suspense fallback={<BrandLoader />}>
      <AuthShell>{children}</AuthShell>
    </Suspense>
  )
}
