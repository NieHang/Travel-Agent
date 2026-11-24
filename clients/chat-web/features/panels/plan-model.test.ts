import type { ResultItem, TripView } from '@autix/contracts'
import { makeTripView } from '@/test/fixtures'
import { coverFacts, dayDates, dayMap, stayRun, timeMark } from './plan-model'
import { sheetTabs } from './tabs'

type Day = TripView['days'][number]
type Stop = Day['stops'][number]

const stop = (name: string, image: string | null = null): Stop => ({ name, note: null, time: null, hours: null, transit: null, image })
const day = (heading = '京都站周边'): Day => ({ title: `第 1 天 | ${heading}`, heading, pace: null, stops: [], stay: null })
const hotel = (ref: string): ResultItem => ({
  ref, id: null, title: { original: ref, translation: null }, address: null, price: null, rating: null,
  url: null, image: null, details: [], amenities: [], summary: null,
})
const utc = (iso: string) => new Date(`${iso}T00:00:00Z`)

const kyoto = makeTripView({
  destination: '京都',
  departureDate: '2026-11-22',
  returnDate: '2026-11-26',
  travelers: 1,
  days: [day(), day(), day(), day(), day()],
  stayPlan: [{ nights: { from: 0, to: 3 }, stay: hotel('h1'), options: [hotel('h1')] }],
})

describe('dayDates', () => {
  it('counts calendar days from the departure date across a month end', () => {
    const view = makeTripView({ departureDate: '2026-11-29', days: [day(), day(), day()] })
    expect(dayDates(view)).toEqual([utc('2026-11-29'), utc('2026-11-30'), utc('2026-12-01')])
  })

  it('has no dates while the trip has no departure date', () => {
    expect(dayDates(makeTripView({ departureDate: null, days: [day(), day()] }))).toEqual([null, null])
  })
})

describe('coverFacts', () => {
  it('gives the date range, travelers and nights, with one hotel for the whole trip', () => {
    expect(coverFacts(kyoto)).toEqual({
      dates: { start: utc('2026-11-22'), end: utc('2026-11-26'), sameMonth: true },
      travelers: 1,
      nights: { count: 4, oneStay: true },
    })
  })

  it('is not one stay when the hotel changes or none is chosen yet', () => {
    const changing = { ...kyoto, stayPlan: [
      { nights: { from: 0, to: 1 }, stay: hotel('h1'), options: [] },
      { nights: { from: 2, to: 3 }, stay: hotel('h2'), options: [] },
    ] }
    const unchosen = { ...kyoto, stayPlan: [{ nights: { from: 0, to: 3 }, stay: null, options: [] }] }
    expect(coverFacts(changing).nights).toEqual({ count: 4, oneStay: false })
    expect(coverFacts(unchosen).nights).toEqual({ count: 4, oneStay: false })
  })

  it('marks a range that crosses into the next month', () => {
    expect(coverFacts(makeTripView({ departureDate: '2026-11-29', returnDate: '2026-12-02' })).dates).toEqual({
      start: utc('2026-11-29'), end: utc('2026-12-02'), sameMonth: false,
    })
  })

  it('has no dates or nights without both dates', () => {
    expect(coverFacts(makeTripView({ returnDate: null, travelers: null }))).toEqual({ dates: null, travelers: null, nights: null })
  })
})

describe('timeMark', () => {
  it.each([
    ['16:30', { kind: 'clock', text: '16:30', period: 'afternoon' }],
    ['7:30', { kind: 'clock', text: '07:30', period: 'early' }],
    ['10：30', { kind: 'clock', text: '10:30', period: 'morning' }],
    ['12:00', { kind: 'clock', text: '12:00', period: 'noon' }],
    ['18:00', { kind: 'clock', text: '18:00', period: 'evening' }],
    ['21:15', { kind: 'clock', text: '21:15', period: 'night' }],
    ['02:00', { kind: 'clock', text: '02:00', period: 'lateNight' }],
    ['下午', { kind: 'text', text: '下午' }],
    ['25:00', { kind: 'text', text: '25:00' }],
    ['09:00–11:00', { kind: 'text', text: '09:00–11:00' }],
  ])('%s', (time, mark) => {
    expect(timeMark(time, 0)).toEqual(mark)
  })

  it('shows the stop number when the time is missing or blank', () => {
    expect(timeMark(null, 2)).toEqual({ kind: 'ordinal', n: 3 })
    expect(timeMark('  ', 0)).toEqual({ kind: 'ordinal', n: 1 })
  })
})

describe('stayRun', () => {
  const twoHotels = makeTripView({
    departureDate: '2026-11-22',
    stayPlan: [
      { nights: { from: 0, to: 1 }, stay: hotel('h1'), options: [] },
      { nights: { from: 2, to: 3 }, stay: hotel('h2'), options: [] },
    ],
  })

  it('checks in on the run’s first night and out the morning after its last', () => {
    expect(stayRun(twoHotels, 2)).toEqual({
      nights: { from: 2, to: 3 }, checkIn: utc('2026-11-24'), checkOut: utc('2026-11-26'), wholeTrip: false,
    })
    expect(stayRun(kyoto, 1)).toMatchObject({ checkIn: utc('2026-11-22'), checkOut: utc('2026-11-26'), wholeTrip: true })
  })

  it('has no run on the departure day, which has no night', () => {
    expect(stayRun(twoHotels, 4)).toBeNull()
  })
})

describe('dayMap', () => {
  const stops = [stop('京都站'), stop('东本愿寺', '/places/kyoto/higashi-hongan-ji.webp'), stop('晚饭'), stop('第四站')]

  it('pins every stop top to bottom on alternating columns and draws a route through them', () => {
    expect(dayMap(stops, 0)).toEqual({
      pins: [
        { name: '京都站', image: null, x: 28, y: 0 },
        { name: '东本愿寺', image: '/places/kyoto/higashi-hongan-ji.webp', x: 72, y: 33.3 },
        { name: '晚饭', image: null, x: 28, y: 66.7 },
        { name: '第四站', image: null, x: 72, y: 100 },
      ],
      route: 'M28 0 Q40 30 72 33.3 Q60 63 28 66.7 Q40 97 72 100',
    })
  })

  it('starts the next day on the other column', () => {
    expect(dayMap(stops, 1).pins.map((pin) => pin.x)).toEqual([72, 28, 72, 28])
    expect(dayMap(stops, 2)).toEqual(dayMap(stops, 0))
  })

  it('has no route with fewer than two stops', () => {
    expect(dayMap([stop('伏见稻荷')], 0)).toEqual({ pins: [{ name: '伏见稻荷', image: null, x: 28, y: 50 }], route: null })
    expect(dayMap([], 0)).toEqual({ pins: [], route: null })
  })
})

describe('sheetTabs', () => {
  it('always offers plan, checklist and hotels; routes and hotspots once they have results', () => {
    expect(sheetTabs(null)).toEqual(['plan', 'checklist', 'hotels'])
    expect(sheetTabs(makeTripView({ hotspots: [hotel('s1')] }))).toEqual(['plan', 'checklist', 'hotels', 'hotspots'])
    expect(sheetTabs(makeTripView({ routes: [hotel('r1')], hotspots: [hotel('s1')] }))).toEqual([
      'plan', 'checklist', 'hotels', 'routes', 'hotspots',
    ])
  })
})
