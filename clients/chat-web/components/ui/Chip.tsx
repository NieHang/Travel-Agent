'use client'

import { useReducedMotion } from '@/lib/use-reduced-motion'

import { motion } from 'motion/react'
import type { ReactNode } from 'react'
import { springs } from '@/lib/motion'

export function Chip({
  icon,
  onClick,
  children,
}: {
  icon?: ReactNode
  onClick(): void
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
      className="inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-full bg-paper px-4 text-sm font-bold text-ink"
    >
      {icon ? <span aria-hidden className="flex shrink-0">{icon}</span> : null}
      {children}
    </motion.button>
  )
}
