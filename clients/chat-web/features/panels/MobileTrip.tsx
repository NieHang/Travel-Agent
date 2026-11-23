'use client'

import { BedDouble, Flame, MapIcon, Route, SquareCheckBig, type LucideIcon } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { useState } from 'react'
import { PillTabs } from '@/components/ui/PillTabs'
import { LiveTripPanels, type LiveTripPanelsProps } from './LiveTripPanels'
import { sheetTabs, type SheetTab } from './tabs'
import { SaveTripButton } from './TripPanels'

const TAB_ICONS: Record<SheetTab, LucideIcon> = {
  plan: MapIcon,
  checklist: SquareCheckBig,
  hotels: BedDouble,
  routes: Route,
  hotspots: Flame,
}

/** The mobile sheet's trip: tile tabs under the cover and the save button at the end. */
export function MobileTrip(props: Omit<LiveTripPanelsProps, 'tab' | 'tabs' | 'footer' | 'onOpenChecklist'>) {
  const t = useTranslations('panels')
  const [tab, setTab] = useState<SheetTab>('plan')
  return (
    <LiveTripPanels
      {...props}
      tab={tab}
      onOpenChecklist={() => setTab('checklist')}
      tabs={
        <PillTabs
          variant="tile"
          aria-label={t('live.title')}
          layoutId="sheet-tabs"
          value={tab}
          onChange={setTab}
          items={sheetTabs(props.data).map((value) => ({ value, label: t(`tabs.${value}`), icon: TAB_ICONS[value] }))}
        />
      }
      footer={<SaveTripButton block />}
    />
  )
}
