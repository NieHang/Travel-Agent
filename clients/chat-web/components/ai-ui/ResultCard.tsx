'use client'

import { useRef, useState, type PointerEvent, type ReactNode } from 'react'
import { Tooltip } from '@heroui/react'
import { useFormatter, useTranslations } from 'next-intl'
import { ArrowUpRight, BedDouble, Building2, MapPin, Star } from 'lucide-react'
import type { LocalizedText, ResultItem } from '@autix/contracts'
import { amenityIcon } from './amenity-icon'

const FACE_AMENITIES = 3

function Banner({ item, className }: { item: ResultItem; className: string }) {
  const [failed, setFailed] = useState(false)
  const src = item.image?.startsWith('https:') && !failed ? item.image : null
  return (
    <div className={`relative overflow-hidden ${className}`}>
      {src ? (
        <img
          src={src}
          alt={item.title.original}
          loading="lazy"
          decoding="async"
          referrerPolicy="no-referrer"
          onError={() => setFailed(true)}
          className="size-full object-cover"
        />
      ) : (
        <div data-testid="image-placeholder" className="image-placeholder flex size-full items-center justify-center text-ink">
          <Building2 size={22} aria-hidden />
        </div>
      )}
    </div>
  )
}

function Text({ text, main, sub }: { text: LocalizedText; main: string; sub: string }) {
  const t = useTranslations('resultCard')
  return text.translation ? (
    <>
      <span className={main} title={t('aiTranslated')}>{text.translation}</span>
      <span className={sub}>{text.original}</span>
    </>
  ) : (
    <span className={main}>{text.original}</span>
  )
}

export function ResultCard({
  item,
  variant = 'full',
  selected = false,
}: {
  item: ResultItem
  variant?: 'full' | 'compact' | 'stay'
  selected?: boolean
}) {
  const t = useTranslations('resultCard')
  const format = useFormatter()
  const [open, setOpen] = useState(false)
  const [span, setSpan] = useState({ crossOffset: 0, width: 0 })
  const cardRef = useRef<HTMLElement>(null)
  // The list hangs off the chips but spans the whole card, so measure both as it opens. The chips
  // are found through the card: a ref on Tooltip.Trigger would replace the one React Aria needs.
  const setOpenSpanningCard = (next: boolean) => {
    const card = cardRef.current?.getBoundingClientRect()
    const chips = cardRef.current?.querySelector('[data-slot="tooltip-trigger"]')?.getBoundingClientRect()
    if (next && card && chips) setSpan({ crossOffset: card.left - chips.left, width: card.width })
    setOpen(next)
  }
  const hasAmenities = item.amenities.length > 0
  const price = item.price
    ? format.number(item.price.amount, { style: 'currency', currency: item.price.currency, maximumFractionDigits: 0 })
    : null

  // Only the amenity chips open the full list; the rest of the card stays quiet. React Aria opens
  // it on mouse hover and keyboard focus; touch has no hover, so a tap toggles it.
  const chips: ReactNode = hasAmenities ? (
    <Tooltip delay={0} closeDelay={0} isOpen={open} onOpenChange={setOpenSpanningCard} shouldCloseOnPress={false}>
      <Tooltip.Trigger
        role="group"
        aria-label={t('amenities', { count: item.amenities.length })}
        tabIndex={0}
        onPointerDown={(e: PointerEvent<HTMLDivElement>) => {
          if (e.pointerType === 'touch') setOpenSpanningCard(!open)
        }}
        className="flex w-fit flex-wrap gap-1.5 rounded-[14px] outline-none focus-visible:ring-2 focus-visible:ring-ink"
      >
        {item.amenities.slice(0, FACE_AMENITIES).map((a) => {
          const Icon = amenityIcon(a.original)
          return (
            <span key={a.original} className="inline-flex items-center gap-1 rounded-full bg-ink/5 px-2.5 py-1 text-xs font-bold text-ink">
              <Icon size={13} aria-hidden />
              {a.translation ?? a.original}
            </span>
          )
        })}
        {item.amenities.length > FACE_AMENITIES ? (
          <span className="rounded-full bg-lime px-2.5 py-1 text-xs font-bold text-ink">
            {t('more', { count: item.amenities.length - FACE_AMENITIES })}
          </span>
        ) : null}
      </Tooltip.Trigger>
      <Tooltip.Content
        placement="top start"
        offset={8}
        crossOffset={span.crossOffset}
        style={{ width: span.width }}
        data-on-ink
        className="max-w-none break-normal rounded-[16px] bg-ink p-3 text-white shadow-float"
      >
        <p className="mb-1 text-xs font-bold text-lime">{t('amenities', { count: item.amenities.length })}</p>
        <ul className="grid gap-1">
          {item.amenities.map((a) => {
            const Icon = amenityIcon(a.original)
            return (
              <li key={a.original} className="grid grid-cols-[20px_1fr] gap-x-2 text-sm font-bold">
                <Icon size={16} className="mt-0.5 text-lime" aria-hidden />
                <span>{a.translation ?? a.original}</span>
                {a.translation ? <span className="col-start-2 text-xs font-medium text-white/60">{a.original}</span> : null}
              </li>
            )
          })}
        </ul>
      </Tooltip.Content>
    </Tooltip>
  ) : null

  const title = <Text text={item.title} main="block font-extrabold leading-tight" sub="block text-xs font-medium text-ink/60" />

  if (variant === 'stay')
    return (
      <article className="relative flex items-center gap-3 rounded-[16px] bg-white/10 p-2 text-white outline-none">
        <Banner item={item} className="h-[42px] w-14 shrink-0 rounded-[10px]" />
        <div className="min-w-0">
          <p className="text-xs font-bold text-lime"><BedDouble size={13} className="mr-1 inline" aria-hidden />{t('tonight')}</p>
          <p className="truncate text-sm font-extrabold">{item.title.translation ?? item.title.original}{price ? ` · ${price}` : ''}</p>
        </div>
      </article>
    )

  if (variant === 'compact')
    return (
      <article
        ref={cardRef}
        className={`relative grid grid-cols-[96px_minmax(0,1fr)] items-center gap-3 rounded-card border-2 bg-paper p-3 text-ink outline-none ${selected ? 'border-lime' : 'border-transparent'}`}
      >
        <Banner item={item} className="aspect-[4/3] rounded-[12px]" />
        <div className="min-w-0 text-sm">
          {title}
          {chips ? <div className="mt-2">{chips}</div> : null}
        </div>
      </article>
    )

  return (
    <article ref={cardRef} className="relative rounded-card bg-paper p-3 text-ink outline-none">
      <div className="relative">
        <Banner item={item} className="aspect-video rounded-[14px]" />
        {item.rating !== null ? (
          <span className="absolute left-2 top-2 inline-flex items-center gap-1 rounded-full bg-lime px-2.5 py-1 text-xs font-bold">
            <Star size={12} aria-hidden />{item.rating}
          </span>
        ) : null}
      </div>
      <div className="mt-2.5 text-[17px]">{title}</div>
      {item.address ? (
        <p className="mt-1.5 text-xs font-medium">
          <MapPin size={12} className="mr-1 inline" aria-hidden />
          <Text text={item.address} main="" sub="ml-1 text-ink/60" />
        </p>
      ) : null}
      {item.summary ? <p className="mt-1.5 text-xs" title={t('aiNote')}>{item.summary}</p> : null}
      {chips ? <div className="my-2.5">{chips}</div> : null}
      <div className="mt-2 flex items-center justify-between gap-2">
        {price ? (
          <p><span className="text-2xl font-extrabold">{price}</span><span className="text-xs font-bold"> {t('fromPerNight')}</span></p>
        ) : <span />}
        {item.url ? (
          <a href={item.url} target="_blank" rel="noreferrer noopener" className="inline-flex min-h-11 items-center gap-1 rounded-full bg-lime px-4 text-sm font-extrabold text-ink">
            {t('book')}<ArrowUpRight size={14} aria-hidden />
          </a>
        ) : null}
      </div>
    </article>
  )
}
