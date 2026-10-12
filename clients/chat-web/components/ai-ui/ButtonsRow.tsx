'use client'
import type { Command, Component } from '@autix/contracts'
import { buttonClass } from './styles'

export function ButtonsRow({ component, onCommand, disabled = false }: {
  component: Extract<Component, { type: 'buttons' }>
  onCommand: (command: Command) => void
  disabled?: boolean
}) {
  return (
    <div role="group" className="flex flex-wrap gap-2">
      {component.buttons.map((button) => (
        <button key={button.command} type="button" disabled={disabled} className={buttonClass} onClick={() => onCommand({ type: button.command })}>
          {button.label}
        </button>
      ))}
    </div>
  )
}
