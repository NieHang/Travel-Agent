'use client'

import { useState } from 'react'
import type { InteractiveProps } from './types'
import { buttonClass, panelClass, primaryButtonClass } from './styles'

export function SelectionCard({ component, onAction, disabled = false }: InteractiveProps<'selection'>) {
  const [selected, setSelected] = useState<string[]>([])
  const submit = (values: string[]) => onAction({ type: 'selection', componentId: component.id, values })

  return (
    <section aria-label={component.title} className={panelClass}>
      <h3 className="mb-3 font-semibold">{component.title}</h3>
      <div className="grid gap-2 sm:grid-cols-2">
        {component.options.map(option => component.mode === 'single' ? (
          <button key={option.value} type="button" disabled={disabled} className={`${buttonClass} text-left`} onClick={() => submit([option.value])}>
            <span className="block">{option.label}</span>
            {option.description && <span className="mt-1 block text-xs text-gray-500">{option.description}</span>}
          </button>
        ) : (
          <label key={option.value} className={`${buttonClass} flex items-start gap-2 ${disabled ? 'opacity-50' : 'cursor-pointer'}`}>
            <input type="checkbox" disabled={disabled} checked={selected.includes(option.value)} className="mt-1 accent-blue-600" onChange={event => setSelected(values => event.target.checked ? [...values, option.value] : values.filter(value => value !== option.value))} />
            <span><span className="block">{option.label}</span>{option.description && <span className="mt-1 block text-xs text-gray-500">{option.description}</span>}</span>
          </label>
        ))}
      </div>
      {component.mode === 'multiple' && <button type="button" disabled={disabled || selected.length === 0} className={`${primaryButtonClass} mt-3`} onClick={() => submit(selected)}>确认选择</button>}
    </section>
  )
}
