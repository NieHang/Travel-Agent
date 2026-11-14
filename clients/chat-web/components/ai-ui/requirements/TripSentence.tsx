'use client'

import { useState, type ReactNode } from 'react'
import { Button, I18nProvider, Popover } from '@heroui/react'
import { Check } from 'lucide-react'
import { useLocale, useTranslations } from 'next-intl'
import type { Component, FormField } from '@autix/contracts'
import { PillButton } from '@/components/ui/PillButton'
import type { ComponentMode } from '../ComponentRenderer'
import {
  DatesEditor, DestinationEditor, ICONS, PreferencesEditor, TravelersStepper,
  chipBase, filledChip, isMissing, missingChip, toRequirements, useSummary, withSubmitted,
} from './fields'

type Name = FormField['name']

/**
 * The requirements form as one row of chips. Each chip opens its editor; committing
 * one opens the next missing field, so filling everything is a chain of single taps.
 */
export function TripSentence({ component, mode }: {
  component: Extract<Component, { type: 'form' }>
  mode: ComponentMode
}) {
  const t = useTranslations('tripForm')
  const locale = useLocale()
  const summary = useSummary()
  const [draft, setDraft] = useState(component.fields)
  const [open, setOpen] = useState<Name | null>(null)
  const [sent, setSent] = useState(false)
  const live = mode.kind === 'live'
  const fields = mode.kind === 'answered' && mode.command.type === 'submit_requirements'
    ? withSubmitted(component.fields, mode.command.values)
    : draft
  const missing = draft.find(isMissing)

  function update(field: FormField, advance: boolean) {
    const next = draft.map((f) => (f.name === field.name ? field : f))
    setDraft(next)
    if (advance) setOpen(next.find(isMissing)?.name ?? null)
  }

  function primary() {
    if (mode.kind !== 'live') return
    if (missing) return setOpen(missing.name)
    setSent(true)
    mode.onCommand({ type: 'submit_requirements', values: toRequirements(draft) })
  }

  function chip(field: FormField): ReactNode {
    const Icon = ICONS[field.name]
    const text = summary(field)
    const look = `${chipBase} gap-1.5 px-3.5 ${text === null ? missingChip : filledChip}`
    const content = <><Icon size={16} aria-hidden="true" className="shrink-0" /><span className="max-w-56 truncate">{text ?? field.label}</span></>
    if (!live) return <span key={field.name} className={look}>{content}</span>
    if (field.name === 'travelers')
      return <TravelersStepper key={field.name} field={field} onChange={(f) => update(f, false)} />
    const commit = (f: FormField) => update(f, true)
    return (
      <Popover.Root key={field.name} isOpen={open === field.name} onOpenChange={(isOpen) => setOpen(isOpen ? field.name : null)}>
        <Button variant="ghost" aria-label={text ? `${field.label}: ${text}` : field.label} className={`${look} h-auto hover:border-ink`}>
          {content}
        </Button>
        <Popover.Content placement="bottom start" className="trip-form max-w-[calc(100vw-32px)] rounded-card">
          <Popover.Dialog aria-label={field.label} className="p-3">
            {field.name === 'destination' ? <DestinationEditor field={field} onCommit={commit} />
              : field.name === 'dates' ? <DatesEditor field={field} onCommit={commit} />
                : <PreferencesEditor field={field} onCommit={commit} />}
          </Popover.Dialog>
        </Popover.Content>
      </Popover.Root>
    )
  }

  // react-aria formats the calendar and stepper from its own locale, not next-intl's.
  return (
    <I18nProvider locale={locale}>
    <section aria-label={component.title} className="trip-form flex flex-col gap-3">
      <h3 className="text-sm font-bold text-ink/60">{component.title}</h3>
      <div className="flex flex-wrap gap-2">{fields.map(chip)}</div>
      {mode.kind === 'answered' ? (
        <p className="flex items-center gap-1 self-end text-sm font-bold text-ink/60">
          <Check size={16} aria-hidden="true" />{t('submitted')}
        </p>
      ) : live || sent ? (
        <div className="flex justify-end">
          <PillButton variant="ink" loading={sent && !live} disabled={!live && !sent} onClick={primary}>
            {missing ? t('next', { field: missing.label }) : component.submitLabel}
          </PillButton>
        </div>
      ) : null}
    </section>
    </I18nProvider>
  )
}
