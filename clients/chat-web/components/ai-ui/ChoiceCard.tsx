'use client'
import type { Command, Component } from '@autix/contracts'
import { buttonClass, panelClass } from './styles'

export function ChoiceCard({ component, onCommand, disabled = false }: {
  component: Extract<Component, { type: 'choice' }>
  onCommand: (command: Command) => void
  disabled?: boolean
}) {
  return (
    <section aria-label={component.title} className={panelClass}>
      <h3 className="mb-3 font-semibold">{component.title}</h3>
      <div className="grid gap-2 sm:grid-cols-2">
        {component.options.map((option) => (
          <button
            key={option.value}
            type="button"
            disabled={disabled}
            className={`${buttonClass} text-left`}
            onClick={() =>
              onCommand(
                component.command === 'set_trip_type'
                  ? { type: 'set_trip_type', value: option.value as 'business' | 'family' | 'solo' | 'couple' }
                  : { type: 'set_destination', value: option.value },
              )
            }
          >
            <span className="block">{option.label}</span>
            {option.description ? <span className="mt-1 block text-xs text-gray-500">{option.description}</span> : null}
          </button>
        ))}
      </div>
    </section>
  )
}
