'use client'
import { useState } from 'react'
import { Check } from 'lucide-react'
import type { Component } from '@autix/contracts'
import { PillButton } from '@/components/ui/PillButton'
import type { ComponentMode } from './ComponentRenderer'

type ButtonCommand = Extract<Component, { type: 'buttons' }>['buttons'][number]['command']

/** Moving the trip forward is the main action; going back to the requirements is secondary. */
const PRIMARY = { confirm: true, resume: true, edit: false } satisfies Record<ButtonCommand, boolean>

export function ButtonsRow({ component, mode }: {
  component: Extract<Component, { type: 'buttons' }>
  mode: ComponentMode
}) {
  const [clicked, setClicked] = useState<ButtonCommand | null>(null)
  const chosen = mode.kind === 'answered' ? component.buttons.find((b) => b.command === mode.command.type) : undefined
  if (chosen)
    return (
      <p className="inline-flex min-h-11 items-center gap-1.5 rounded-full bg-lime px-4 text-sm font-bold text-ink">
        <Check size={16} aria-hidden="true" />{chosen.label}
      </p>
    )
  const buttons = [...component.buttons].sort((a, b) => Number(PRIMARY[b.command]) - Number(PRIMARY[a.command]))
  return (
    <div role="group" className="flex flex-col gap-2 sm:flex-row">
      {buttons.map((button) => (
        <PillButton
          key={button.command}
          variant={PRIMARY[button.command] ? 'ink' : 'ghost'}
          size="sm"
          loading={mode.kind === 'locked' && clicked === button.command}
          disabled={mode.kind !== 'live' && clicked !== button.command}
          onClick={() => {
            if (mode.kind !== 'live') return
            setClicked(button.command)
            mode.onCommand({ type: button.command })
          }}
        >
          {button.label}
        </PillButton>
      ))}
    </div>
  )
}
