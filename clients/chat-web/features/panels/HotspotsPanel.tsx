'use client'

import { useReducedMotion } from '@/lib/use-reduced-motion'
import { AnimatePresence, motion } from 'motion/react'
import { useTranslations, useFormatter } from 'next-intl'
import { useState } from 'react'
import { PillTabs } from '@/components/ui/PillTabs'
import { PillButton } from '@/components/ui/PillButton'
import { springs, enter } from '@/lib/motion'
import type { HotspotCategory, TripMock } from './mock/types'

export function HotspotsPanel({ data }: { data: TripMock }) {
  const t = useTranslations('panels'), format = useFormatter(), reduced = useReducedMotion()
  const [filter, setFilter] = useState<HotspotCategory | 'all'>('all')
  const [added, setAdded] = useState(new Set<string>())
  const spots = data.hotspots.filter((spot) => filter === 'all' || spot.category === filter)
  return <div className="flex flex-col gap-4">
    <PillTabs<HotspotCategory | 'all'> aria-label={t('tabs.hotspots')} layoutId="hotspot-filter" onInk scrollable value={filter} onChange={setFilter}
      items={(['all', 'food', 'views', 'nightlife', 'hidden'] as const).map((value) => ({ value, label: t(`filters.${value}`) }))} />
    {spots.length === 0 ? <p className="text-white">{t('emptyFilter')}</p> : null}
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4"><AnimatePresence>
      {spots.map((spot, i) => <motion.div key={spot.id} layout={!reduced} {...enter(i, Boolean(reduced))}
        exit={reduced ? { opacity: 0 } : { opacity: 0, scale: 0.9 }} transition={springs.smooth}
        className="flex min-w-0 flex-col gap-3 rounded-card bg-paper p-3 text-ink">
        <div className="image-placeholder rounded-card p-4 text-sm">{spot.imageLabel}</div>
        <p className="font-bold">{spot.name}</p><p className="text-sm">{spot.note}</p>
        <span>{spot.emoji} {format.number(spot.count)}</span>
        <PillButton variant={added.has(spot.id) ? 'lime' : 'ghost'} size="sm" onClick={() => setAdded((current) => {
          const next = new Set(current); if (next.has(spot.id)) next.delete(spot.id); else next.add(spot.id); return next
        })}>{added.has(spot.id) ? t('added') : t('add')}</PillButton>
      </motion.div>)}
    </AnimatePresence></div>
  </div>
}
