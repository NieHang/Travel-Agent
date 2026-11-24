'use client'

import type { Command, Message, Page } from '@autix/contracts'
import { useQueryClient, type InfiniteData } from '@tanstack/react-query'
import { ArrowDown } from 'lucide-react'
import { usePathname, useRouter } from 'next/navigation'
import { useLocale, useTranslations } from 'next-intl'
import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { Chip } from '@/components/ui/Chip'
import { PillButton } from '@/components/ui/PillButton'
import { toast } from '@/components/ui/toast'
import { ApiRequestError } from '@/features/auth/api-client'
import { useAuth } from '@/features/auth/auth-store'
import { usePendingPrompt } from '@/features/auth/pending-prompt'
import { createConversation } from '@/features/conversations/api'
import { HistoryDrawer } from '@/features/conversations/HistoryDrawer'
import { messagesKey, useMessages } from '@/features/conversations/queries'
import { useCountdown } from '@/lib/use-countdown'
import { LiveTripPanels } from '@/features/panels/LiveTripPanels'
import { MobileSheet } from '@/features/panels/MobileSheet'
import { MobileTrip } from '@/features/panels/MobileTrip'
import { PanelTabs, SaveTripButton } from '@/features/panels/TripPanels'
import type { PanelTab } from '@/features/panels/tabs'
import { useIsDesktop } from '@/lib/use-media-query'
import { Composer } from './Composer'
import { MessageList, SkeletonBubbles } from './MessageList'
import { TopBar } from './TopBar'
import { useChatStream, type SendOutcome } from './use-chat-stream'
import { useStickToBottom } from './use-stick-to-bottom'
import { uiStateKey, useUIState } from './ui-state'

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

function SuggestionChips({ centered = false, onPick }: { centered?: boolean; onPick: (text: string) => void }) {
  const t = useTranslations('chat')
  return (
    <div className={`flex flex-wrap gap-2 ${centered ? 'justify-center' : ''}`}>
      {Array.from({ length: CHIP_COUNT }, (_, i) => {
        const text = t(`chips.${i}`)
        return (
          <Chip key={i} variant="outline" onClick={() => onPick(text)}>
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
  const tp = useTranslations('panels')
  const chatLabelId = useId()
  const router = useRouter()
  const queryClient = useQueryClient()
  const auth = useAuth()
  const id = conversationIdFromPath(usePathname())

  const [input, setInput] = useState('')
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [sheetOpen, setSheetOpen] = useState(false)
  const isDesktop = useIsDesktop()
  const [panelTab, setPanelTab] = useState<PanelTab>('plan')
  // The turn contract accepts only the two app locales.
  const locale = useLocale() === 'en' ? 'en' : 'zh'

  const [missingId, setMissingId] = useState<string | null>(null)
  const countdown = useCountdown()
  const composerRef = useRef<HTMLTextAreaElement>(null)
  const drawerButtonRef = useRef<HTMLButtonElement>(null)
  const busyRef = useRef(false)

  const stream = useChatStream(id)
  const sendTurn = stream.send
  // 首条消息发出、地址还没同步前，按正在生成的会话展示
  const viewId = id ?? stream.activeConversationId
  const generating = stream.phase !== 'idle'
  const query = useMessages(viewId, generating)
  const uiState = useUIState(viewId)
  const nickname = auth.status === 'authed' ? auth.user.nickname : ''

  const notFound =
    query.error?.code === 'CONVERSATION_NOT_FOUND' ||
    (missingId !== null && missingId === viewId)
  const messages = useMemo(
    () =>
      notFound
        ? []
        : (query.data?.pages.flatMap((page) => page.items) ?? [])
            .slice()
            .reverse(),
    [notFound, query.data],
  )
  const panelData =
    stream.streamConversationId === viewId && stream.trip !== undefined
      ? stream.trip
      : (uiState.data?.trip ?? null)
  const loadingInitial = viewId !== null && query.isPending && !notFound
  // Once `done` arrives the saved message is already in the cache; showing the
  // streamed bubble too would render its components twice until the stream closes.
  const pending =
    generating &&
    stream.activeConversationId === viewId &&
    stream.outcome !== 'completed'
      ? { text: stream.text, components: stream.components, steps: stream.steps }
      : null
  const revision = uiState.data?.revision ?? 0

  const stick = useStickToBottom(
    `${messages.at(-1)?.id ?? ''}|${pending?.text.length ?? -1}|${pending?.components?.length ?? 0}|${loadingInitial}`,
    viewId,
  )

  const restoreInput = (raw: string) =>
    setInput((current) => (current === '' ? raw : current))

  const handleFailure = (
    raw: string,
    targetId: string | null,
    error: ApiRequestError,
  ) => {
    restoreInput(raw)
    // oxlint-disable-next-line typescript/switch-exhaustiveness-check -- 其余错误码都弹同一个发送失败提示
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
    // The trip revision is not loaded yet; a guessed revision would only get a 409.
    if (target !== null && uiState.isPending) return
    busyRef.current = true
    setInput('')
    let conversationId = target
    let outcome: SendOutcome
    try {
      if (conversationId === null) {
        const created = await createConversation()
        conversationId = created.id
        // 预置空缓存：新会话不必拉取消息，也避免拉取结果盖掉流写入的消息
        queryClient.setQueryData<InfiniteData<Page<Message>>>(
          messagesKey(created.id),
          {
            pages: [{ items: [], nextCursor: null }],
            pageParams: [undefined],
          },
        )
        window.history.replaceState(null, '', '/chat/' + created.id)
      }
      outcome = await stream.send(conversationId, {
        revision: target === null ? 0 : revision,
        command: { type: 'message', text: content },
        locale,
      })
    } catch (error) {
      outcome = {
        ok: false,
        error:
          error instanceof ApiRequestError
            ? error
            : new ApiRequestError('NETWORK', 0),
      }
    } finally {
      busyRef.current = false
    }
    if (!outcome.ok) handleFailure(raw, conversationId, outcome.error)
  }

  const sendCommand = useCallback(
    async (command: Command) => {
      if (!viewId || busyRef.current || generating || loadingInitial || uiState.isPending) return
      busyRef.current = true
      try {
        const outcome = await sendTurn(viewId, { revision: uiState.data?.revision ?? 0, command, locale })
        if (!outcome.ok && outcome.error.code !== 'ABORTED') {
          toast(t('sendFailed'), { tone: 'danger' })
          void queryClient.invalidateQueries({ queryKey: uiStateKey(viewId) })
        }
      } finally {
        busyRef.current = false
      }
    },
    [viewId, generating, loadingInitial, uiState.isPending, uiState.data?.revision, sendTurn, locale, t, queryClient],
  )

  const deferredPrompt = useRef<{
    prompt: string
    conversationId: string
  } | null>(null)
  useEffect(() => {
    // 不带依赖数组：每次渲染都检查，拉取结束后的那次渲染发出暂存的消息
    if (deferredPrompt.current === null) return
    if (deferredPrompt.current.conversationId !== id) {
      deferredPrompt.current = null
      return
    }
    if (loadingInitial || id === null) return
    const { prompt } = deferredPrompt.current
    deferredPrompt.current = null
    void submit(prompt, id)
  })

  usePendingPrompt(auth.status === 'authed', (pendingPrompt) => {
    if (pendingPrompt.conversationId !== undefined) {
      if (pendingPrompt.conversationId !== id) return
      if (loadingInitial)
        deferredPrompt.current = {
          prompt: pendingPrompt.prompt,
          conversationId: pendingPrompt.conversationId,
        }
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
        <p className="text-2xl font-bold">{t('notFound')}</p>
        <PillButton variant="trip-ink" onClick={() => router.push('/chat')}>
          {t('startNew')}
        </PillButton>
      </div>
    )
  } else if (query.isError) {
    body = (
      <div className="m-auto flex flex-col items-center gap-4 text-center">
        <p className="text-[15px] font-bold">{tc('loadFailed')}</p>
        <PillButton variant="trip-ink" onClick={() => void query.refetch()}>
          {tc('retry')}
        </PillButton>
      </div>
    )
  } else if (isNewChat) {
    body = (
      <div className="m-auto flex flex-col items-center gap-6 text-center">
        <h1 className="text-[32px] leading-tight font-bold tracking-[-0.5px]">
          {t('greeting', { nickname })}
        </h1>
        {showChips ? <SuggestionChips centered onPick={pickChip} /> : null}
      </div>
    )
  }

  return (
    <div data-testid="chat-screen" className="flex h-dvh flex-col bg-trip-ground font-trip text-trip-ink">
      <TopBar
        center={
          isDesktop ? <PanelTabs tab={panelTab} onChange={setPanelTab} /> : null
        }
        right={isDesktop ? <SaveTripButton /> : null}
        drawerButtonRef={drawerButtonRef}
        drawerOpen={drawerOpen}
        onToggleDrawer={() => setDrawerOpen((open) => !open)}
      />
      <HistoryDrawer
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        activeId={viewId}
        isBlankNewChat={viewId === null && input === ''}
        returnFocusRef={drawerButtonRef}
      />
      <div className="flex min-h-0 flex-1 gap-8 px-4 pb-4 lg:px-8 lg:pt-2 lg:pb-10">
        <section aria-labelledby={chatLabelId} className="flex min-h-0 w-full min-w-0 flex-col gap-3 lg:max-w-[420px] lg:flex-[1_1_340px]">
          <span id={chatLabelId} className="px-0.5 pt-1 pb-2 text-[13px] text-trip-muted">
            {t('conversation')}
          </span>
          <div className="relative flex min-h-0 flex-1 flex-col">
            <MessageList
              scrollRef={stick.ref}
              messages={messages}
              pending={pending}
              generating={generating}
              onCommand={sendCommand}
              activeRevision={uiState.data?.revision}
              hasMore={!notFound && !generating && query.hasNextPage}
              loadingMore={query.isFetchingNextPage}
              loadMoreFailed={
                query.isFetchNextPageError && !query.isFetchingNextPage
              }
              onLoadMore={() => {
                if (!generating && !busyRef.current) void query.fetchNextPage()
              }}
            >
              {body}
            </MessageList>
            {stick.atBottom ? null : (
              <div className="absolute bottom-3 left-1/2 -translate-x-1/2">
                <PillButton
                  variant="trip-ink"
                  iconOnly
                  aria-label={t('jumpToLatest')}
                  onClick={stick.scrollToBottom}
                >
                  <ArrowDown size={20} aria-hidden />
                </PillButton>
              </div>
            )}
          </div>
          {!isNewChat && showChips ? (
            <SuggestionChips onPick={pickChip} />
          ) : null}
          {!isDesktop ? (
            <PillButton
              variant="trip-outline"
              size="sm"
              onClick={() => setSheetOpen(true)}
            >
              {t('viewTrip')}
            </PillButton>
          ) : null}
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
        {isDesktop ? (
          <aside aria-label={tp('live.title')} className="min-h-0 min-w-0 flex-[2_1_560px] overflow-y-auto rounded-trip-panel bg-trip-panel shadow-trip-panel">
            <LiveTripPanels
              key={viewId ?? 'new'}
              tab={panelTab}
              data={panelData}
              draft={stream.draft}
              busy={generating || uiState.isPending}
              onCommand={(command) => void sendCommand(command)}
              conversationId={viewId}
            />
          </aside>
        ) : null}
      </div>
      {!isDesktop ? (
        <MobileSheet open={sheetOpen} onClose={() => setSheetOpen(false)}>
          <MobileTrip
            key={viewId ?? 'new'}
            data={panelData}
            draft={stream.draft}
            busy={generating || uiState.isPending}
            onCommand={(command) => void sendCommand(command)}
            conversationId={viewId}
          />
        </MobileSheet>
      ) : null}
    </div>
  )
}
