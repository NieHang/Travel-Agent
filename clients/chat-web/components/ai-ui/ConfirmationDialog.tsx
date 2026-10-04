'use client'

import { useId } from 'react'
import type { InteractiveProps } from './types'
import { buttonClass, panelClass, primaryButtonClass } from './styles'

/** Inline, non-modal confirmation so the conversation remains accessible. */
export function ConfirmationDialog({ component, onAction, disabled = false }: InteractiveProps<'confirmation'>) {
  const titleId = useId()
  const summaryId = useId()
  const respond = (confirmed: boolean) => onAction({ type: 'confirmation', componentId: component.id, confirmed })
  return (
    <section role="group" aria-labelledby={titleId} aria-describedby={summaryId} className={panelClass}>
      <h3 id={titleId} className="font-semibold">{component.title}</h3>
      <p id={summaryId} className="my-3 whitespace-pre-wrap break-words text-sm text-gray-600">{component.summary}</p>
      <div className="flex flex-wrap gap-2">
        <button type="button" disabled={disabled} className={primaryButtonClass} onClick={() => respond(true)}>{component.confirmLabel}</button>
        <button type="button" disabled={disabled} className={buttonClass} onClick={() => respond(false)}>{component.cancelLabel}</button>
      </div>
    </section>
  )
}
