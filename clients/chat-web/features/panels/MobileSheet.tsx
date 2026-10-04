'use client'

import { useReducedMotion } from '@/lib/use-reduced-motion'
import { Modal } from '@heroui/react'
import { motion, useDragControls } from 'motion/react'
import { X } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { useRef, type ReactNode } from 'react'
import { PillButton } from '@/components/ui/PillButton'
import { springs } from '@/lib/motion'

export const DISMISS_RATIO = 0.25
export function shouldDismiss(dragOffsetY: number, sheetHeight: number): boolean {
  return sheetHeight > 0 && dragOffsetY > sheetHeight * DISMISS_RATIO
}
export function MobileSheet({ open, onClose, children }: { open: boolean; onClose(): void; children: ReactNode }) {
  const t = useTranslations('common'), tc = useTranslations('chat'), reduced = useReducedMotion()
  const sheet = useRef<HTMLDivElement>(null)
  const dragControls = useDragControls()
  return <Modal.Backdrop isOpen={open} onOpenChange={(next) => { if (!next) onClose() }} isDismissable
    className="!fixed !inset-0 !z-50 !items-end !bg-ink/40">
      <Modal.Container placement="bottom" className="!m-0 !p-0 !h-auto !flex-none !w-full !max-w-none !max-h-none !bg-transparent">
      <Modal.Dialog aria-label={tc('viewTrip')} className="!p-0 !rounded-t-panel !rounded-b-none !bg-ink !outline-none">
        <motion.div ref={(element) => { sheet.current = element; element?.closest('[role="dialog"]')?.setAttribute('aria-modal', 'true') }}
          initial={{ y: reduced ? 0 : '100%', opacity: 0 }} animate={{ y: 0, opacity: 1 }}
          transition={springs.drawer} drag="y" dragControls={dragControls} dragListener={false} dragConstraints={{ top: 0, bottom: 0 }} dragElastic={{ top: 0, bottom: 0.4 }}
          onDragEnd={(_event, info) => { if (shouldDismiss(info.offset.y, sheet.current?.clientHeight ?? 0)) onClose() }}
          data-on-ink className="flex h-[92dvh] flex-col overflow-hidden rounded-t-panel bg-ink">
          <div className="flex shrink-0 items-center justify-between gap-3 px-4 pt-3">
            <div aria-hidden data-testid="sheet-handle" onPointerDown={event => dragControls.start(event)} style={{ touchAction: 'none' }} className="flex h-11 flex-1 items-center justify-center">
              <span className="h-1 w-12 rounded-full bg-white/50" />
            </div>
            <PillButton variant="lime" iconOnly aria-label={t('close')} onClick={onClose}><X size={20} aria-hidden /></PillButton>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto" style={{ touchAction: 'pan-y' }}>{children}</div>
        </motion.div>
      </Modal.Dialog>
    </Modal.Container>
  </Modal.Backdrop>
}
