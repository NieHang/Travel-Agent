'use client'

import { useState, type FormEvent } from 'react'
import { Button, Input, NumberField, RangeCalendar, TextArea, TextField } from '@heroui/react'
import { getLocalTimeZone, parseDate, today } from '@internationalized/date'
import { CalendarDays, MapPin, Sparkles, Users, type LucideIcon } from 'lucide-react'
import { useLocale, useTranslations } from 'next-intl'
import { TRAVELERS, type FormField, type Requirements } from '@autix/contracts'

/**
 * Everything the trip sentence knows about individual fields lives here. Adding a
 * field (e.g. budget) to FormFieldSchema makes each switch below fail to compile
 * until the new field is handled.
 */

export const ICONS: Record<FormField['name'], LucideIcon> = {
  destination: MapPin,
  dates: CalendarDays,
  travelers: Users,
  preferences: Sparkles,
}

export function isMissing(field: FormField): boolean {
  return field.value === null
}

/** The values a submit sends for these fields; '' clears an optional text. */
export function toRequirements(fields: FormField[]): Requirements {
  const out: Requirements = {}
  for (const field of fields) {
    switch (field.name) {
      case 'destination':
        if (field.value !== null) out.destination = field.value
        break
      case 'dates':
        if (field.value !== null) Object.assign(out, { departureDate: field.value.start, returnDate: field.value.end })
        break
      case 'travelers':
        if (field.value !== null) out.travelers = field.value
        break
      case 'preferences':
        out.preferences = field.value
        break
      default:
        return field satisfies never
    }
  }
  return out
}

/** The fields as they were when `values` was submitted, for the answered view. */
export function withSubmitted(fields: FormField[], values: Requirements): FormField[] {
  return fields.map((field): FormField => {
    switch (field.name) {
      case 'destination':
        return { ...field, value: values.destination ?? field.value }
      case 'dates':
        return values.departureDate && values.returnDate
          ? { ...field, value: { start: values.departureDate, end: values.returnDate } }
          : field
      case 'travelers':
        return { ...field, value: values.travelers ?? field.value }
      case 'preferences':
        return { ...field, value: values.preferences ?? field.value }
      default:
        return field satisfies never
    }
  })
}

/** Chip text for a filled field; null when the chip should show the field's label instead. */
export function useSummary() {
  const locale = useLocale()
  const t = useTranslations('tripForm')
  const day = new Intl.DateTimeFormat(locale, { month: 'short', day: 'numeric' })
  return (field: FormField): string | null => {
    switch (field.name) {
      case 'destination':
        return field.value
      case 'dates':
        return field.value && `${day.format(parseDate(field.value.start).toDate(getLocalTimeZone()))} – ${day.format(parseDate(field.value.end).toDate(getLocalTimeZone()))}`
      case 'travelers':
        return field.value === null ? null : t('travelers', { count: field.value })
      case 'preferences':
        return field.value || null
      default:
        return field satisfies never
    }
  }
}

type EditorProps<N extends FormField['name']> = {
  field: Extract<FormField, { name: N }>
  onCommit: (field: Extract<FormField, { name: N }>) => void
}

export function DestinationEditor({ field, onCommit }: EditorProps<'destination'>) {
  const t = useTranslations('tripForm')
  const [text, setText] = useState(field.value ?? '')
  const value = text.trim()
  function submit(event: FormEvent) {
    event.preventDefault()
    if (value) onCommit({ ...field, value })
  }
  return (
    <form onSubmit={submit} className="flex w-72 max-w-full flex-col gap-3">
      <div className="flex flex-wrap gap-2">
        {field.suggestions.map((city) => (
          <button key={city} type="button" className={pickClass(city === field.value)} onClick={() => onCommit({ ...field, value: city })}>
            {city}
          </button>
        ))}
      </div>
      <div className="flex gap-2">
        <TextField aria-label={field.label} value={text} onChange={setText} className="min-w-0 flex-1">
          <Input autoFocus placeholder={field.placeholder ?? undefined} maxLength={200} />
        </TextField>
        <Button type="submit" isDisabled={!value} className="bg-ink text-white">{t('done')}</Button>
      </div>
    </form>
  )
}

export function DatesEditor({ field, onCommit }: EditorProps<'dates'>) {
  const t = useTranslations('tripForm')
  const value = field.value && { start: parseDate(field.value.start), end: parseDate(field.value.end) }
  return (
    <RangeCalendar
      aria-label={field.label}
      defaultValue={value}
      minValue={today(getLocalTimeZone())}
      autoFocus
      onChange={(range) => onCommit({ ...field, value: { start: range.start.toString(), end: range.end.toString() } })}
    >
      <RangeCalendar.Header>
        <RangeCalendar.NavButton slot="previous" aria-label={t('previousMonth')} />
        <RangeCalendar.Heading />
        <RangeCalendar.NavButton slot="next" aria-label={t('nextMonth')} />
      </RangeCalendar.Header>
      <RangeCalendar.Grid>
        <RangeCalendar.GridHeader>{(day) => <RangeCalendar.HeaderCell>{day}</RangeCalendar.HeaderCell>}</RangeCalendar.GridHeader>
        <RangeCalendar.GridBody>{(date) => <RangeCalendar.Cell date={date} />}</RangeCalendar.GridBody>
      </RangeCalendar.Grid>
    </RangeCalendar>
  )
}

export function PreferencesEditor({ field, onCommit }: EditorProps<'preferences'>) {
  const t = useTranslations('tripForm')
  const locale = useLocale()
  const [text, setText] = useState(field.value)
  const chosen = text.split(/[、,，]\s*/).map((s) => s.trim()).filter(Boolean)
  function toggle(tag: string) {
    const next = chosen.includes(tag) ? chosen.filter((s) => s !== tag) : [...chosen, tag]
    setText(next.join(locale.startsWith('zh') ? '、' : ', '))
  }
  return (
    <div className="flex w-80 max-w-full flex-col gap-3">
      <div className="flex flex-wrap gap-2">
        {field.suggestions.map((tag) => (
          <button key={tag} type="button" aria-pressed={chosen.includes(tag)} className={pickClass(chosen.includes(tag))} onClick={() => toggle(tag)}>
            {tag}
          </button>
        ))}
      </div>
      <TextField aria-label={field.label} value={text} onChange={setText}>
        <TextArea rows={3} maxLength={4000} placeholder={field.placeholder ?? undefined} />
      </TextField>
      <Button className="self-end bg-ink text-white" onPress={() => onCommit({ ...field, value: text.trim() })}>{t('done')}</Button>
    </div>
  )
}

export function TravelersStepper({ field, onChange }: {
  field: Extract<FormField, { name: 'travelers' }>
  onChange: (field: Extract<FormField, { name: 'travelers' }>) => void
}) {
  const t = useTranslations('tripForm')
  return (
    <NumberField
      aria-label={field.label}
      value={field.value ?? Number.NaN}
      minValue={TRAVELERS.min}
      maxValue={TRAVELERS.max}
      onChange={(value) => onChange({ ...field, value: Number.isNaN(value) ? null : value })}
    >
      {/* The group is the chip itself; its look lives in globals.css (.trip-stepper). */}
      <NumberField.Group className="trip-stepper" data-missing={field.value === null || undefined}>
        <Users size={16} aria-hidden="true" className="shrink-0" />
        <NumberField.DecrementButton aria-label={t('fewer')} />
        <NumberField.Input />
        <NumberField.IncrementButton aria-label={t('more')} />
      </NumberField.Group>
    </NumberField>
  )
}

export const chipBase = 'inline-flex min-h-11 items-center rounded-full border-2 text-sm font-bold'
export const missingChip = 'border-dashed border-ink/30 text-ink/60'
export const filledChip = 'border-ink bg-paper text-ink'

const pickClass = (on: boolean) =>
  `min-h-9 rounded-full border-2 px-3 text-sm font-bold transition ${on ? 'border-ink bg-lime text-ink' : 'border-ink/15 text-ink hover:border-ink'}`
