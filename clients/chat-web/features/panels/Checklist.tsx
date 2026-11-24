'use client'

import type { Todo } from '@autix/contracts'
import { ToggleButton } from '@heroui/react'
import {
  Check, ChevronRight, Clock, CreditCard, ImageIcon, MapPin, SquareCheckBig, Ticket, type LucideIcon,
} from 'lucide-react'
import { useTranslations } from 'next-intl'
import { useId } from 'react'
import { useChecklistDone } from './checklist-done'

/** How each kind of item looks; its tag text is `panels.plan.todoKind.<kind>`. */
const KINDS: Record<Todo['kind'], { icon: LucideIcon; tint: string; tone: string }> = {
  reserve: { icon: Ticket, tint: 'bg-tint-rose', tone: 'text-tone-rose' },
  tickets: { icon: ImageIcon, tint: 'bg-tint-violet', tone: 'text-tone-violet' },
  on_arrival: { icon: CreditCard, tint: 'bg-tint-sky', tone: 'text-tone-sky' },
  reminder: { icon: Clock, tint: 'bg-tint-apricot', tone: 'text-tone-apricot' },
  optional: { icon: MapPin, tint: 'bg-tint-olive', tone: 'text-tone-olive' },
}

export function Checklist({ todos, conversationId }: { todos: Todo[]; conversationId: string }) {
  const t = useTranslations('panels.plan')
  const headingId = useId()
  const { done, toggle } = useChecklistDone(conversationId)
  const doneCount = todos.filter((todo) => done.has(todo.title)).length
  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-3.5">
      <div className="flex items-baseline justify-between gap-3">
        <h2 id={headingId} className="text-2xl font-bold lg:text-lg">{t('checklist')}</h2>
        <span className="shrink-0 text-[13px] text-trip-muted">{t('progress', { done: doneCount, total: todos.length })}</span>
      </div>
      <ul className="grid grid-cols-[repeat(auto-fit,minmax(min(300px,100%),1fr))] gap-2.5">
        {todos.map((todo, i) => (
          <li key={`${i}:${todo.title}`} className="flex">
            <TodoRow todo={todo} done={done.has(todo.title)} onToggle={() => toggle(todo.title)} />
          </li>
        ))}
      </ul>
    </section>
  )
}

function TodoRow({ todo, done, onToggle }: { todo: Todo; done: boolean; onToggle: () => void }) {
  const t = useTranslations('panels.plan')
  const { icon: Icon, tint, tone } = KINDS[todo.kind]
  const tag = t(`todoKind.${todo.kind}`)
  return (
    <ToggleButton
      isSelected={done}
      onChange={onToggle}
      className={`h-auto min-h-[68px] w-full justify-start gap-3 rounded-trip-md py-2.5 pr-3.5 pl-3 text-left whitespace-normal text-trip-ink ${tint}`}
    >
      <span className="grid size-11 shrink-0 place-items-center rounded-full bg-white shadow-trip-pin">
        <Icon aria-hidden className={`m-0 size-5 ${tone}`} />
      </span>
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className={`text-[15px] font-bold ${done ? 'text-trip-muted line-through' : ''}`}>{todo.title}</span>
        <span className="text-[13px] font-normal text-trip-muted">{todo.note ? `${tag} · ${todo.note}` : tag}</span>
      </span>
      <span
        aria-hidden
        className={`grid size-[26px] shrink-0 place-items-center rounded-full ${done ? 'bg-trip-ink text-white' : 'border-2 border-trip-muted bg-white'}`}
      >
        {done ? <Check strokeWidth={3} className="m-0 size-3.5" /> : null}
      </span>
    </ToggleButton>
  )
}

/** The mobile plan's one-row stand-in for the checklist; it opens the checklist tab. */
export function ChecklistReminder({ todos, conversationId, onOpen }: {
  todos: Todo[]
  conversationId: string
  onOpen: () => void
}) {
  const t = useTranslations('panels.plan')
  const { done } = useChecklistDone(conversationId)
  const left = todos.filter((todo) => !done.has(todo.title)).length
  return (
    <button
      type="button"
      onClick={onOpen}
      className="flex min-h-[60px] cursor-pointer items-center gap-3 rounded-trip-sm bg-white px-3.5 py-2.5 text-left text-trip-ink shadow-trip-card"
    >
      <span className="grid size-10 shrink-0 place-items-center rounded-full bg-trip-tile text-trip-accent">
        <SquareCheckBig size={20} aria-hidden />
      </span>
      <span className="flex min-w-0 flex-1 flex-col gap-px">
        <span className="text-[15px] font-bold">{t('checklist')}</span>
        <span className="text-[13px] text-trip-muted">{left ? t('left', { left }) : t('allDone')}</span>
      </span>
      <ChevronRight size={18} aria-hidden className="shrink-0" />
    </button>
  )
}
