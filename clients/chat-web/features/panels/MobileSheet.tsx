'use client'

import { useReducedMotion } from '@/lib/use-reduced-motion'
import { Modal } from '@heroui/react'
import { motion, useDragControls } from 'motion/react'
import { X } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { createContext, useCallback, useRef, useState, type ReactNode, type RefObject } from 'react'
import { PillButton } from '@/components/ui/PillButton'
import { springs } from '@/lib/motion'

const DISMISS_RATIO = 0.25
const SHEET_STRIP_PX = 76

export const SheetCover = createContext<RefObject<HTMLDivElement | null> | null>(null)

export function shouldDismiss(dragOffsetY: number, sheetHeight: number): boolean {
  return sheetHeight > 0 && dragOffsetY > sheetHeight * DISMISS_RATIO
}
export function MobileSheet({ open, onClose, children }: { open: boolean; onClose: () => void; children: ReactNode }) {
  const t = useTranslations('common'), tc = useTranslations('chat'), reduced = useReducedMotion()
  const sheet = useRef<HTMLDivElement>(null)
  const cover = useRef<HTMLDivElement>(null)
  const dragControls = useDragControls()
  const [solid, setSolid] = useState(false)
  const watchCover = useCallback((scroll: HTMLDivElement | null) => {
    const target = cover.current
    if (!scroll || !target) return
    const observer = new IntersectionObserver((entries) => {
      const entry = entries.at(-1)
      if (entry) setSolid(!entry.isIntersecting)
    }, { root: scroll, rootMargin: `-${SHEET_STRIP_PX}px 0px 0px 0px` })
    observer.observe(target)
    return () => {
      observer.disconnect()
      setSolid(false)
    }
  }, [])
  return <Modal.Backdrop isOpen={open} onOpenChange={(next) => { if (!next) onClose() }} isDismissable
    className="!fixed !inset-0 !z-50 !items-end !bg-trip-scrim">
      <Modal.Container placement="bottom" className="!m-0 !p-0 !h-auto !flex-none !w-full !max-w-none !max-h-none !bg-transparent">
      <Modal.Dialog aria-label={tc('viewTrip')} className="!p-0 !rounded-t-trip-panel !rounded-b-none !bg-trip-panel !outline-none">
        <motion.div ref={(element) => { sheet.current = element; element?.closest('[role="dialog"]')?.setAttribute('aria-modal', 'true') }}
          initial={{ y: reduced ? 0 : '100%', opacity: 0 }} animate={{ y: 0, opacity: 1 }}
          transition={springs.drawer} drag="y" dragControls={dragControls} dragListener={false} dragConstraints={{ top: 0, bottom: 0 }} dragElastic={{ top: 0, bottom: 0.4 }}
          onDragEnd={(_event, info) => { if (shouldDismiss(info.offset.y, sheet.current?.clientHeight ?? 0)) onClose() }}
          className="relative flex h-[92dvh] flex-col overflow-hidden rounded-t-trip-panel bg-trip-panel font-trip text-trip-ink">
          <div aria-hidden data-testid="sheet-bar"
            className={`pointer-events-none absolute inset-x-0 top-0 z-10 h-sheet-strip bg-trip-panel transition-opacity duration-150 ease-out ${solid ? 'opacity-100' : 'opacity-0'}`} />
          <div aria-hidden data-testid="sheet-handle" onPointerDown={event => dragControls.start(event)} style={{ touchAction: 'none' }}
            className="absolute top-4 left-1/2 z-10 flex h-11 w-24 -translate-x-1/2 items-center justify-center">
            <span className={`h-1 w-12 rounded-full transition-colors duration-150 ease-out ${solid ? 'bg-trip-line' : 'bg-white shadow-trip-label'}`} />
          </div>
          <div className="absolute top-4 left-4 z-10">
            <PillButton variant="trip-white" iconOnly size="sm" aria-label={t('close')} onClick={onClose}><X size={20} aria-hidden /></PillButton>
          </div>
          <div ref={watchCover} data-testid="sheet-scroll" className="min-h-0 flex-1 overflow-y-auto" style={{ touchAction: 'pan-y' }}>
            <SheetCover value={cover}>{children}</SheetCover>
          </div>
        </motion.div>
      </Modal.Dialog>
    </Modal.Container>
  </Modal.Backdrop>
}
