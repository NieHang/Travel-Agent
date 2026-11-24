'use client'

import type { NightRange, ResultItem, TripView } from '@autix/contracts'
import { CalendarDays } from 'lucide-react'
import { useFormatter, useTranslations } from 'next-intl'
import { useId } from 'react'
import { amenityIcon } from '@/components/ai-ui/amenity-icon'
import { Banner } from '@/components/ai-ui/ResultCard'
import { stayRun } from './plan-model'

/** "Night 2" or "Nights 2–3", counting night 0 as the first. */
export function useNightsLabel(): (nights: NightRange) => string {
  const t = useTranslations('panels.live')
  return ({ from, to }) => (from === to ? t('night', { n: from + 1 }) : t('nights', { from: from + 1, to: to + 1 }))
}

/** The selected day's hotel: its run of nights, price and details. */
export function StayCard({ data, day, stay }: { data: TripView; day: number; stay: ResultItem }) {
  const t = useTranslations('panels')
  const format = useFormatter()
  const nightsLabel = useNightsLabel()
  const headingId = useId()
  const run = stayRun(data, day)
  const date = (value: Date) => format.dateTime(value, { month: 'long', day: 'numeric', timeZone: 'UTC' })
  const facts = [
    ...(run?.checkIn ? [{ icon: CalendarDays, label: t('plan.checkIn'), value: date(run.checkIn) }] : []),
    ...(run?.checkOut ? [{ icon: CalendarDays, label: t('plan.checkOut'), value: date(run.checkOut) }] : []),
    ...stay.details.map((detail) => ({
      icon: amenityIcon(detail.label),
      label: detail.label,
      value: detail.value.translation ?? detail.value.original,
    })),
  ]
  const runLabel = run
    ? run.wholeTrip
      ? t('cover.nights', { count: run.nights.to - run.nights.from + 1, oneStay: 'true' })
      : nightsLabel(run.nights)
    : null

  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-3.5">
      <h2 id={headingId} className="text-lg font-bold">{t('plan.stay')}</h2>
      <div className="flex flex-col gap-4 rounded-trip-lg bg-white p-3 shadow-trip-card lg:flex-row lg:flex-wrap lg:items-center lg:gap-5">
        <Banner item={stay} className="aspect-[16/10] w-full shrink-0 rounded-trip-xs lg:max-w-[260px] lg:flex-[1_1_200px]" />
        <div className="flex min-w-0 flex-col gap-[18px] px-1 pb-1 lg:flex-[2_1_280px] lg:py-2 lg:pr-3 lg:pl-0">
          <div className="flex items-baseline justify-between gap-3">
            <span className="flex min-w-0 flex-col gap-[3px]">
              <span className="text-lg font-bold">{stay.title.translation ?? stay.title.original}</span>
              {runLabel ? <span className="text-[13px] text-trip-muted">{runLabel}</span> : null}
            </span>
            {stay.price ? (
              <span className="shrink-0 text-lg font-bold">
                {format.number(stay.price.amount, { style: 'currency', currency: stay.price.currency, maximumFractionDigits: 0 })}
                <span className="ml-1 text-[13px] font-normal text-trip-muted">{t('perNight')}</span>
              </span>
            ) : null}
          </div>
          {facts.length ? (
            <dl className="grid grid-cols-2 gap-x-3 gap-y-3.5 lg:grid-cols-[repeat(auto-fit,minmax(140px,1fr))]">
              {facts.map(({ icon: Icon, label, value }, i) => (
                <div key={i} className="flex min-w-0 items-center gap-2.5">
                  <Icon size={22} strokeWidth={1.7} aria-hidden className="shrink-0" />
                  <div className="flex min-w-0 flex-col gap-px">
                    <dt className="text-[13px] text-trip-muted">{label}</dt>
                    <dd className="text-[15px] font-bold">{value}</dd>
                  </div>
                </div>
              ))}
            </dl>
          ) : null}
        </div>
      </div>
    </section>
  )
}
