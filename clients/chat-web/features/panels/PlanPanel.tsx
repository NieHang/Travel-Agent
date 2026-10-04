'use client'

import { useReducedMotion } from '@/lib/use-reduced-motion'
import { motion } from 'motion/react'
import { useTranslations } from 'next-intl'
import { useState } from 'react'
import { PillTabs } from '@/components/ui/PillTabs'
import { InfoCard } from '@/components/ui/InfoCard'
import { enter } from '@/lib/motion'
import type { TripMock } from './mock/types'

export function PlanPanel({ data }: { data: TripMock }) {
  const t = useTranslations('panels')
  const [day, setDay] = useState('0')
  const reduced = useReducedMotion()
  const selected = data.days[Number(day)]
  return <div className="flex flex-col gap-4">
    <PillTabs aria-label={t('tabs.plan')} layoutId="plan-day" onInk scrollable value={day} onChange={setDay}
      items={data.days.map((_, i) => ({ value: String(i), label: t('day', { n: i + 1 }) }))} />
    <h3 className="text-2xl font-extrabold text-white">{selected.title}</h3>
    <p className="text-sm text-white">{t('stops', { count: selected.stops.length })}</p>
    <div key={day} className="flex flex-col gap-3">{selected.stops.map((stop, i) =>
      <motion.div key={stop.name} {...enter(i, Boolean(reduced))}><InfoCard icon={stop.icon} title={stop.name} subtitle={stop.note} time={stop.time} /></motion.div>)}</div>
  </div>
}
