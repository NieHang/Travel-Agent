export type PanelTab = 'plan' | 'hotels' | 'routes' | 'hotspots'
export const STAGE_COLOR: Record<PanelTab, string> = {
  plan: 'var(--color-stage-orange)', hotels: 'var(--color-stage-purple)',
  routes: 'var(--color-stage-green)', hotspots: 'var(--color-stage-pink)',
}
