import type { TripView } from '@autix/contracts'

/** The desktop top bar's tabs. */
export type PanelTab = 'plan' | 'hotels' | 'routes' | 'hotspots'
/** The mobile sheet also gives the checklist its own tab. */
export type SheetTab = PanelTab | 'checklist'

/** Plan, checklist and hotels are always offered on mobile; routes and hotspots once they have results. */
export function sheetTabs(data: TripView | null): SheetTab[] {
  return [
    'plan',
    'checklist',
    'hotels',
    ...(data?.routes.length ? (['routes'] as const) : []),
    ...(data?.hotspots.length ? (['hotspots'] as const) : []),
  ]
}
