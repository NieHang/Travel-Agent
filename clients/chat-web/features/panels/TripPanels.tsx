'use client'

import { useTranslations } from 'next-intl'
import { PillTabs } from '@/components/ui/PillTabs'
import { PillButton } from '@/components/ui/PillButton'
import { toast } from '@/components/ui/toast'
import type { PanelTab } from './tabs'
import type { Command, TripView } from '@autix/contracts'
import { LiveTripPanels } from './LiveTripPanels'

export function PanelTabs({
  tab,
  onChange,
  scrollable = false,
}: {
  tab: PanelTab
  onChange: (tab: PanelTab) => void
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
export function TripPanels({
  tab,
  data,
  draft,
  busy,
  onCommand,
}: {
  tab: PanelTab
  data: TripView | null
  draft?: string
  busy?: boolean
  onCommand?: (command: Command) => void
}) {
  return <LiveTripPanels tab={tab} data={data} draft={draft} busy={busy} onCommand={onCommand} />
}
