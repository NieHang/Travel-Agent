'use client'
import { useState } from 'react'
import type { Command, Component } from '@autix/contracts'
import { PillButton } from '@/components/ui/PillButton'

type ButtonCommand = Extract<Component, { type: 'buttons' }>['buttons'][number]['command']

/** Moving the trip forward is the main action; going back to the requirements is secondary. */
const PRIMARY = { confirm: true, resume: true, edit: false } satisfies Record<ButtonCommand, boolean>

/** Without `onCommand` the row is read-only; the button just clicked keeps spinning until the reply lands. */
export function ButtonsRow({ component, onCommand }: {
  component: Extract<Component, { type: 'buttons' }>
  onCommand?: (command: Command) => void
}) {
  const [clicked, setClicked] = useState<ButtonCommand | null>(null)
  const buttons = [...component.buttons].sort((a, b) => Number(PRIMARY[b.command]) - Number(PRIMARY[a.command]))
  return (
    <div role="group" className="flex flex-col gap-2 sm:flex-row">
      {buttons.map((button) => (
        <PillButton
          key={button.command}
          variant={PRIMARY[button.command] ? 'ink' : 'ghost'}
          size="sm"
          loading={!onCommand && clicked === button.command}
          disabled={!onCommand && clicked !== button.command}
          onClick={() => {
            if (!onCommand) return
            setClicked(button.command)
            onCommand({ type: button.command })
          }}
        >
          {button.label}
        </PillButton>
      ))}
    </div>
  )
}
