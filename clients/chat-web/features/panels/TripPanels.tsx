'use client'

import { Bookmark } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { PillTabs } from '@/components/ui/PillTabs'
import { PillButton } from '@/components/ui/PillButton'
import { toast } from '@/components/ui/toast'
import type { PanelTab } from './tabs'

const PANEL_TABS: PanelTab[] = ['plan', 'hotels', 'routes', 'hotspots']

export function PanelTabs({ tab, onChange }: { tab: PanelTab; onChange: (tab: PanelTab) => void }) {
  const t = useTranslations('panels')
  return (
    <PillTabs
      aria-label={t('live.title')}
      layoutId="panel-tabs"
      value={tab}
      onChange={onChange}
      items={PANEL_TABS.map((value) => ({ value, label: t(`tabs.${value}`) }))}
    />
  )
}

/** `block` is the mobile sheet's full-width button. */
export function SaveTripButton({ block = false }: { block?: boolean }) {
  const t = useTranslations('panels')
  return (
    <PillButton variant="trip-ink" size={block ? 'lg' : 'md'} block={block} onClick={() => toast(t('saveTripSoon'))}>
      <Bookmark size={16} aria-hidden />
      {t('saveTrip')}
    </PillButton>
  )
}
