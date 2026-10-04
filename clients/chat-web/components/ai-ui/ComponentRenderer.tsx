'use client'

import { SelectionCard } from './SelectionCard'
import { DynamicForm } from './DynamicForm'
import { ConfirmationDialog } from './ConfirmationDialog'
import { InfoCard } from './InfoCard'
import { StepsProgress } from './StepsProgress'
import { DataTable } from './DataTable'
import { ActionButtons } from './ActionButtons'
import type { UIResponse, UIAction } from './types'

export interface ComponentRendererProps {
  component: UIResponse
  onAction: (action: UIAction) => void
  disabled?: boolean
}

export function ComponentRenderer({ component, onAction, disabled = false }: ComponentRendererProps) {
  const interactive = { onAction, disabled }
  switch (component.type) {
    // Both formats are escaped React text; rich Markdown can be added separately.
    case 'text': return <p className="whitespace-pre-wrap break-words text-sm">{component.content}</p>
    case 'selection': return <SelectionCard component={component} {...interactive} />
    case 'form': return <DynamicForm component={component} {...interactive} />
    case 'confirmation': return <ConfirmationDialog component={component} {...interactive} />
    case 'card': return <InfoCard component={component} />
    case 'steps': return <StepsProgress component={component} />
    case 'table': return <DataTable component={component} />
    case 'action_buttons': return <ActionButtons component={component} {...interactive} />
    default: return <p role="status" className="text-sm text-gray-500">暂不支持此组件</p>
  }
}
