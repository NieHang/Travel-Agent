export const springs = {
  snappy: { type: 'spring', stiffness: 500, damping: 30 },
  smooth: { type: 'spring', stiffness: 380, damping: 32 },
  drawer: { type: 'spring', stiffness: 300, damping: 34 },
  gentle: { type: 'spring', stiffness: 120, damping: 18 },
} as const

export const STAGGER_MS = 40
export const STAGGER_MAX = 8
export const BG_TRANSITION = 'background-color 450ms ease-out'

/** 错开延迟，单位秒：min(index, STAGGER_MAX) * 0.04 */
export function staggerDelay(index: number): number {
  return (Math.min(index, STAGGER_MAX) * STAGGER_MS) / 1000
}

/** 入场：上移 12px + 淡入；reduced 为 true 时只淡入。index 用于错开。 */
export function enter(
  index = 0,
  reduced = false,
) {
  return {
    initial: reduced ? { opacity: 0 } : { opacity: 0, y: 12 },
    animate: reduced ? { opacity: 1 } : { opacity: 1, y: 0 },
    transition: { ...springs.gentle, delay: staggerDelay(index) },
  }
}
