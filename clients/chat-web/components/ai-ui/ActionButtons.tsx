'use client'

import type { InteractiveProps } from './types'
import { buttonClass } from './styles'

export function ActionButtons({ component, onAction, disabled = false }: InteractiveProps<'action_buttons'>) {
  return (
    <div role="group" aria-label="操作" className="flex flex-wrap gap-2">
      {component.buttons.map(button => <button key={button.id} type="button" disabled={disabled} className={buttonClass} onClick={() => onAction({ type: 'button_click', componentId: component.id, buttonId: button.id })}>{button.label}</button>)}
    </div>
  )
}
