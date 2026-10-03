'use client'

import { Popover } from '@heroui/react'
import { useQueryClient } from '@tanstack/react-query'
import { useTranslations } from 'next-intl'
import { useState } from 'react'
import { Avatar } from '@/components/ui/Avatar'
import { LocaleSwitch } from '@/components/ui/LocaleSwitch'
import { PillButton } from '@/components/ui/PillButton'
import { markSignOutIntent } from '@/features/auth/AuthGate'
import { useAuth } from '@/features/auth/auth-store'
import { logout } from '@/features/auth/session'

export function UserMenu() {
  const t = useTranslations('chat')
  const auth = useAuth()
  const queryClient = useQueryClient()
  const [signingOut, setSigningOut] = useState(false)
  const user = auth.status === 'authed' ? auth.user : null

  const signOut = async () => {
    if (signingOut) return
    setSigningOut(true)
    // 跳转由 AuthGate 统一负责：guest 后回落地页
    markSignOutIntent()
    await logout(queryClient)
  }

  return (
    <Popover>
      <Popover.Trigger
        aria-label={t('accountMenu')}
        className="inline-flex size-11 cursor-pointer items-center justify-center rounded-full"
      >
        <Avatar name={user?.nickname ?? ''} size={40} />
      </Popover.Trigger>
      <Popover.Content
        placement="bottom end"
        className="rounded-card bg-paper text-ink shadow-float"
      >
        <Popover.Dialog aria-label={t('accountMenu')} className="flex w-64 flex-col gap-4 p-4">
          <div className="min-w-0">
            <p className="truncate text-base font-bold">{user?.nickname}</p>
            <p className="truncate text-sm">{user?.email}</p>
          </div>
          <LocaleSwitch />
          <PillButton variant="ghost" size="sm" loading={signingOut} onClick={signOut}>
            {t('signOut')}
          </PillButton>
        </Popover.Dialog>
      </Popover.Content>
    </Popover>
  )
}
