'use client'
import { useState } from 'react'
import type { ResultItem, TripView } from '@autix/contracts'
import { useFormatter, useTranslations } from 'next-intl'
import { ResultCard } from '@/components/ai-ui/ResultCard'
import { Markdown } from '@/components/ui/Markdown'
import type { PanelTab } from './mock/types'

function ResultList({ items }: { items: ResultItem[] }) {
  const t = useTranslations('panels')
  const format = useFormatter()
  const [index, setIndex] = useState(0)
  const selected = items[Math.min(index, items.length - 1)]
  return (
    <div className="flex flex-col gap-3">
      <div role="radiogroup" aria-label={t('tabs.hotels')} className="grid gap-3">
        {items.map((item, i) => (
          <div key={item.ref} role="radio" aria-checked={i === index} tabIndex={-1} onClick={() => setIndex(i)} className="cursor-pointer">
            <ResultCard item={item} variant="compact" selected={i === index} />
          </div>
        ))}
      </div>
      {selected?.price ? (
        <p className="text-4xl font-extrabold text-white">
          {format.number(selected.price.amount, { style: 'currency', currency: selected.price.currency, maximumFractionDigits: 0 })}
          <span className="ml-2 text-sm">{t('perNight')}</span>
        </p>
      ) : null}
      {selected?.url ? (
        <a href={selected.url} target="_blank" rel="noreferrer noopener" className="inline-flex min-h-12 w-fit items-center rounded-full bg-lime px-6 font-extrabold text-ink">
          {t('book', { hotel: selected.title.translation ?? selected.title.original })}
        </a>
      ) : null}
    </div>
  )
}

export function LiveTripPanels({ tab, data }: { tab: PanelTab; data: TripView | null }) {
  const t = useTranslations('panels.live')
  if (!data)
    return (
      <div data-on-ink data-testid="live-trip-panel" className="flex flex-col gap-5 p-5 text-white sm:p-8">
        <p className="text-sm font-bold">{t('title')}</p>
        <p>{t('empty')}</p>
      </div>
    )
  const items = tab === 'hotels' ? data.hotels : tab === 'routes' ? data.routes : data.hotspots
  return (
    <div data-on-ink data-testid="live-trip-panel" className="flex flex-col gap-5 p-5 text-white sm:p-8">
      <p className="text-sm font-bold">{t('title')}</p>
      <h2 className="text-4xl font-extrabold">{data.destination ?? t('untitled')}</h2>
      <span className="w-fit rounded-full bg-lime px-3 py-1 text-xs font-bold text-ink">{t(data.status)}</span>
      <div className="flex flex-wrap gap-2 text-sm">
        {data.departureDate ? <span>{data.departureDate} — {data.returnDate ?? '…'}</span> : null}
        {data.travelers !== null ? <span>{t('travelers', { count: data.travelers })}</span> : null}
        {data.budget !== null ? <span>{t('budget', { amount: data.budget, currency: data.budgetCurrency ?? '' })}</span> : null}
      </div>
      {tab === 'plan' ? (
        data.days.length ? (
          <ol className="flex flex-col gap-4">
            {data.days.map((day, i) => (
              <li key={i} className="flex flex-col gap-2">
                <h3 className="text-xl font-extrabold">{day.title}</h3>
                <ul className="flex flex-col gap-1 text-sm">
                  {day.stops.map((stop, j) => (
                    <li key={j}>{stop.time ? `${stop.time} · ` : ''}{stop.name}{stop.note ? ` — ${stop.note}` : ''}</li>
                  ))}
                </ul>
                {day.stay ? <ResultCard item={day.stay} variant="stay" /> : null}
              </li>
            ))}
          </ol>
        ) : data.itineraryMarkdown ? (
          <div className="rounded-card bg-paper p-5 text-ink"><Markdown content={data.itineraryMarkdown} /></div>
        ) : (
          <p>{t('waiting')}</p>
        )
      ) : items.length ? (
        <ResultList items={items} />
      ) : (
        <p>{t('noResults')}</p>
      )}
    </div>
  )
}
