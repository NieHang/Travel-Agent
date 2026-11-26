'use client'

import { AnimatePresence, motion } from 'motion/react'
import type { ReactNode } from 'react'
import { springs } from '@/lib/motion'
import { useReducedMotion } from '@/lib/use-reduced-motion'

const FADE = { duration: 0.15, ease: 'easeOut' } as const

/** An icon changing state (DESIGN.md 7.2): the old one shrinks to 0.6 and fades out while the new one pops in from 0.6, in the same cell. */
export function IconSwap({ swapKey, children }: { swapKey: string; children: ReactNode }) {
  const reduced = useReducedMotion()
  const hidden = reduced ? { opacity: 0 } : { opacity: 0, scale: 0.6 }
  const shown = reduced ? { opacity: 1 } : { opacity: 1, scale: 1 }
  return (
    <span className="grid place-items-center">
      <AnimatePresence initial={false}>
        <motion.span
          key={swapKey}
          initial={hidden}
          animate={shown}
          exit={hidden}
          transition={{ scale: springs.snappy, opacity: FADE }}
          className="col-start-1 row-start-1 flex"
        >
          {children}
        </motion.span>
      </AnimatePresence>
    </span>
  )
}
