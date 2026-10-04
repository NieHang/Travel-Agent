'use client'

import { AlertDialog } from '@heroui/react'
import { useEffect, useRef } from 'react'
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
  const cancelRef = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    if (!open) return
    // 菜单关闭与嵌套模态框都会恢复焦点；最后把焦点放在安全的取消操作上。
    const timer = setTimeout(() => cancelRef.current?.focus(), 0)
    return () => clearTimeout(timer)
  }, [open])
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
            <PillButton ref={cancelRef} variant="ghost" size="sm" autoFocus onClick={onCancel}>
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
