'use client'
import type { TripSnapshot } from '@autix/contracts'
import { useTranslations } from 'next-intl'
import { ComponentRenderer } from '@/components/ai-ui/ComponentRenderer'
import { Markdown } from '@/components/ui/Markdown'
import type { PanelTab } from './mock/types'
const noop = () => {}
export function LiveTripPanels({
  tab,
  data,
}: {
  tab: PanelTab
  data: TripSnapshot | null
}) {
  const t = useTranslations('panels.live')
  const components = data
    ? tab === 'hotels'
      ? data.hotels
      : tab === 'routes'
        ? data.routes
        : data.hotspots
    : []
  return (
    <div
      data-on-ink
      data-testid="live-trip-panel"
      className="flex flex-col gap-5 p-5 text-white sm:p-8"
    >
      <p className="text-sm font-bold">{t('title')}</p>
      {data ? (
        <>
          <h2 className="text-4xl font-extrabold">
            {data.destination ?? t('untitled')}
          </h2>
          <span className="w-fit rounded-full bg-lime px-3 py-1 text-xs font-bold text-ink">
            {t(data.status)}
          </span>
          <div className="flex flex-wrap gap-2 text-sm">
            {data.departureDate && (
              <span>
                {data.departureDate} — {data.returnDate ?? '…'}
              </span>
            )}
            {data.travelers !== null && (
              <span>{t('travelers', { count: data.travelers })}</span>
            )}
            {data.budget !== null && (
              <span>
                {t('budget', {
                  amount: data.budget,
                  currency: data.budgetCurrency ?? '',
                })}
              </span>
            )}
          </div>
          {tab === 'plan' ? (
            data.itineraryMarkdown ? (
              <div className="rounded-card bg-paper p-5 text-ink">
                <Markdown content={data.itineraryMarkdown} />
              </div>
            ) : (
              <p>{t('waiting')}</p>
            )
          ) : components.length ? (
            <div className="space-y-4 rounded-card bg-paper p-4 text-ink">
              {components.map((c) => (
                <ComponentRenderer
                  key={c.id}
                  component={c}
                  disabled
                  onAction={noop}
                />
              ))}
            </div>
          ) : (
            <p>{t('noResults')}</p>
          )}
        </>
      ) : (
        <p>{t('empty')}</p>
      )}
    </div>
  )
}
