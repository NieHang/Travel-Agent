'use client'

import { Menu, X } from 'lucide-react'
import Link from 'next/link'
import { useTranslations } from 'next-intl'
import type { ReactNode, Ref } from 'react'
import { Logo } from '@/components/ui/Logo'
import { PillButton } from '@/components/ui/PillButton'
import { UserMenu } from './UserMenu'

export function TopBar({
  drawerOpen,
  onToggleDrawer,
  center,
  right,
  drawerButtonRef,
}: {
  drawerOpen: boolean
  onToggleDrawer(): void
  /** 顶部中间（P1） */
  center?: ReactNode
  /** T3 之后（P2） */
  right?: ReactNode
  drawerButtonRef?: Ref<HTMLButtonElement>
}) {
  const t = useTranslations('chat')
  return (
    <header className="flex items-center gap-3 px-4 py-3 sm:px-6">
      <PillButton ref={drawerButtonRef} variant="ink" iconOnly aria-label={t('history')} onClick={onToggleDrawer}>
        {drawerOpen ? <X size={20} aria-hidden /> : <Menu size={20} aria-hidden />}
      </PillButton>
      <Link href="/" className="inline-flex min-h-11 items-center">
        <Logo />
      </Link>
      <div className="flex flex-1 justify-center">{center}</div>
      <UserMenu />
      {right}
    </header>
  )
}
