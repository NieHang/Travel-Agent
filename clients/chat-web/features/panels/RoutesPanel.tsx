'use client'
import { useState } from 'react'
import { useFormatter, useTranslations } from 'next-intl'
import { PillTabs } from '@/components/ui/PillTabs'
import { InfoCard } from '@/components/ui/InfoCard'
import type { TripMock } from './mock/types'

export function RoutesPanel({ data }: { data: TripMock }) {
  const t = useTranslations('panels'), format = useFormatter()
  const [mode, setMode] = useState('walk')
  const minutes = (step: TripMock['route']['steps'][number]) => mode === 'walk' ? step.walkMin : step.tramMin
  const duration = (n: number) => format.number(n, { style: 'unit', unit: 'minute', unitDisplay: 'short' })
  return <div className="flex flex-col gap-4">
    <div role="img" aria-label={t('mapAlt')} className="image-placeholder flex h-40 items-center justify-around rounded-card p-4 text-ink">
      {data.route.steps.map((_, i) => <span key={i} aria-hidden className="flex size-8 items-center justify-center rounded-full bg-lime font-bold">{i + 1}</span>)}
    </div>
    <PillTabs aria-label={t('tabs.routes')} layoutId="route-mode" onInk value={mode} onChange={setMode}
      items={[{ value: 'walk', label: t('walk') }, { value: 'tram', label: t('tram') }]} />
    <p className="text-4xl font-extrabold text-white">{duration(data.route.steps.reduce((n, step) => n + minutes(step), 0))}</p>
    {data.route.steps.map((step, i) => <InfoCard key={step.name} icon={i + 1} title={step.name} subtitle={step.note} time={duration(minutes(step))} />)}
  </div>
}
