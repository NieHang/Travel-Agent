import {
  AirVent, Bath, Check, Coffee, CookingPot, Dumbbell, SquareParking, Waves, Wifi, type LucideIcon,
} from 'lucide-react'

/** Display-only: picks an icon for an amenity; never filters or adds amenities. */
const ICONS: [RegExp, LucideIcon][] = [
  [/wi-?fi|wireless|无线|网络/i, Wifi],
  [/kitchen|cook|厨房|做饭/i, CookingPot],
  [/bath|tub|浴缸|浴室|淋浴/i, Bath],
  [/parking|停车/i, SquareParking],
  [/pool|swim|泳池|游泳/i, Waves],
  [/breakfast|早餐/i, Coffee],
  [/gym|fitness|健身/i, Dumbbell],
  [/air.?condition|空调/i, AirVent],
]

export function amenityIcon(original: string): LucideIcon {
  return ICONS.find(([pattern]) => pattern.test(original))?.[1] ?? Check
}
