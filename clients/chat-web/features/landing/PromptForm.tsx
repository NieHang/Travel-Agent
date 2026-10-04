'use client'
import { useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { PillButton } from '@/components/ui/PillButton'
import { Chip } from '@/components/ui/Chip'
import { toast } from '@/components/ui/toast'
import { authStore } from '@/features/auth/auth-store'
import { savePendingPrompt } from '@/features/auth/pending-prompt'
import { createConversation } from '@/features/conversations/api'

export function PromptForm() {
  const t = useTranslations('landing'), tc = useTranslations('chat'), router = useRouter()
  const [value, setValue] = useState(''), [busy, setBusy] = useState(false)
  const input = useRef<HTMLInputElement>(null), inFlight = useRef(false)
  const submit = async () => {
    const prompt = value.trim()
    if (!prompt || inFlight.current) return
    if (authStore.getState().status !== 'authed') {
      savePendingPrompt({ prompt }); router.push('/login?next=/chat'); return
    }
    inFlight.current = true; setBusy(true)
    try {
      const conversation = await createConversation()
      savePendingPrompt({ prompt, conversationId: conversation.id })
      router.push('/chat/' + encodeURIComponent(conversation.id))
    } catch {
      toast(tc('sendFailed'), { tone: 'danger' })
    } finally { inFlight.current = false; setBusy(false) }
  }
  return <div className="flex w-full flex-col gap-5">
    <form onSubmit={(event) => { event.preventDefault(); void submit() }} className="flex flex-col gap-3 sm:flex-row">
      <input ref={input} value={value} onChange={(event) => setValue(event.target.value)} maxLength={4000}
        aria-label={t('placeholder')} placeholder={t('placeholder')}
        onKeyDown={(event) => {
          if (event.key !== 'Enter') return
          event.preventDefault()
          if (!event.nativeEvent.isComposing && event.keyCode !== 229) void submit()
        }}
        className="min-h-14 min-w-0 flex-1 rounded-full border-2 border-ink bg-paper px-6 text-base text-ink focus-visible:outline-lime" />
      <PillButton type="submit" variant="ink" size="lg" aria-label={t('submit')} loading={busy} disabled={!value.trim()}>{t('submit')}</PillButton>
    </form>
    <div className="flex flex-wrap justify-center gap-2">{[0, 1, 2, 3].map((i) => {
      const text = t(`chips.${i}`)
      return <Chip key={i} onClick={() => { setValue(text); input.current?.focus() }}>{text}</Chip>
    })}</div>
  </div>
}
