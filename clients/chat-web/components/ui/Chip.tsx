'use client'

import { useReducedMotion } from '@/lib/use-reduced-motion'

import { motion } from 'motion/react'
import type { ReactNode } from 'react'
import { springs } from '@/lib/motion'

/** `paper` sits on the landing page's colour; `outline` on the trip screen's ground. */
const LOOK = {
  paper: 'bg-paper text-sm font-bold text-ink',
  outline: 'border border-trip-line text-[13px] font-medium text-trip-ink',
}

export function Chip({
  icon,
  variant = 'paper',
  onClick,
  children,
}: {
  icon?: ReactNode
  variant?: keyof typeof LOOK
  onClick: () => void
  children: ReactNode
}) {
  const reduced = useReducedMotion()
  return (
    <motion.button
      type="button"
      onClick={onClick}
      whileHover={reduced ? undefined : { scale: 1.03 }}
      whileTap={reduced ? undefined : { scale: 0.96 }}
      transition={springs.snappy}
      className={`inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-full px-4 ${LOOK[variant]}`}
    >
      {icon ? <span aria-hidden className="flex shrink-0">{icon}</span> : null}
      {children}
    </motion.button>
  )
}
