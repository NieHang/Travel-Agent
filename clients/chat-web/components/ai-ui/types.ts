// Type-only imports keep the backend's canonical protocol in sync without
// including its schemas or server dependencies in the client bundle.
import type { UIResponse, UIAction } from '../../../../services/chat/src/llm/ui-protocol/ui-types'

export type { UIResponse, UIAction, AIUIResponse } from '../../../../services/chat/src/llm/ui-protocol/ui-types'
export type { UIFormField as FormField } from '../../../../services/chat/src/llm/ui-protocol/ui-types'

export type ComponentProps<T extends UIResponse['type']> = {
  component: Extract<UIResponse, { type: T }>
}

export type InteractiveProps<T extends UIResponse['type']> = ComponentProps<T> & {
  onAction: (action: UIAction) => void
  disabled?: boolean
}
