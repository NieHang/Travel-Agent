'use client'

import type { TripView } from '@autix/contracts'
import { useState } from 'react'
import { dayMap, stopHue } from './plan-model'

const LEAF = 'M12 2l2.2 4.6 3.6-1.6-.9 4.4 4.6.4-3.3 3.2 2.3 2.8-4.4.6.3 3.6-4.4-2.4V22h-1v-4.4l-4.4 2.4.3-3.6-4.4-.6 2.3-2.8L1.5 9.8l4.6-.4-.9-4.4 3.6 1.6z'

const LEAVES = [
  { x: 9, y: 90, size: 32, tilt: -18, fill: 'fill-trip-brand' },
  { x: 90, y: 78, size: 34, tilt: 10, fill: 'fill-trip-accent' },
  { x: 50, y: 52, size: 24, tilt: 24, fill: 'fill-map-maple' },
  { x: 88, y: 10, size: 30, tilt: -12, fill: 'fill-map-maple' },
  { x: 10, y: 12, size: 26, tilt: 30, fill: 'fill-trip-accent' },
]

/**
 * Not a real map: it labels the day's first stops in their tint and joins them with a dotted route,
 * over `photo` when the day has one and over a drawn town otherwise.
 */
export function DayMap({ stops, day, photo }: { stops: TripView['days'][number]['stops']; day: number; photo: string | null }) {
  const { pins, route } = dayMap(stops, day)
  const [failed, setFailed] = useState<string | null>(null)
  const src = photo !== failed ? photo : null
  return (
    // The @2xl variants read PlanTab's row: a square beside the timeline once both fit, else full width under it.
    <div aria-hidden data-testid="day-map" className="relative aspect-[2/1] w-full shrink-0 overflow-hidden rounded-trip-lg bg-map-ground @2xl:aspect-square @2xl:w-60">
      {src ? (
        <>
          {/* oxlint-disable-next-line nextjs/no-img-element -- hotel photos come from arbitrary hosts, which next/image would need listed one by one */}
          <img
            src={src}
            alt=""
            loading="lazy"
            decoding="async"
            referrerPolicy="no-referrer"
            onError={() => setFailed(src)}
            className="absolute inset-0 size-full object-cover"
          />
          <span className="absolute inset-0 bg-trip-ink/25" />
        </>
      ) : null}
      <svg viewBox="0 0 600 600" preserveAspectRatio="none" className="absolute inset-0 size-full">
        {src ? null : <Town />}
        {route ? (
          <path d={route} fill="none" strokeWidth={5} strokeDasharray="1 13" strokeLinecap="round" className={src ? 'stroke-white' : 'stroke-trip-ink'} />
        ) : null}
      </svg>
      {LEAVES.map((leaf, i) => (
        <svg
          key={i}
          viewBox="0 0 24 24"
          className="absolute -translate-1/2 drop-shadow-trip-leaf"
          style={{ left: `${leaf.x}%`, top: `${leaf.y}%`, width: leaf.size, height: leaf.size, rotate: `${leaf.tilt}deg` }}
        >
          <path d={LEAF} strokeWidth={1.6} strokeLinejoin="round" className={`stroke-white ${leaf.fill}`} />
        </svg>
      ))}
      {/* Two of dayMap's spots sit 38% apart at nearly the same height; at 36% wide their labels cannot touch on the short 2:1 map. */}
      {pins.map((pin, i) => (
        <span
          key={i}
          className={`absolute max-w-[36%] -translate-1/2 truncate @2xl:max-w-[45%] rounded-full border-[3px] border-white px-[11px] py-[3px] text-[13px] font-bold text-white shadow-trip-label ${stopHue(i).solid}`}
          style={{ left: `${pin.x}%`, top: `${pin.y}%`, rotate: `${pin.tilt}deg` }}
        >
          {pin.name}
        </span>
      ))}
    </div>
  )
}

function Town() {
  return (
    <>
      <path d="M500 0H600V600H540Q500 450 530 300T500 0Z" className="fill-map-park" />
      <g className="fill-map-block">
        <rect x="104" y="194" width="92" height="62" rx="6" />
        <rect x="224" y="374" width="92" height="62" rx="6" />
        <rect x="344" y="284" width="72" height="62" rx="6" />
        <rect x="224" y="104" width="92" height="62" rx="6" />
        <rect x="104" y="464" width="92" height="30" rx="6" />
      </g>
      <g fill="none" className="stroke-white">
        <path d="M0 45H600M0 135H600M0 225H600M0 315H600M0 405H600M0 580H600M150 0V600M270 0V600M390 0V600M560 0V600" strokeWidth={4} />
        <path d="M510 360L600 320M0 560L150 470" strokeWidth={6} />
        <path d="M0 90H600M0 180H600M0 360H600M0 540H600" strokeWidth={8} />
        <path d="M0 270H600M0 450H600" strokeWidth={13} />
        <path d="M90 0V600M330 0V600M510 0V600" strokeWidth={8} />
        <path d="M210 0V600" strokeWidth={13} />
      </g>
      <path d="M440 0C425 150 455 300 432 450S440 560 437 600" fill="none" strokeWidth={26} className="stroke-map-water" />
      <path d="M0 505H600" fill="none" strokeWidth={5} strokeDasharray="14 8" className="stroke-map-rail" />
    </>
  )
}
