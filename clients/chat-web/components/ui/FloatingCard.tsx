'use client'

import { motion, useReducedMotion } from 'motion/react'
import type { ReactNode } from 'react'
import { springs } from '@/lib/motion'

/** 落地页装饰卡片：纯装饰，对读屏隐藏、不可聚焦；减少动态效果时不旋转不漂浮，只淡入。 */
export function FloatingCard({
  rotate,
  delay,
  className = '',
  children,
}: {
  rotate: number
  delay: number
  className?: string
  children: ReactNode
}) {
  const reduced = useReducedMotion()
  return (
    <motion.div
      aria-hidden
      inert
      className={`rounded-card bg-paper p-4 text-ink shadow-float ${className}`}
      initial={{ opacity: 0, rotate: reduced ? 0 : rotate }}
      animate={{ opacity: 1, rotate: reduced ? 0 : rotate }}
      transition={{ ...springs.gentle, delay }}
    >
      <motion.div
        animate={reduced ? undefined : { y: [0, -8, 0] }}
        transition={{ duration: 6, repeat: Infinity, ease: 'easeInOut', delay }}
      >
        {children}
      </motion.div>
    </motion.div>
  )
}
