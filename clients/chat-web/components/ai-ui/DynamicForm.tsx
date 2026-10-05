'use client'

import { useId, type ChangeEvent, type FormEvent } from 'react'
import type { InteractiveProps, UIAction } from './types'
import { fieldClass, panelClass, primaryButtonClass } from './styles'
import { DateRangeField } from './DateRangeField'

export function DynamicForm({ component, onAction, disabled = false }: InteractiveProps<'form'>) {
  const prefix = useId()
  const initialValues = Object.fromEntries((component.initialValues ?? []).map(({ name, value }) => [name, value]))
  const departure = component.fields.find(field => field.type === 'date' && field.name === 'departureDate')
  const returning = component.fields.find(field => field.type === 'date' && field.name === 'returnDate')

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (disabled || !event.currentTarget.reportValidity()) return
    const form = event.currentTarget
    const data = new FormData(form)
    const values: Extract<UIAction, { type: 'form_submit' }>['values'] = component.fields.map(field => {
      const input = String(data.get(field.name) ?? '')
      const raw = field.type === 'select' ? input : input.trim()
      return { name: field.name, value: raw === '' ? null : field.type === 'number' ? Number(raw) : raw }
    })
    // Native required validation treats whitespace as a value; the API does not.
    for (const field of component.fields) {
      if (field.required && values.find(value => value.name === field.name)?.value === null) {
        const control = form.elements.namedItem(field.name) as HTMLInputElement
        control.setCustomValidity('请填写此字段')
        control.reportValidity()
        return
      }
    }
    onAction({ type: 'form_submit', componentId: component.id, values })
  }

  return (
    <form aria-label={component.title} className={panelClass} onSubmit={submit}>
      <h3 className="mb-3 font-semibold">{component.title}</h3>
      <fieldset disabled={disabled} className="space-y-3">
        {component.fields.map(field => {
          if (departure && returning && field === returning) return null
          if (departure && returning && field === departure) return <DateRangeField key="travel-dates" departure={departure} returning={returning} initialStart={String(initialValues.departureDate ?? '')} initialEnd={String(initialValues.returnDate ?? '')} />
          const id = `${prefix}-${field.name}`
          const common = { id, name: field.name, required: field.required, defaultValue: String(initialValues[field.name] ?? ''), className: fieldClass, onChange: (event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => event.currentTarget.setCustomValidity('') }
          return (
            <div key={field.name}>
              <label htmlFor={id} className="mb-1 block text-sm font-medium">{field.label}{field.required && <span aria-hidden="true" className="ml-1 text-red-600">*</span>}</label>
              {field.type === 'textarea' ? <textarea {...common} rows={3} maxLength={4000} placeholder={field.placeholder ?? undefined} />
                : field.type === 'select' ? <select {...common}><option value="">请选择</option>{field.options.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}</select>
                  : field.type === 'number' ? <input {...common} type="number" step="any" min={field.min ?? undefined} max={field.max ?? undefined} />
                    : <input {...common} type={field.type === 'date' ? 'date' : 'text'} maxLength={4000} placeholder={field.placeholder ?? undefined} />}
            </div>
          )
        })}
        <button type="submit" className={primaryButtonClass}>{component.submitLabel}</button>
      </fieldset>
    </form>
  )
}
