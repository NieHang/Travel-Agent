'use client'

import type { TripView } from '@autix/contracts'
import Image from 'next/image'
import { useState } from 'react'
import { dayMap, stopHue, type MapPin } from './plan-model'

const LEAF = 'M12 2l2.2 4.6 3.6-1.6-.9 4.4 4.6.4-3.3 3.2 2.3 2.8-4.4.6.3 3.6-4.4-2.4V22h-1v-4.4l-4.4 2.4.3-3.6-4.4-.6 2.3-2.8L1.5 9.8l4.6-.4-.9-4.4 3.6 1.6z'

const LEAVES = [
  { x: 9, y: 90, size: 32, tilt: -18, fill: 'fill-trip-brand' },
  { x: 90, y: 78, size: 34, tilt: 10, fill: 'fill-trip-accent' },
  { x: 50, y: 52, size: 24, tilt: 24, fill: 'fill-map-maple' },
  { x: 88, y: 10, size: 30, tilt: -12, fill: 'fill-map-maple' },
  { x: 10, y: 12, size: 26, tilt: 30, fill: 'fill-trip-accent' },
]

/** A pin with its photo is this tall; half of it is kept free above the first pin and below the last. */
const PIN_HEIGHT = 128
/** The least distance between two stops: pins two stops apart share a column and must not touch. */
const PIN_STEP = 64

/**
 * A drawn town, not a real map: every stop of the day sits on it with its photo and name, joined by a
 * dotted route. It is as tall as the timeline beside it, and never too short for its pins.
 */
export function DayMap({ stops, day }: { stops: TripView['days'][number]['stops']; day: number }) {
  const { pins, route } = dayMap(stops, day)
  return (
    <div
      aria-hidden
      data-testid="day-map"
      // The @3xl variant reads PlanTab's row: a column beside the timeline once both fit, else full width under it.
      className="relative w-full shrink-0 overflow-hidden rounded-trip-lg bg-map-ground @3xl:w-90"
      style={{ minHeight: PIN_HEIGHT + Math.max(1, pins.length - 1) * PIN_STEP }}
    >
      <svg viewBox="0 0 600 600" preserveAspectRatio="xMidYMid slice" className="absolute inset-0 size-full">
        <Town />
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
      <div className="absolute inset-x-0" style={{ top: PIN_HEIGHT / 2, bottom: PIN_HEIGHT / 2 }}>
        {route ? (
          <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="absolute inset-0 size-full overflow-visible">
            <path d={route} fill="none" strokeWidth={5} strokeDasharray="1 13" strokeLinecap="round" vectorEffect="non-scaling-stroke" className="stroke-trip-ink" />
          </svg>
        ) : null}
        {pins.map((pin, i) => (
          <Pin key={`${i}:${pin.name}`} pin={pin} index={i} />
        ))}
      </div>
    </div>
  )
}

function Pin({ pin, index }: { pin: MapPin; index: number }) {
  const [failed, setFailed] = useState(false)
  return (
    <span
      className="absolute flex w-36 -translate-1/2 flex-col items-center"
      style={{ left: `${pin.x}%`, top: `${pin.y}%`, rotate: index % 2 ? '3deg' : '-3deg' }}
    >
      {pin.image && !failed ? (
        <Image
          src={pin.image}
          alt=""
          width={144}
          height={96}
          onError={() => setFailed(true)}
          className="-mb-2.5 h-24 w-36 rounded-trip-xs border-[3px] border-white object-cover shadow-trip-label"
        />
      ) : null}
      <span className={`relative max-w-full truncate rounded-full border-[3px] border-white px-[11px] py-[3px] text-[13px] font-bold text-white shadow-trip-label ${stopHue(index).solid}`}>
        {pin.name}
      </span>
    </span>
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
