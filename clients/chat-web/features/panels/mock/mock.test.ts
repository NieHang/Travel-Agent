import { getTripMock } from './index'
it('两种语言的天数、酒店价格、路线用时、热点分类完全一致', () => {
  const zh = getTripMock('zh'), en = getTripMock('en')
  const shape = (m: typeof zh) => ({
    days: m.days.map((d) => d.stops.length), hotels: m.hotels.map((h) => [h.id, h.perNight]),
    steps: m.route.steps.map((s) => [s.walkMin, s.tramMin]), spots: m.hotspots.map((s) => [s.id, s.category, s.count]),
  })
  expect(shape(zh)).toEqual(shape(en))
  expect(zh.days).toHaveLength(5)
  expect(zh.days.every((d) => d.stops.length >= 3 && d.stops.length <= 5)).toBe(true)
  expect(zh.hotels).toHaveLength(3)
  expect(zh.route.steps).toHaveLength(6)
  expect(zh.hotspots).toHaveLength(8)
  expect(new Set(zh.hotspots.map((s) => s.category)).size).toBe(4)
})
