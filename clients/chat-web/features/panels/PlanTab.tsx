'use client'

import type { TripView } from '@autix/contracts'
import { ToggleButton, ToggleButtonGroup } from '@heroui/react'
import { ArrowDown, Clock, Leaf } from 'lucide-react'
import { useFormatter, useTranslations } from 'next-intl'
import { Checklist, ChecklistReminder } from './Checklist'
import { DayMap } from './DayMap'
import { dayDates, stopHue, timeMark } from './plan-model'
import { StayCard } from './StayCard'
import { cityCover } from './TripCover'

type Stop = TripView['days'][number]['stops'][number]

/**
 * One day of the itinerary at a time. With `onOpenChecklist` (mobile) the checklist shrinks to
 * a reminder row that opens its own tab; without it the full checklist sits under the dates.
 */
export function PlanTab({ data, day, onDay, conversationId, onOpenChecklist }: {
  data: TripView
  day: number
  onDay: (day: number) => void
  conversationId: string
  onOpenChecklist?: () => void
}) {
  const t = useTranslations('panels.plan')
  const selected = data.days[day]
  const stayImage = selected.stay?.image
  // The stay card right below already shows the hotel photo, so the map takes it only when the city has no cover.
  const dayPhoto = cityCover(data.destination)?.src ?? (stayImage?.startsWith('https:') ? stayImage : null)
  return (
    <div className="flex flex-col gap-5 lg:gap-7">
      <DayPicker data={data} day={day} onDay={onDay} />
      {data.tip ? (
        <p className="flex items-center gap-2 text-[13px] lg:gap-2.5 lg:text-[15px]">
          <Leaf size={18} aria-hidden className="shrink-0 text-trip-accent" />
          {data.tip}
        </p>
      ) : null}
      {data.todos.length ? (
        onOpenChecklist ? (
          <ChecklistReminder todos={data.todos} conversationId={conversationId} onOpen={onOpenChecklist} />
        ) : (
          <Checklist todos={data.todos} conversationId={conversationId} />
        )
      ) : null}
      <div className="flex flex-col gap-0.5 lg:gap-1">
        <span className="text-[13px] text-trip-muted">{t('kicker', { n: day + 1, pace: selected.pace ?? 'none' })}</span>
        <h2 className="text-2xl font-bold tracking-[-0.2px]">{selected.heading}</h2>
      </div>
      <div className="@container flex flex-wrap items-start gap-5 lg:gap-8">
        <ol className="flex min-w-0 flex-[1_1_380px] flex-col">
          {selected.stops.map((stop, i) => (
            <StopRow key={i} stop={stop} index={i} last={i === selected.stops.length - 1} />
          ))}
        </ol>
        <DayMap stops={selected.stops} day={day} photo={dayPhoto} />
      </div>
      {selected.stay ? <StayCard data={data} day={day} stay={selected.stay} /> : null}
    </div>
  )
}

function DayPicker({ data, day, onDay }: { data: TripView; day: number; onDay: (day: number) => void }) {
  const t = useTranslations('panels.plan')
  const format = useFormatter()
  return (
    <ToggleButtonGroup
      aria-label={t('pickDay')}
      selectionMode="single"
      disallowEmptySelection
      isDetached
      selectedKeys={[String(day)]}
      onSelectionChange={(keys) => {
        const [key] = keys
        if (key !== undefined) onDay(Number(key))
      }}
      className="grid w-full auto-cols-[minmax(56px,1fr)] grid-flow-col gap-2 overflow-x-auto lg:gap-2.5"
    >
      {dayDates(data).map((date, i) => (
        <ToggleButton
          key={i}
          id={String(i)}
          aria-label={date ? `${t('day', { n: i + 1 })} · ${format.dateTime(date, { month: 'long', day: 'numeric', weekday: 'short', timeZone: 'UTC' })}` : t('day', { n: i + 1 })}
          // Mobile marks the chosen day with an outline, desktop with the panel's one black block.
          className="group h-auto min-h-[60px] w-full flex-col gap-px rounded-trip-sm border-2 border-trip-tile bg-trip-tile px-1 text-trip-ink data-[selected=true]:border-trip-ink data-[selected=true]:bg-white lg:min-h-[72px] lg:gap-0.5 lg:border-0 lg:data-[selected=true]:bg-trip-ink lg:data-[selected=true]:text-white"
        >
          {date ? (
            <span className="text-[13px] font-normal text-trip-muted lg:group-data-[selected=true]:text-white/80">
              {format.dateTime(date, { weekday: 'short', timeZone: 'UTC' })}
            </span>
          ) : null}
          <span className="text-lg leading-[1.1] font-bold lg:text-2xl">{date ? date.getUTCDate() : i + 1}</span>
        </ToggleButton>
      ))}
    </ToggleButtonGroup>
  )
}

function StopRow({ stop, index, last }: { stop: Stop; index: number; last: boolean }) {
  const t = useTranslations('panels.plan')
  const mark = timeMark(stop.time, index)
  const hue = stopHue(index)
  const small = mark.kind === 'text' && mark.text.length > 3
  return (
    <li className="flex items-stretch gap-3 lg:gap-4">
      <div className="flex w-14 shrink-0 flex-col items-center lg:w-16">
        <span className={`flex size-14 shrink-0 flex-col items-center justify-center rounded-full border-[3px] border-white leading-[1.15] shadow-trip-pin lg:size-16 ${hue.tint}`}>
          {mark.kind === 'clock' ? <span className={`text-[13px] font-medium ${hue.tone}`}>{t(`period.${mark.period}`)}</span> : null}
          <span className={`font-bold ${small ? 'line-clamp-2 px-1 text-center text-xs break-all' : 'text-[15px]'}`}>
            {mark.kind === 'ordinal' ? mark.n : mark.text}
          </span>
        </span>
        {last ? null : <span aria-hidden className="min-h-3.5 w-0.5 flex-1 bg-trip-line" />}
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-2 pb-3.5">
        <div className="flex min-h-14 flex-col justify-center gap-[3px] rounded-trip-md bg-white py-2.5 pr-2.5 pl-4 shadow-trip-card lg:min-h-16">
          <span className="text-[15px] leading-[1.3] font-bold lg:text-lg">{stop.name}</span>
          {stop.note ? <span className="text-[13px] leading-normal text-trip-muted">{stop.note}</span> : null}
          {stop.hours ? (
            <span className={`flex items-center gap-[5px] pt-0.5 text-[13px] font-medium ${stop.hours.late ? 'text-trip-accent' : 'text-trip-muted'}`}>
              <Clock size={14} aria-hidden className="shrink-0" />
              {stop.hours.late ? `${stop.hours.text} · ${t('late')}` : stop.hours.text}
            </span>
          ) : null}
        </div>
        {stop.transit ? (
          <span className="flex items-center gap-1.5 pl-4 text-[13px] text-trip-muted">
            <ArrowDown size={14} aria-hidden className="shrink-0" />
            {stop.transit}
          </span>
        ) : null}
      </div>
    </li>
  )
}
