'use client'
import { useState, type ReactNode } from 'react'
import type { Command, ResultItem, TripView } from '@autix/contracts'
import { useFormatter, useTranslations } from 'next-intl'
import { ResultCard } from '@/components/ai-ui/ResultCard'
import { Markdown } from '@/components/ui/Markdown'
import { PillButton } from '@/components/ui/PillButton'
import { Checklist } from './Checklist'
import { PlanTab } from './PlanTab'
import { useNightsLabel } from './StayCard'
import { TripCover } from './TripCover'
import type { SheetTab } from './tabs'

export type LiveTripPanelsProps = {
  tab: SheetTab
  data: TripView | null
  /** The itinerary while it is being written. */
  draft?: string
  busy?: boolean
  onCommand?: (command: Command) => void
  /** Keys this viewer's checklist ticks. */
  conversationId: string | null
  /** Shown at the top of the sheet: the mobile tabs. */
  tabs?: ReactNode
  /** Shown at the bottom of the sheet: the mobile save button. */
  footer?: ReactNode
  /** Mobile: the plan shows a checklist reminder that calls this instead of the full checklist. */
  onOpenChecklist?: () => void
}

/**
 * The trip as a cover with a sheet over its lower edge. The desktop aside renders this only at
 * lg and up and the mobile sheet only below lg, so `lg:` variants switch between the two designs.
 */
export function LiveTripPanels({ tab, data, draft = '', busy = false, onCommand, conversationId, tabs, footer, onOpenChecklist }: LiveTripPanelsProps) {
  const [day, setDay] = useState(0)
  const lastDay = Math.max((data?.days.length ?? 0) - 1, 0)
  return (
    <div data-testid="live-trip-panel" className="flex flex-col text-trip-ink">
      <TripCover data={data} />
      <div className="relative -mt-9 flex flex-col gap-6 rounded-t-trip-panel bg-trip-panel px-5 pt-5 pb-8 lg:gap-7 lg:px-8 lg:pt-7 lg:pb-9">
        {tabs}
        <TabBody
          tab={tab}
          data={data}
          draft={draft}
          busy={busy}
          onCommand={onCommand}
          conversationId={conversationId}
          day={Math.min(day, lastDay)}
          onDay={setDay}
          onOpenChecklist={onOpenChecklist}
        />
        {footer}
      </div>
    </div>
  )
}

function TabBody({ tab, data, draft, busy, onCommand, conversationId, day, onDay, onOpenChecklist }: {
  tab: SheetTab
  data: TripView | null
  draft: string
  busy: boolean
  onCommand?: (command: Command) => void
  conversationId: string | null
  day: number
  onDay: (day: number) => void
  onOpenChecklist?: () => void
}) {
  const t = useTranslations('panels')
  if (draft && tab === 'plan') return <MarkdownCard content={draft} />
  if (!data || conversationId === null) return <Note>{t('live.empty')}</Note>
  switch (tab) {
    case 'plan':
      if (data.days.length)
        return <PlanTab data={data} day={day} onDay={onDay} conversationId={conversationId} onOpenChecklist={onOpenChecklist} />
      return data.itineraryMarkdown ? <MarkdownCard content={data.itineraryMarkdown} /> : <Note>{t('live.waiting')}</Note>
    case 'checklist':
      return data.todos.length ? <Checklist todos={data.todos} conversationId={conversationId} /> : <Note>{t('live.noTodos')}</Note>
    case 'hotels':
      if (onCommand && data.stayPlan.some((segment) => segment.options.length))
        return (
          <div className="flex flex-col gap-8">
            {data.stayPlan.map((segment) => (
              <StayChoice key={`${segment.nights.from}-${segment.nights.to}`} segment={segment} busy={busy} onCommand={onCommand} />
            ))}
          </div>
        )
      return <ResultList items={data.hotels} label={t('tabs.hotels')} />
    case 'routes':
      return <ResultList items={data.routes} label={t('tabs.routes')} />
    case 'hotspots':
      return <ResultList items={data.hotspots} label={t('tabs.hotspots')} />
  }
}

function MarkdownCard({ content }: { content: string }) {
  return (
    <div className="rounded-trip-md bg-white p-5 text-[15px] shadow-trip-card">
      <Markdown content={content} />
    </div>
  )
}

function Note({ children }: { children: ReactNode }) {
  return <p className="text-[15px] text-trip-muted">{children}</p>
}

function ResultList({ items, label }: { items: ResultItem[]; label: string }) {
  const t = useTranslations('panels.live')
  const [index, setIndex] = useState(0)
  if (!items.length) return <Note>{t('noResults')}</Note>
  const selected = items[Math.min(index, items.length - 1)]
  return (
    <div className="flex flex-col gap-4">
      <div role="radiogroup" aria-label={label} className="grid gap-3">
        {items.map((item, i) => (
          <div key={item.ref} role="radio" aria-checked={i === index} tabIndex={-1} onClick={() => setIndex(i)} className="cursor-pointer">
            <ResultCard item={item} variant="compact" selected={i === index} />
          </div>
        ))}
      </div>
      <Offer item={selected} />
    </div>
  )
}

type StaySegment = TripView['stayPlan'][number]

/** One run of nights on the same hotel; choosing another option changes the plan on the server. */
function StayChoice({ segment, busy, onCommand }: { segment: StaySegment; busy: boolean; onCommand: (command: Command) => void }) {
  const label = useNightsLabel()(segment.nights)
  const selected = segment.stay
  return (
    <section className="flex flex-col gap-3.5">
      <h3 className="text-lg font-bold">{label}</h3>
      <div role="radiogroup" aria-label={label} className="grid gap-3">
        {segment.options.map((item) => {
          const checked = item.ref === selected?.ref
          return (
            <button
              key={item.ref}
              type="button"
              role="radio"
              aria-checked={checked}
              disabled={busy || checked}
              onClick={() => onCommand({ type: 'choose_stay', ref: item.ref, nights: segment.nights })}
              className="cursor-pointer rounded-trip-md text-left disabled:cursor-default"
            >
              <ResultCard item={item} variant="compact" selected={checked} />
            </button>
          )
        })}
      </div>
      {selected ? <Offer item={selected} /> : null}
    </section>
  )
}

/** The chosen result's nightly price and booking link. */
function Offer({ item }: { item: ResultItem }) {
  const t = useTranslations('panels')
  const format = useFormatter()
  if (!item.price && !item.url) return null
  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      {item.price ? (
        <p>
          <span className="text-2xl font-bold">
            {format.number(item.price.amount, { style: 'currency', currency: item.price.currency, maximumFractionDigits: 0 })}
          </span>
          <span className="ml-1.5 text-[13px] text-trip-muted">{t('perNight')}</span>
        </p>
      ) : null}
      {item.url ? (
        <PillButton externalHref={item.url} variant="trip-soft" size="sm">
          {t('book', { hotel: item.title.translation ?? item.title.original })}
        </PillButton>
      ) : null}
    </div>
  )
}
