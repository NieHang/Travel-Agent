export type PanelTab = 'plan' | 'hotels' | 'routes' | 'hotspots'
export type HotspotCategory = 'food' | 'views' | 'nightlife' | 'hidden'
export const STAGE_COLOR: Record<PanelTab, string> = {
  plan: 'var(--color-stage-orange)', hotels: 'var(--color-stage-purple)',
  routes: 'var(--color-stage-green)', hotspots: 'var(--color-stage-pink)',
}
export type TripMock = {
  city: string
  duration: string
  facts: [string, string, string]
  days: { title: string; stops: { icon: string; name: string; note: string; time: string }[] }[]
  hotels: { id: string; name: string; area: string; perNight: number; imageLabel: string }[]
  route: { steps: { name: string; note: string; walkMin: number; tramMin: number }[] }
  hotspots: { id: string; category: HotspotCategory; name: string; note: string; emoji: string; count: number; imageLabel: string }[]
}
