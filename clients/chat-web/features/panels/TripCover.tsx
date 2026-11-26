'use client'

import type { TripView } from '@autix/contracts'
import Image from 'next/image'
import { useFormatter, useTranslations } from 'next-intl'
import { useContext } from 'react'
import { SheetCover } from './MobileSheet'
import { coverFacts } from './plan-model'

const KYOTO = { src: '/covers/kyoto.webp', position: '50% 55%' }

/** Destinations with a cover photo, by trimmed lowercase name; any other gets a plain tinted cover. */
const COVERS = new Map([
  ['京都', KYOTO],
  ['kyoto', KYOTO],
])

const STATUS_DOT: Record<TripView['status'], string> = {
  collecting: 'bg-trip-muted',
  draft: 'bg-trip-success',
  confirmed: 'bg-trip-success',
}

export function TripCover({ data }: { data: TripView | null }) {
  const t = useTranslations('panels')
  const format = useFormatter()
  const sheetCover = useContext(SheetCover)
  const cover = data?.destination ? COVERS.get(data.destination.trim().toLowerCase()) : undefined
  const facts = data ? coverFacts(data) : null
  const date = (value: Date, withMonth: boolean) =>
    format.dateTime(value, withMonth ? { month: 'long', day: 'numeric', timeZone: 'UTC' } : { day: 'numeric', timeZone: 'UTC' })
  const subtitle = facts
    ? [
        facts.dates && `${date(facts.dates.start, true)} – ${date(facts.dates.end, !facts.dates.sameMonth)}`,
        facts.travelers !== null && t('live.travelers', { count: facts.travelers }),
        facts.nights && t('cover.nights', { count: facts.nights.count, oneStay: String(facts.nights.oneStay) }),
      ].filter(Boolean).join(' · ')
    : ''
  const title = data ? (data.destination ?? t('live.untitled')) : t('live.title')

  return (
    <div ref={sheetCover} className={`relative shrink-0 ${cover ? 'h-[330px] text-white lg:h-[340px]' : 'h-[232px] bg-trip-tile lg:h-[240px]'}`}>
      {cover ? (
        <>
          <Image
            src={cover.src}
            alt=""
            fill
            sizes="(min-width: 1024px) 60vw, 100vw"
            className="object-cover"
            style={{ objectPosition: cover.position }}
          />
          <span aria-hidden className="absolute inset-x-0 bottom-0 h-[62%] bg-linear-to-b from-transparent to-trip-scrim" />
        </>
      ) : null}
      {data ? (
        <span className="absolute top-sheet-strip left-4 flex items-center gap-1.5 rounded-full bg-white px-3 py-1.5 text-[13px] font-semibold text-trip-ink lg:top-5 lg:left-6 lg:gap-[7px] lg:px-3.5 lg:py-2">
          <span aria-hidden className={`size-2 rounded-full ${STATUS_DOT[data.status]}`} />
          {t(`live.${data.status}`)}
        </span>
      ) : null}
      <div className={`absolute inset-x-5 bottom-[52px] flex flex-col gap-1.5 lg:inset-x-8 lg:bottom-16 lg:gap-2 ${cover ? 'text-shadow-trip-cover' : ''}`}>
        <h2 className="text-[34px] leading-[1.15] font-bold tracking-[-0.4px] lg:text-[44px] lg:leading-[1.1] lg:tracking-[-0.5px]">{title}</h2>
        {subtitle ? <p className="text-[13px] font-medium lg:text-[15px]">{subtitle}</p> : null}
      </div>
    </div>
  )
}
