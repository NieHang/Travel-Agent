'use client'

import { useReducedMotion } from '@/lib/use-reduced-motion'

import type { Conversation } from '@autix/contracts'
import { Dropdown } from '@heroui/react'
import { MoreHorizontal } from 'lucide-react'
import { motion } from 'motion/react'
import { useFormatter, useNow, useTranslations } from 'next-intl'
import { useEffect, useRef, useState, type Ref } from 'react'
import { springs } from '@/lib/motion'
import { useRenameConversation } from './queries'

export function ConversationItem({ conversation, active, onOpen, onDelete, rowRef, onMove }: {
  conversation: Conversation
  active: boolean
  onOpen(): void
  onDelete(): void
  rowRef: Ref<HTMLButtonElement>
  onMove(step: number): void
}) {
  const t = useTranslations('drawer')
  const formatter = useFormatter()
  const now = useNow({ updateInterval: 60_000 })
  const reduced = useReducedMotion()
  const rename = useRenameConversation()
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(conversation.title)
  const input = useRef<HTMLInputElement>(null)
  const cancelled = useRef(false)
  useEffect(() => {
    if (!editing) return
    // 等菜单关闭后的焦点恢复结束，再选中编辑框。
    const timer = setTimeout(() => {
      input.current?.focus()
      input.current?.select()
    }, 0)
    return () => clearTimeout(timer)
  }, [editing])
  const save = () => {
    if (!editing || cancelled.current) return
    cancelled.current = true
    setEditing(false)
    const title = draft.trim()
    if (title && title !== conversation.title) rename.mutate({ id: conversation.id, title })
  }
  return (
    <motion.li layout={!reduced} exit={{ opacity: 0, height: 0 }} transition={springs.smooth}
      className="group flex min-w-0 items-center gap-1 overflow-hidden rounded-card">
      {editing ? (
        <input ref={input} aria-label={t('rename')} maxLength={60} value={draft}
          onChange={(event) => setDraft(event.target.value)} onBlur={save}
          onKeyDown={(event) => {
            if (event.nativeEvent.isComposing) return
            if (event.key === 'Escape') {
              event.stopPropagation()
              cancelled.current = true
              setEditing(false)
            } else if (event.key === 'Enter') { event.preventDefault(); save() }
          }} className="min-h-11 min-w-0 flex-1 rounded-full border-2 border-ink px-3" />
      ) : (
        <button ref={rowRef} type="button" aria-current={active ? 'page' : undefined}
          onClick={onOpen} onKeyDown={(event) => {
            if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
              event.preventDefault(); onMove(event.key === 'ArrowDown' ? 1 : -1)
            }
          }} className={`flex min-h-14 min-w-0 flex-1 cursor-pointer flex-col items-start px-3 py-2 text-left ${active ? 'bg-lime' : 'hover:bg-ink/5'}`}>
          <span className="w-full truncate font-bold">{conversation.title || t('newChat')}</span>
          <span className="text-sm">{formatter.relativeTime(new Date(conversation.updatedAt), now)}</span>
        </button>
      )}
      <Dropdown>
        <Dropdown.Trigger aria-label={t('more')}
          className="inline-flex size-11 shrink-0 items-center justify-center rounded-full opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 [@media(hover:none)]:opacity-100">
          <MoreHorizontal size={20} aria-hidden />
        </Dropdown.Trigger>
        <Dropdown.Popover className="rounded-card bg-paper text-ink">
          <Dropdown.Menu aria-label={t('more')} onAction={(key) => {
            if (key === 'rename') { cancelled.current = false; setDraft(conversation.title); setEditing(true) }
            else if (key === 'delete') onDelete()
          }}>
            <Dropdown.Item id="rename" textValue={t('rename')}>{t('rename')}</Dropdown.Item>
            <Dropdown.Item id="delete" textValue={t('delete')}>{t('delete')}</Dropdown.Item>
          </Dropdown.Menu>
        </Dropdown.Popover>
      </Dropdown>
    </motion.li>
  )
}
