'use client'

import { useReducedMotion } from '@/lib/use-reduced-motion'

import { Modal } from '@heroui/react'
import { MessagesSquare, SearchX, X } from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import { useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { useEffect, useRef, useState, type RefObject } from 'react'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { EmptyState } from '@/components/ui/EmptyState'
import { PillButton } from '@/components/ui/PillButton'
import { Skeleton } from '@/components/ui/Skeleton'
import { springs } from '@/lib/motion'
import { ConversationItem } from './ConversationItem'
import { useConversations, useDeleteConversation } from './queries'

type Props = {
  open: boolean
  onClose: () => void
  activeId: string | null
  isBlankNewChat: boolean
  returnFocusRef: RefObject<HTMLElement | null>
}

function DrawerContent({ onClose, activeId, isBlankNewChat }: Omit<Props, 'open' | 'returnFocusRef'>) {
  const t = useTranslations('drawer')
  const tc = useTranslations('common')
  const router = useRouter()
  const [search, setSearch] = useState('')
  const [q, setQ] = useState('')
  const [deleteId, setDeleteId] = useState<string | null>(null)
  const query = useConversations(q)
  const { hasNextPage, isFetching, isFetchNextPageError, fetchNextPage } = query
  const deletion = useDeleteConversation()
  const input = useRef<HTMLInputElement>(null)
  const rows = useRef<(HTMLButtonElement | null)[]>([])
  const root = useRef<HTMLDivElement>(null)
  const sentinel = useRef<HTMLDivElement>(null)
  const items = query.data?.pages.flatMap((page) => page.items) ?? []
  useEffect(() => {
    const timer = setTimeout(() => setQ(search.trim()), 300)
    return () => clearTimeout(timer)
  }, [search])
  useEffect(() => {
    if (!sentinel.current || !hasNextPage || isFetching || isFetchNextPageError) return
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) void fetchNextPage()
    }, { root: root.current, rootMargin: '120px' })
    observer.observe(sentinel.current)
    return () => observer.disconnect()
  }, [hasNextPage, isFetching, isFetchNextPageError, fetchNextPage])
  const visit = (path: string) => { router.push(path); onClose() }
  return (
    <>
      <PillButton variant="trip-ink" onClick={() => {
        if (isBlankNewChat) onClose(); else visit('/chat')
      }}>{t('newChat')}</PillButton>
      <div className="flex items-center rounded-full border border-trip-line bg-white pl-4">
        <input ref={input} autoFocus type="search" aria-label={t('search')} placeholder={t('search')}
          value={search} onChange={(event) => setSearch(event.target.value)}
          className="min-h-11 min-w-0 flex-1 bg-transparent outline-none" />
        {search ? <PillButton variant="trip-quiet" size="sm" iconOnly aria-label={t('clear')}
          onClick={() => { setSearch(''); input.current?.focus() }}><X size={18} aria-hidden /></PillButton> : null}
      </div>
      <div ref={root} className="min-h-0 flex-1 overflow-y-auto">
        <ul aria-label={t('search')} className="flex flex-col gap-2">
          <AnimatePresence initial={false}>
            {items.map((conversation, index) => <ConversationItem key={conversation.id} conversation={conversation}
              active={conversation.id === activeId} rowRef={(element) => { rows.current[index] = element }}
              onMove={(step) => rows.current[(index + step + items.length) % items.length]?.focus()}
              onOpen={() => visit('/chat/' + encodeURIComponent(conversation.id))}
              onDelete={() => setDeleteId(conversation.id)} />)}
          </AnimatePresence>
        </ul>
        {query.isPending || query.isFetchingNextPage ? <div aria-hidden className="flex flex-col gap-2">
          {[0, 1, 2].map((index) => <div key={index} data-testid="drawer-skeleton"><Skeleton className="h-14 rounded-trip-sm" /></div>)}
        </div> : null}
        {query.isError && !query.isFetching ? <div className="flex flex-col items-center gap-2 py-4">
          <p>{tc('loadFailed')}</p><PillButton variant="trip-ink" size="sm" onClick={() => {
            if (query.isFetchNextPageError) void fetchNextPage(); else void query.refetch()
          }}>{tc('retry')}</PillButton>
        </div> : !query.isPending && items.length === 0 ? <EmptyState icon={q ? SearchX : MessagesSquare} title={q ? t('noMatch') : t('empty')} /> : null}
        <div ref={sentinel} aria-hidden className="h-px" />
      </div>
      <ConfirmDialog open={deleteId !== null} title={t('confirmTitle')} body={t('confirmBody')}
        cancelLabel={tc('cancel')} confirmLabel={t('delete')} onCancel={() => setDeleteId(null)}
        onConfirm={() => {
          if (!deleteId) return
          const id = deleteId
          setDeleteId(null)
          deletion.mutate({ id }, { onSuccess: () => {
            if (id === activeId) { router.replace('/chat'); onClose() }
          } })
        }} />
    </>
  )
}

export function HistoryDrawer({ open, onClose, returnFocusRef, ...props }: Props) {
  const t = useTranslations('chat')
  const tc = useTranslations('common')
  const reduced = useReducedMotion()
  const wasOpen = useRef(false)
  useEffect(() => {
    if (!open && wasOpen.current) returnFocusRef.current?.focus()
    wasOpen.current = open
  }, [open, returnFocusRef])
  return (
    <Modal.Backdrop isOpen={open} onOpenChange={(next) => { if (!next) onClose() }} isDismissable
      data-testid="drawer-scrim" className="!fixed !inset-y-0 !left-0 !right-auto !z-50 !w-full !justify-start !bg-trip-scrim">
      <Modal.Container className="!m-0 !p-0 !h-full !max-h-none !w-full lg:!max-w-[360px] !rounded-none !bg-trip-panel">
        <Modal.Dialog aria-label={t('history')} className="!h-full !p-0 !outline-none">
          <motion.div initial={{ x: reduced ? 0 : -360, opacity: 0 }} animate={{ x: 0, opacity: 1 }}
            ref={(element) => {
              // React Aria省略 aria-modal；Modal.Dialog 仍负责完整的焦点管理。
              element?.closest('[role="dialog"]')?.setAttribute('aria-modal', 'true')
            }}
            transition={springs.drawer} className="flex h-full flex-col gap-4 p-4 font-trip text-trip-ink">
            <div className="flex justify-end"><PillButton variant="trip-quiet" iconOnly aria-label={tc('close')} onClick={onClose}><X size={20} aria-hidden /></PillButton></div>
            <DrawerContent {...props} onClose={onClose} />
          </motion.div>
        </Modal.Dialog>
      </Modal.Container>
    </Modal.Backdrop>
  )
}
