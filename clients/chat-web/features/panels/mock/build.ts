import type { HotspotCategory, TripMock } from './types'

export function buildMock(text: {
  city: string; duration: string; facts: [string, string, string]; days: string[]
  places: string[]; hotels: string[]; areas: string[]; explore: string; room: string
}): TripMock {
  const categories: HotspotCategory[] = ['food', 'views', 'nightlife', 'hidden']
  return {
    city: text.city, duration: text.duration, facts: text.facts,
    days: text.days.map((title, day) => ({ title, stops: [0, 1, 2].map((i) => ({
      icon: ['☕', '🏛️', '🌅'][i], name: text.places[(day * 3 + i) % text.places.length],
      note: text.explore, time: ['09:00', '12:00', '16:00'][i],
    })) })),
    hotels: text.hotels.map((name, i) => ({ id: `hotel-${i}`, name, area: text.areas[i],
      perNight: [120, 145, 89][i], imageLabel: `${name} · ${text.room}` })),
    route: { steps: text.places.slice(0, 6).map((name) => ({ name, note: text.explore, walkMin: 10, tramMin: 5 })) },
    hotspots: text.places.slice(0, 8).map((name, i) => ({ id: `spot-${i}`, category: categories[i % 4],
      name, note: text.explore, emoji: ['🍴', '📸', '🍸', '✨'][i % 4], count: 24 + i * 7, imageLabel: name })),
  }
}
