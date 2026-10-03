'use client'

import { AlertDialog } from '@heroui/react'
import { PillButton } from './PillButton'

export function ConfirmDialog({
  open,
  title,
  body,
  confirmLabel,
  cancelLabel,
  onConfirm,
  onCancel,
}: {
  open: boolean
  title: string
  body: string
  confirmLabel: string
  cancelLabel: string
  onConfirm(): void
  onCancel(): void
}) {
  return (
    <AlertDialog.Backdrop
      isOpen={open}
      isKeyboardDismissDisabled={false}
      onOpenChange={(next) => {
        if (!next) onCancel()
      }}
    >
      <AlertDialog.Container>
        <AlertDialog.Dialog className="rounded-card bg-paper text-ink">
          <AlertDialog.Header>
            <AlertDialog.Heading>{title}</AlertDialog.Heading>
          </AlertDialog.Header>
          <AlertDialog.Body>
            <p>{body}</p>
          </AlertDialog.Body>
          <AlertDialog.Footer className="flex justify-end gap-2">
            <PillButton variant="ghost" size="sm" autoFocus onClick={onCancel}>
              {cancelLabel}
            </PillButton>
            <PillButton variant="danger" size="sm" onClick={onConfirm}>
              {confirmLabel}
            </PillButton>
          </AlertDialog.Footer>
        </AlertDialog.Dialog>
      </AlertDialog.Container>
    </AlertDialog.Backdrop>
  )
}
