'use client'

import type { Message, Page } from '@autix/contracts'
import { useQueryClient, type InfiniteData } from '@tanstack/react-query'
import { ArrowDown } from 'lucide-react'
import { usePathname, useRouter } from 'next/navigation'
import { useLocale, useTranslations } from 'next-intl'
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Chip } from '@/components/ui/Chip'
import { LogoDot } from '@/components/ui/Logo'
import { PillButton } from '@/components/ui/PillButton'
import { toast } from '@/components/ui/toast'
import { ApiRequestError } from '@/features/auth/api-client'
import { useAuth } from '@/features/auth/auth-store'
import { usePendingPrompt } from '@/features/auth/pending-prompt'
import { createConversation } from '@/features/conversations/api'
import { HistoryDrawer } from '@/features/conversations/HistoryDrawer'
import { messagesKey, useMessages } from '@/features/conversations/queries'
import { useCountdown } from '@/lib/use-countdown'
import { BG_TRANSITION } from '@/lib/motion'
import { PanelTabs, SaveTripButton, TripPanels } from '@/features/panels/TripPanels'
import { getTripMock } from '@/features/panels/mock'
import { STAGE_COLOR, type PanelTab } from '@/features/panels/mock/types'
import { MobileSheet } from '@/features/panels/MobileSheet'
import { useIsDesktop } from '@/lib/use-media-query'
import { Composer } from './Composer'
import { MessageList, SkeletonBubbles } from './MessageList'
import { TopBar } from './TopBar'
import { useChatStream, type SendOutcome } from './use-chat-stream'
import { useStickToBottom } from './use-stick-to-bottom'

const CHIP_COUNT = 4

/** '/chat' → null；'/chat/abc' → 'abc'；多于一段取第一段。 */
export function conversationIdFromPath(pathname: string): string | null {
  const match = /^\/chat\/([^/]+)/.exec(pathname)
  if (!match) return null
  try {
    return decodeURIComponent(match[1])
  } catch {
    return match[1]
  }
}

function SuggestionChips({ onPick }: { onPick(text: string): void }) {
  const t = useTranslations('chat')
  return (
    <div className="flex flex-wrap justify-center gap-2">
      {Array.from({ length: CHIP_COUNT }, (_, i) => {
        const text = t(`chips.${i}`)
        return (
          <Chip key={i} onClick={() => onPick(text)}>
            {text}
          </Chip>
        )
      })}
    </div>
  )
}

export function ChatScreen(): ReactNode {
  const t = useTranslations('chat')
  const tc = useTranslations('common')
  const router = useRouter()
  const queryClient = useQueryClient()
  const auth = useAuth()
  const id = conversationIdFromPath(usePathname())

  const [input, setInput] = useState('')
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [sheetOpen, setSheetOpen] = useState(false)
  const isDesktop = useIsDesktop()
  const [panelTab, setPanelTab] = useState<PanelTab>('plan')
  const background = STAGE_COLOR[panelTab]
  const locale = useLocale()
  const panelData = getTripMock(locale === 'en' ? 'en' : 'zh')
  const [missingId, setMissingId] = useState<string | null>(null)
  const countdown = useCountdown()
  const composerRef = useRef<HTMLTextAreaElement>(null)
  const drawerButtonRef = useRef<HTMLButtonElement>(null)
  const busyRef = useRef(false)

  const stream = useChatStream(id)
  // 首条消息发出、地址还没同步前，按正在生成的会话展示
  const viewId = id ?? stream.activeConversationId
  const generating = stream.phase !== 'idle'
  const query = useMessages(viewId, generating)
  const nickname = auth.status === 'authed' ? auth.user.nickname : ''

  const notFound =
    query.error?.code === 'CONVERSATION_NOT_FOUND' ||
    (missingId !== null && missingId === viewId)
  const messages = useMemo(
    () =>
      notFound
        ? []
        : (query.data?.pages.flatMap((page) => page.items) ?? []).slice().reverse(),
    [notFound, query.data],
  )
  const loadingInitial = viewId !== null && query.isPending && !notFound
  const pending =
    generating && stream.activeConversationId === viewId
      ? { text: stream.text, requirements: stream.requirements }
      : null

  const stick = useStickToBottom(
    `${messages.at(-1)?.id ?? ''}|${pending?.text.length ?? -1}|${pending?.requirements.length ?? 0}|${loadingInitial}`,
    viewId,
  )

  const restoreInput = (raw: string) =>
    setInput((current) => (current === '' ? raw : current))

  const handleFailure = (raw: string, targetId: string | null, error: ApiRequestError) => {
    restoreInput(raw)
    switch (error.code) {
      case 'RATE_LIMITED':
        if (error.retryAfter !== undefined) countdown.start(error.retryAfter)
        break
      case 'CONVERSATION_NOT_FOUND':
        setMissingId(targetId)
        break
      case 'ABORTED':
        break
      default:
        toast(t('sendFailed'), { tone: 'danger' })
    }
  }

  const submit = async (raw: string, target: string | null) => {
    const content = raw.trim()
    if (!content || busyRef.current || stream.phase !== 'idle') return
    // 首次消息拉取还在途中：它可能盖掉流写入缓存的用户消息，等它结束再发
    if (target !== null && loadingInitial) return
    busyRef.current = true
    setInput('')
    let conversationId = target
    let outcome: SendOutcome
    try {
      if (conversationId === null) {
        const created = await createConversation()
        conversationId = created.id
        // 预置空缓存：新会话不必拉取消息，也避免拉取结果盖掉流写入的消息
        queryClient.setQueryData<InfiniteData<Page<Message>>>(messagesKey(created.id), {
          pages: [{ items: [], nextCursor: null }],
          pageParams: [undefined],
        })
        window.history.replaceState(null, '', '/chat/' + created.id)
      }
      outcome = await stream.send(conversationId, content)
    } catch (error) {
      outcome = {
        ok: false,
        error: error instanceof ApiRequestError ? error : new ApiRequestError('NETWORK', 0),
      }
    } finally {
      busyRef.current = false
    }
    if (!outcome.ok) handleFailure(raw, conversationId, outcome.error)
  }

  const deferredPrompt = useRef<{ prompt: string; conversationId: string } | null>(null)
  useEffect(() => {
    // 不带依赖数组：每次渲染都检查，拉取结束后的那次渲染发出暂存的消息
    if (deferredPrompt.current === null) return
    if (deferredPrompt.current.conversationId !== id) { deferredPrompt.current = null; return }
    if (loadingInitial || id === null) return
    const { prompt } = deferredPrompt.current
    deferredPrompt.current = null
    void submit(prompt, id)
  })

  usePendingPrompt(auth.status === 'authed', (pendingPrompt) => {
    if (pendingPrompt.conversationId !== undefined) {
      if (pendingPrompt.conversationId !== id) return
      if (loadingInitial) deferredPrompt.current = { prompt: pendingPrompt.prompt, conversationId: pendingPrompt.conversationId }
      else void submit(pendingPrompt.prompt, id)
      return
    }
    if (id === null) void submit(pendingPrompt.prompt, null)
  })

  const pickChip = (text: string) => {
    setInput(text)
    composerRef.current?.focus()
  }

  const isNewChat = viewId === null
  const showChips = !notFound && !loadingInitial && input === '' && !generating
  let body: ReactNode = null
  if (loadingInitial) {
    body = <SkeletonBubbles count={3} />
  } else if (notFound) {
    body = (
      <div className="m-auto flex flex-col items-center gap-4 text-center">
        <p className="text-2xl font-extrabold text-ink">{t('notFound')}</p>
        <PillButton variant="lime" onClick={() => router.push('/chat')}>
          {t('startNew')}
        </PillButton>
      </div>
    )
  } else if (query.isError) {
    body = (
      <div className="m-auto flex flex-col items-center gap-4 text-center">
        <p className="text-base font-bold text-ink">{tc('loadFailed')}</p>
        <PillButton variant="ink" onClick={() => void query.refetch()}>
          {tc('retry')}
        </PillButton>
      </div>
    )
  } else if (isNewChat) {
    body = (
      <div className="m-auto flex flex-col items-center gap-6 text-center">
        <h1 className="text-4xl font-extrabold leading-none text-ink">
          {t('greeting', { nickname })}
        </h1>
        {showChips ? <SuggestionChips onPick={pickChip} /> : null}
      </div>
    )
  }

  return (
    <div
      data-testid="chat-screen"
      className="flex h-dvh flex-col"
      style={{ backgroundColor: background, transition: BG_TRANSITION }}
    >
      <TopBar
        center={isDesktop ? <PanelTabs tab={panelTab} onChange={setPanelTab} /> : null}
        right={isDesktop ? <SaveTripButton /> : null}
        drawerButtonRef={drawerButtonRef}
        drawerOpen={drawerOpen}
        onToggleDrawer={() => setDrawerOpen((open) => !open)}
      />
      <HistoryDrawer open={drawerOpen} onClose={() => setDrawerOpen(false)} activeId={viewId}
        isBlankNewChat={viewId === null && input === ''} returnFocusRef={drawerButtonRef} />
      <div className="flex min-h-0 flex-1 gap-4 px-4 pb-4 sm:px-6">
        <section className="flex min-h-0 w-full flex-col gap-3 lg:w-[42%]">
          <div className="flex items-center gap-3">
            <LogoDot className="bg-ink" />
            <div className="min-w-0">
              <p className="text-base font-extrabold text-ink">{t('assistantName')}</p>
              <p className="text-sm text-ink">{generating ? t('typing') : t('online')}</p>
            </div>
          </div>
          <div className="relative flex min-h-0 flex-1 flex-col">
            <MessageList
              scrollRef={stick.ref}
              messages={messages}
              pending={pending}
              hasMore={!notFound && !generating && query.hasNextPage}
              loadingMore={query.isFetchingNextPage}
              loadMoreFailed={query.isFetchNextPageError && !query.isFetchingNextPage}
              onLoadMore={() => { if (!generating && !busyRef.current) void query.fetchNextPage() }}
            >
              {body}
            </MessageList>
            {stick.atBottom ? null : (
              <div className="absolute bottom-3 left-1/2 -translate-x-1/2">
                <PillButton
                  variant="ink"
                  iconOnly
                  aria-label={t('jumpToLatest')}
                  onClick={stick.scrollToBottom}
                >
                  <ArrowDown size={20} aria-hidden />
                </PillButton>
              </div>
            )}
          </div>
          {!isNewChat && showChips ? <SuggestionChips onPick={pickChip} /> : null}
          {!isDesktop ? <PillButton variant="ghost" size="sm" onClick={() => setSheetOpen(true)}>{t('viewTrip')}</PillButton> : null}
          <Composer
            ref={composerRef}
            value={input}
            onChange={setInput}
            generating={generating}
            rateLimitSeconds={countdown.seconds}
            onSend={() => void submit(input, id)}
            onStop={stream.stop}
          />
        </section>
        {isDesktop ? <aside className="min-h-0 flex-1 overflow-y-auto rounded-panel bg-ink"><TripPanels tab={panelTab} data={panelData} /></aside> : null}
      </div>
      {!isDesktop ? <MobileSheet open={sheetOpen} onClose={() => setSheetOpen(false)}>
        <div className="flex items-center gap-3 px-4 py-3"><div className="min-w-0 flex-1"><PanelTabs tab={panelTab} onChange={setPanelTab} scrollable /></div><SaveTripButton /></div>
        <TripPanels tab={panelTab} data={panelData} />
      </MobileSheet> : null}
    </div>
  )
}
