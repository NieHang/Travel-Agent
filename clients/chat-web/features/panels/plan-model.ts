import type { NightRange, TripView } from '@autix/contracts'

type Stop = TripView['days'][number]['stops'][number]

const DAY_MS = 86_400_000

/**
 * Trip dates are calendar days kept at UTC midnight. Format them with `timeZone: 'UTC'`,
 * or a viewer west of UTC sees the day before.
 */
function tripDate(isoDate: string, offset = 0): Date {
  const [year, month, day] = isoDate.split('-').map(Number)
  return new Date(Date.UTC(year, month - 1, day + offset))
}

/** Each day's calendar date; null while the trip has no departure date. */
export function dayDates(view: TripView): (Date | null)[] {
  const { departureDate } = view
  return view.days.map((_, i) => (departureDate ? tripDate(departureDate, i) : null))
}

export type CoverFacts = {
  dates: { start: Date; end: Date; sameMonth: boolean } | null
  travelers: number | null
  /** `oneStay` when a single hotel covers every night. */
  nights: { count: number; oneStay: boolean } | null
}

export function coverFacts(view: TripView): CoverFacts {
  if (!view.departureDate || !view.returnDate) return { dates: null, travelers: view.travelers, nights: null }
  const start = tripDate(view.departureDate)
  const end = tripDate(view.returnDate)
  const count = Math.round((end.getTime() - start.getTime()) / DAY_MS)
  return {
    dates: {
      start,
      end,
      sameMonth: start.getUTCFullYear() === end.getUTCFullYear() && start.getUTCMonth() === end.getUTCMonth(),
    },
    travelers: view.travelers,
    nights: count > 0 ? { count, oneStay: view.stayPlan.length === 1 && view.stayPlan[0].stay !== null } : null,
  }
}

type Period = 'lateNight' | 'early' | 'morning' | 'noon' | 'afternoon' | 'evening' | 'night'

/** What a stop's time circle shows: a clock time under its part of the day, free text, or the stop's number. */
export type TimeMark =
  | { kind: 'clock'; text: string; period: Period }
  | { kind: 'text'; text: string }
  | { kind: 'ordinal'; n: number }

// 24-hour H:MM as the backend writes it, also with the full-width colon of Chinese text.
const CLOCK = /^([01]?\d|2[0-3])[:：]([0-5]\d)$/

/** The hour each part of the day starts, latest first. */
const PERIODS: [fromHour: number, period: Period][] = [
  [20, 'night'],
  [18, 'evening'],
  [14, 'afternoon'],
  [12, 'noon'],
  [8, 'morning'],
  [5, 'early'],
  [0, 'lateNight'],
]

export function timeMark(time: string | null, index: number): TimeMark {
  const text = time?.trim()
  if (!text) return { kind: 'ordinal', n: index + 1 }
  const clock = CLOCK.exec(text)
  if (!clock) return { kind: 'text', text }
  const hour = Number(clock[1])
  const period = PERIODS.find(([from]) => hour >= from)?.[1] ?? 'lateNight'
  return { kind: 'clock', text: `${clock[1].padStart(2, '0')}:${clock[2]}`, period }
}

export type StayRun = {
  nights: NightRange
  checkIn: Date | null
  checkOut: Date | null
  /** The only run, so the trip never changes hotel. */
  wholeTrip: boolean
}

/** The run of nights on one hotel that includes the night after day `dayIndex`. */
export function stayRun(view: TripView, dayIndex: number): StayRun | null {
  const run = view.stayPlan.find(({ nights }) => nights.from <= dayIndex && dayIndex <= nights.to)
  if (!run) return null
  const { departureDate } = view
  return {
    nights: run.nights,
    checkIn: departureDate ? tripDate(departureDate, run.nights.from) : null,
    checkOut: departureDate ? tripDate(departureDate, run.nights.to + 1) : null,
    wholeTrip: view.stayPlan.length === 1,
  }
}

/** Stops cycle through three hues; a stop's time circle and its map label share one. */
const STOP_HUES = [
  { tint: 'bg-tint-violet', tone: 'text-tone-violet', solid: 'bg-tone-violet' },
  { tint: 'bg-tint-apricot', tone: 'text-tone-apricot', solid: 'bg-tone-apricot' },
  { tint: 'bg-tint-sky', tone: 'text-tone-sky', solid: 'bg-tone-sky' },
] as const

export function stopHue(index: number) {
  return STOP_HUES[index % STOP_HUES.length]
}

/** A stop on the decorative map, in percent of its width and height. */
export type MapPin = { name: string; image: string | null; x: number; y: number }

/** Stops alternate between these two columns, so neighbours never sit on top of each other. */
const PIN_COLUMNS = [28, 72]

/**
 * A pin for every stop, the first at the top and the last at the bottom in the timeline's order,
 * and a curved route through them in a 100-unit viewBox. Each day starts on the other column so neighbouring days differ.
 */
export function dayMap(stops: Stop[], dayIndex: number): { pins: MapPin[]; route: string | null } {
  const pins = stops.map((stop, i) => ({
    name: stop.name,
    image: stop.image,
    x: PIN_COLUMNS[(i + dayIndex) % 2],
    y: stops.length === 1 ? 50 : Math.round((i * 1000) / (stops.length - 1)) / 10,
  }))
  if (pins.length < 2) return { pins, route: null }
  const route = pins.slice(1).reduce((path, { x, y }, i) => {
    const prev = pins[i]
    const bend = i % 2 === 0 ? 0.3 : -0.3
    const cx = Math.round((prev.x + x) / 2 - (y - prev.y) * bend)
    const cy = Math.round((prev.y + y) / 2 + (x - prev.x) * bend)
    return `${path} Q${cx} ${cy} ${x} ${y}`
  }, `M${pins[0].x} ${pins[0].y}`)
  return { pins, route }
}
