'use client'

import { useId, useRef, useState } from 'react'
import { CalendarDays, ChevronLeft, ChevronRight } from 'lucide-react'
import type { FormField } from './types'
import { fieldClass } from './styles'

const iso = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
const parse = (value: string) => new Date(`${value}T12:00:00`)

export function DateRangeField({ departure, returning, initialStart = '', initialEnd = '' }: {
  departure: FormField, returning: FormField, initialStart?: string, initialEnd?: string,
}) {
  const id = useId(), trigger = useRef<HTMLButtonElement>(null)
  const [start, setStart] = useState(initialStart)
  const [end, setEnd] = useState(initialEnd)
  const [open, setOpen] = useState(false)
  const [choosingEnd, setChoosingEnd] = useState(false)
  const [hover, setHover] = useState('')
  const [month, setMonth] = useState(() => parse(initialStart || initialEnd || iso(new Date())))
  const chinese = /[\u3400-\u9fff]/.test(departure.label)
  const copy = chinese ? {
    title: '出行日期', placeholder: '选择出发日期和返程日期', prev: '上个月', next: '下个月',
    start: '请选择出发日期', end: '请选择返程日期', clear: '清除', today: '今天',
  } : {
    title: 'Travel dates', placeholder: 'Select departure and return dates', prev: 'Previous month', next: 'Next month',
    start: 'Select departure date', end: 'Select return date', clear: 'Clear', today: 'Today',
  }
  const weekdays = chinese ? ['一', '二', '三', '四', '五', '六', '日'] : ['M', 'T', 'W', 'T', 'F', 'S', 'S']
  const first = new Date(month.getFullYear(), month.getMonth(), 1, 12)
  const offset = (first.getDay() + 6) % 7
  const days = Array.from({ length: 42 }, (_, i) => new Date(first.getFullYear(), first.getMonth(), 1 - offset + i, 12))
  const previewEnd = choosingEnd ? hover : end
  const low = start && previewEnd ? (start < previewEnd ? start : previewEnd) : start
  const high = start && previewEnd ? (start > previewEnd ? start : previewEnd) : start

  function select(value: string) {
    if (!choosingEnd) {
      if (!start && end && value <= end) {
        setStart(value); setOpen(false); setHover(''); trigger.current?.focus()
        return
      }
      setStart(value); setEnd(''); setChoosingEnd(true); setHover('')
    } else {
      setStart(value < start ? value : start)
      setEnd(value < start ? start : value)
      setChoosingEnd(false); setHover(''); setOpen(false)
      trigger.current?.focus()
    }
  }

  return <div onKeyDown={event => {
    if (event.key === 'Escape') { setOpen(false); trigger.current?.focus() }
  }}>
    <label htmlFor={id} className="mb-1 block text-sm font-medium">{copy.title}{(departure.required || returning.required) && <span aria-hidden="true" className="ml-1 text-red-600">*</span>}</label>
    <button ref={trigger} id={id} type="button" aria-label={`${copy.title}: ${start || '—'} — ${end || '—'}`} aria-expanded={open} aria-controls={`${id}-calendar`}
      className={`${fieldClass} flex items-center justify-between gap-2 text-left`}
      onClick={() => { setMonth(parse(start || end || iso(new Date()))); setChoosingEnd(Boolean(start && !end)); setOpen(!open) }}>
      <span className={start || end ? '' : 'text-gray-400'}>{start || end ? `${start || (chinese ? '出发日期' : 'Departure date')} → ${end || (chinese ? '返程日期' : 'Return date')}` : copy.placeholder}</span>
      <CalendarDays size={18} aria-hidden="true" className="shrink-0 text-gray-500" />
    </button>
    {[{ field: departure, value: start, update: setStart }, { field: returning, value: end, update: setEnd }].map(({ field, value, update }) =>
      <input key={field.name} type="date" aria-label={field.label} name={field.name} required={field.required}
        className="sr-only" tabIndex={-1} value={value} onChange={event => update(event.target.value)} onInvalid={() => setOpen(true)} />)}
    {open && <div id={`${id}-calendar`} role="group" aria-label={copy.title} className="mt-3 rounded-[28px] border border-gray-100 bg-white p-4 shadow-lg sm:p-5">
      <div className="mb-4 flex items-center justify-between">
        <h4 className="text-lg font-semibold tracking-tight">
          {chinese ? `${month.getFullYear()}年${month.getMonth() + 1}月` : <>{month.toLocaleString('en', { month: 'long' })} <span className="text-gray-400">{month.getFullYear()}</span></>}
        </h4>
        <div className="flex gap-1">
          <button type="button" aria-label={copy.prev} className="rounded-full p-2 hover:bg-gray-100 focus-visible:outline-2 focus-visible:outline-pink-500" onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1, 12))}><ChevronLeft size={18} /></button>
          <button type="button" aria-label={copy.next} className="rounded-full p-2 hover:bg-gray-100 focus-visible:outline-2 focus-visible:outline-pink-500" onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1, 12))}><ChevronRight size={18} /></button>
        </div>
      </div>
      <div className="mb-2 grid grid-cols-7 text-center text-xs font-medium text-gray-400">{weekdays.map((day, i) => <span key={i} className="py-2">{day}</span>)}</div>
      <div className="grid grid-cols-7 gap-y-1" onMouseLeave={() => setHover('')}>
        {days.map(date => {
          const value = iso(date), selected = value === start || value === (choosingEnd ? hover : end)
          const inRange = Boolean(low && high && value >= low && value <= high && low !== high)
          // Endpoint backgrounds start at the circle's center so the wider
          // grid cell cannot leave a pale fringe outside the selected circle.
          const rangeBackground = !inRange ? undefined
            : value === low ? 'linear-gradient(to right, transparent 50%, #fce7f3 50%)'
              : value === high ? 'linear-gradient(to left, transparent 50%, #fce7f3 50%)'
                : '#fce7f3'
          return <div key={value} style={{ background: rangeBackground }}>
            <button type="button" aria-label={value} aria-pressed={selected} aria-current={value === iso(new Date()) ? 'date' : undefined}
              onClick={() => select(value)} onMouseEnter={() => { if (choosingEnd) setHover(value) }}
              onKeyDown={event => {
                const delta = ({ ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 } as Record<string, number>)[event.key]
                if (!delta) return
                event.preventDefault()
                const next = new Date(date); next.setDate(date.getDate() + delta)
                const nextValue = iso(next)
                const calendar = event.currentTarget.closest('[role="group"]')
                const target = calendar?.querySelector<HTMLButtonElement>(`button[aria-label="${nextValue}"]`)
                if (target) target.focus()
              }}
              className={`mx-auto flex aspect-square w-full max-w-10 items-center justify-center rounded-full text-sm font-medium transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-pink-500 ${selected ? 'bg-[#ff569c] text-white' : inRange ? 'text-pink-700 hover:bg-pink-200' : date.getMonth() !== month.getMonth() ? 'text-gray-300 hover:bg-gray-100' : 'text-gray-900 hover:bg-pink-50'}`}>
              {date.getDate()}
            </button>
          </div>
        })}
      </div>
      <p aria-live="polite" className="mt-3 text-center text-xs text-gray-500">{choosingEnd ? copy.end : copy.start}</p>
      <div className="mt-3 flex justify-between border-t border-gray-100 pt-3 text-sm font-medium text-pink-600">
        <button type="button" className="rounded px-2 py-1 hover:bg-pink-50" onClick={() => { setStart(''); setEnd(''); setChoosingEnd(false); setHover('') }}>{copy.clear}</button>
        <button type="button" className="rounded px-2 py-1 hover:bg-pink-50" onClick={() => { const today = iso(new Date()); setMonth(parse(today)); select(today) }}>{copy.today}</button>
      </div>
    </div>}
  </div>
}
