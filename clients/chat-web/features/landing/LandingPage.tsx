'use client'
import Link from 'next/link'
import { motion, useReducedMotion } from 'motion/react'
import { useLocale, useTranslations } from 'next-intl'
import { Logo } from '@/components/ui/Logo'
import { LocaleSwitch } from '@/components/ui/LocaleSwitch'
import { Skeleton } from '@/components/ui/Skeleton'
import { useAuth } from '@/features/auth/auth-store'
import { getTripMock } from '@/features/panels/mock'
import { enter } from '@/lib/motion'
import { PromptForm } from './PromptForm'
import { FloatingCards } from './floating-cards'

export function LandingPage() {
  const t = useTranslations('landing'), auth = useAuth(), locale = useLocale(), reduced = useReducedMotion()
  return <div className="relative flex min-h-dvh flex-col overflow-hidden bg-stage-yellow text-ink">
    <header className="relative z-10 flex items-center justify-between gap-3 p-4 sm:px-8 sm:py-6">
      <Link href="/" className="inline-flex min-h-11 items-center"><Logo /></Link>
      <div className="flex items-center gap-3"><LocaleSwitch />
        {auth.status === 'loading' ? <div data-testid="auth-entry-skeleton"><Skeleton className="h-11 w-24" /></div> :
          <Link href={auth.status === 'authed' ? '/chat' : '/login'} className="inline-flex min-h-11 items-center rounded-full bg-ink px-5 font-bold text-white">
            {auth.status === 'authed' ? t('openChat') : t('signIn')}
          </Link>}
      </div>
    </header>
    <main className="relative z-10 m-auto flex w-full max-w-3xl flex-col items-center gap-6 px-4 py-16 text-center lg:max-w-[56%]">
      <motion.p {...enter(0, Boolean(reduced))} className="rounded-full border-2 border-ink px-4 py-2 text-sm font-bold">{t('badge')}</motion.p>
      <motion.h1 {...enter(1, Boolean(reduced))} className="text-[clamp(56px,9vw,128px)] leading-[0.95] font-extrabold">{t('title')}</motion.h1>
      <motion.p {...enter(2, Boolean(reduced))} className="max-w-xl text-base sm:text-lg">{t('subtitle')}</motion.p>
      <motion.div {...enter(3, Boolean(reduced))} className="w-full"><PromptForm /></motion.div>
    </main>
    <FloatingCards data={getTripMock(locale === 'en' ? 'en' : 'zh')} />
  </div>
}
