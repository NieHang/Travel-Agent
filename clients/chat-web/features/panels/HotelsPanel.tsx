'use client'
import { motion, useReducedMotion } from 'motion/react'
import { useFormatter, useTranslations } from 'next-intl'
import { useRef, useState } from 'react'
import { PillTabs } from '@/components/ui/PillTabs'
import { PillButton } from '@/components/ui/PillButton'
import { toast } from '@/components/ui/toast'
import { enter } from '@/lib/motion'
import { fullStayPrice } from './pricing'
import type { TripMock } from './mock/types'

export function HotelsPanel({ data }: { data: TripMock }) {
  const t = useTranslations('panels'), format = useFormatter(), reduced = useReducedMotion()
  const [index, setIndex] = useState(0), [mode, setMode] = useState('night')
  const refs = useRef<(HTMLButtonElement | null)[]>([])
  const hotel = data.hotels[index]
  return <div className="flex flex-col gap-4">
    <div role="radiogroup" aria-label={t('tabs.hotels')} className="grid gap-3">
      {data.hotels.map((item, i) => <button key={item.id} ref={(el) => { refs.current[i] = el }} type="button"
        role="radio" aria-checked={i === index} tabIndex={i === index ? 0 : -1}
        onClick={() => setIndex(i)} onKeyDown={(event) => {
          const delta = ['ArrowRight', 'ArrowDown'].includes(event.key) ? 1 : ['ArrowLeft', 'ArrowUp'].includes(event.key) ? -1 : 0
          if (!delta) return
          event.preventDefault(); const next = (i + delta + data.hotels.length) % data.hotels.length
          setIndex(next); refs.current[next]?.focus()
        }} className={`min-h-11 cursor-pointer rounded-card border-2 bg-paper p-4 text-left text-ink ${i === index ? 'border-lime' : 'border-transparent'}`}>
        <div className="image-placeholder mb-3 rounded-card p-6 text-sm">{item.imageLabel}</div>
        <p className="text-xl font-bold">{item.name}</p><p>{item.area}</p>
      </button>)}
    </div>
    <PillTabs aria-label={t('perNight')} layoutId="hotel-pricing" onInk value={mode} onChange={setMode}
      items={[{ value: 'night', label: t('perNight') }, { value: 'stay', label: t('fullStay'), badge: '-12%' }]} />
    <motion.p key={`${index}-${mode}`} {...enter(0, Boolean(reduced))} className="text-4xl font-extrabold text-white">
      {format.number(mode === 'night' ? hotel.perNight : fullStayPrice(hotel.perNight), { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 })}
      <span className="ml-2 text-sm">{mode === 'night' ? t('perNight') : t('fullStay')}</span>
    </motion.p>
    <PillButton variant="lime" onClick={() => toast(t('bookSoon'))}>{t('book', { hotel: hotel.name })}</PillButton>
  </div>
}
