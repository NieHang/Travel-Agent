'use client'

import { Menu, X } from 'lucide-react'
import Link from 'next/link'
import { useTranslations } from 'next-intl'
import type { ReactNode, Ref } from 'react'
import { IconSwap } from '@/components/ui/IconSwap'
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
  onToggleDrawer: () => void
  /** The panel tabs (desktop). */
  center?: ReactNode
  /** After the avatar: the save button (desktop). */
  right?: ReactNode
  drawerButtonRef?: Ref<HTMLButtonElement>
}) {
  const t = useTranslations('chat')
  return (
    <header className="flex min-h-16 items-center justify-between gap-4 px-4 py-3 lg:min-h-20 lg:px-8 lg:py-4">
      <div className="flex items-center gap-1">
        <PillButton ref={drawerButtonRef} variant="trip-quiet" size="sm" iconOnly aria-label={t('history')} onClick={onToggleDrawer}>
          <IconSwap swapKey={drawerOpen ? 'close' : 'menu'}>
            {drawerOpen ? <X size={20} aria-hidden /> : <Menu size={20} aria-hidden />}
          </IconSwap>
        </PillButton>
        <Link href="/" className="inline-flex min-h-11 items-center">
          <Logo variant="trip" />
        </Link>
      </div>
      {center}
      <div className="flex items-center gap-3">
        <UserMenu />
        {right}
      </div>
    </header>
  )
}
