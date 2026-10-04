'use client'

import { useReducedMotion } from '@/lib/use-reduced-motion'
import { motion } from 'motion/react'
import { useTranslations } from 'next-intl'
import { PillTabs } from '@/components/ui/PillTabs'
import { PillButton } from '@/components/ui/PillButton'
import { toast } from '@/components/ui/toast'
import { enter } from '@/lib/motion'
import { PlanPanel } from './PlanPanel'
import { HotelsPanel } from './HotelsPanel'
import { RoutesPanel } from './RoutesPanel'
import { HotspotsPanel } from './HotspotsPanel'
import type { PanelTab, TripMock } from './mock/types'
import type { TripSnapshot } from '@autix/contracts'
import { LiveTripPanels } from './LiveTripPanels'

export function PanelTabs({
  tab,
  onChange,
  scrollable = false,
}: {
  tab: PanelTab
  onChange(tab: PanelTab): void
  scrollable?: boolean
}) {
  const t = useTranslations('panels')
  return (
    <PillTabs
      aria-label={t('tabs.plan')}
      layoutId="panel-tabs"
      onInk
      scrollable={scrollable}
      value={tab}
      onChange={onChange}
      items={(['plan', 'hotels', 'routes', 'hotspots'] as const).map(
        (value) => ({ value, label: t(`tabs.${value}`) }),
      )}
    />
  )
}
export function SaveTripButton() {
  const t = useTranslations('panels')
  return (
    <PillButton
      variant="pink"
      size="sm"
      onClick={() => toast(t('saveTripSoon'))}
    >
      {t('saveTrip')}
    </PillButton>
  )
}
const PANELS = {
  plan: PlanPanel,
  hotels: HotelsPanel,
  routes: RoutesPanel,
  hotspots: HotspotsPanel,
}
export function TripPanels({
  tab,
  data,
}: {
  tab: PanelTab
  data: TripMock | TripSnapshot | null
}) {
  if (data === null || 'revision' in data)
    return <LiveTripPanels tab={tab} data={data} />
  return <SampleTripPanels tab={tab} data={data} />
}
function SampleTripPanels({ tab, data }: { tab: PanelTab; data: TripMock }) {
  const t = useTranslations('panels'),
    tc = useTranslations('common'),
    reduced = useReducedMotion()
  const Panel = PANELS[tab]
  return (
    <div data-on-ink className="flex flex-col gap-6 p-5 sm:p-8">
      <div className="flex flex-col gap-3 text-white">
        <p className="text-sm font-bold">{t(`kicker.${tab}`)}</p>
        <h2 className="text-[56px] leading-none font-extrabold">
          {data.city} <span className="text-2xl">/ {data.duration}</span>
        </h2>
        <span className="w-fit rounded-full bg-lime px-3 py-1 text-xs font-bold text-ink">
          {tc('sample')}
        </span>
        <div className="flex flex-wrap gap-2">
          {data.facts.map((fact) => (
            <span
              key={fact}
              className="rounded-full border border-white/40 px-3 py-1 text-sm"
            >
              {fact}
            </span>
          ))}
        </div>
      </div>
      <motion.div key={tab} {...enter(0, Boolean(reduced))}>
        <Panel data={data} />
      </motion.div>
    </div>
  )
}
