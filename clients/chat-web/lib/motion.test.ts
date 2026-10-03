import { springs, enter, staggerDelay } from './motion'

it('四个预设的参数与 spec 8.4 一致', () => {
  expect(springs.snappy).toMatchObject({ stiffness: 500, damping: 30 })
  expect(springs.smooth).toMatchObject({ stiffness: 380, damping: 32 })
  expect(springs.drawer).toMatchObject({ stiffness: 300, damping: 34 })
  expect(springs.gentle).toMatchObject({ stiffness: 120, damping: 18 })
})
it('错开 40ms，最多 8 项', () => {
  expect(staggerDelay(3)).toBeCloseTo(0.12)
  expect(staggerDelay(20)).toBeCloseTo(0.32)
})
it('入场上移 12px 并淡入', () => {
  expect(enter().initial).toEqual({ opacity: 0, y: 12 })
  expect(enter().animate).toEqual({ opacity: 1, y: 0 })
})
it('减少动态效果时没有位移', () => {
  expect(enter(0, true).initial).toEqual({ opacity: 0 })
  expect(enter(0, true).animate).toEqual({ opacity: 1 })
})
