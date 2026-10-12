'use client'
import { useId, type ChangeEvent, type FormEvent } from 'react'
import type { Command, Component, Requirements } from '@autix/contracts'
import { fieldClass, panelClass, primaryButtonClass } from './styles'
import { DateRangeField } from './DateRangeField'

export function RequirementsForm({ component, onCommand, disabled = false }: {
  component: Extract<Component, { type: 'form' }>
  onCommand: (command: Command) => void
  disabled?: boolean
}) {
  const prefix = useId()
  const initial = component.initialValues as Record<string, unknown>
  const departure = component.fields.find((f) => f.name === 'departureDate')
  const returning = component.fields.find((f) => f.name === 'returnDate')

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (disabled || !event.currentTarget.reportValidity()) return
    const data = new FormData(event.currentTarget)
    const values: Record<string, unknown> = {}
    for (const field of component.fields) {
      const raw = String(data.get(field.name) ?? '').trim()
      if (field.required && raw === '') {
        const control = event.currentTarget.elements.namedItem(field.name) as HTMLInputElement
        control.setCustomValidity(field.label)
        control.reportValidity()
        return
      }
      // An empty optional field is sent as '' so the server removes it.
      values[field.name] = field.kind === 'number' ? Number(raw) : raw
    }
    onCommand({ type: 'submit_requirements', values: values as Requirements })
  }

  return (
    <form aria-label={component.title} className={panelClass} onSubmit={submit}>
      <h3 className="mb-3 font-semibold">{component.title}</h3>
      <fieldset disabled={disabled} className="space-y-3">
        {component.fields.map((field) => {
          if (departure && returning && field === returning) return null
          if (departure && returning && field === departure)
            return <DateRangeField key="travel-dates" departure={departure} returning={returning} initialStart={String(initial.departureDate ?? '')} initialEnd={String(initial.returnDate ?? '')} />
          const id = `${prefix}-${field.name}`
          const common = {
            id, name: field.name, required: field.required,
            defaultValue: String(initial[field.name] ?? ''), className: fieldClass,
            onChange: (e: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => e.currentTarget.setCustomValidity(''),
          }
          return (
            <div key={field.name}>
              <label htmlFor={id} className="mb-1 block text-sm font-medium">
                {field.label}{field.required ? <span aria-hidden="true" className="ml-1 text-red-600">*</span> : null}
              </label>
              {field.kind === 'textarea' ? <textarea {...common} rows={3} maxLength={4000} placeholder={field.placeholder ?? undefined} />
                : field.kind === 'number' ? <input {...common} type="number" step="1" min={field.min ?? undefined} max={field.max ?? undefined} />
                  : <input {...common} type={field.kind === 'date' ? 'date' : 'text'} maxLength={200} placeholder={field.placeholder ?? undefined} />}
            </div>
          )
        })}
        <button type="submit" className={primaryButtonClass}>{component.submitLabel}</button>
      </fieldset>
    </form>
  )
}
