'use client'

import { useReducedMotion } from '@/lib/use-reduced-motion'

import { motion } from 'motion/react'
import { useTranslations } from 'next-intl'
import { LogoDot } from './Logo'

export function BrandLoader() {
  const t = useTranslations('common')
  const reduced = useReducedMotion()
  return (
    <div
      role="status"
      aria-label={t('brand')}
      className="fixed inset-0 z-50 flex items-center justify-center bg-stage-yellow"
    >
      <motion.span
        aria-hidden
        className="block"
        animate={reduced ? { opacity: [1, 0.5, 1] } : { scale: [1, 1.5, 1] }}
        transition={{ duration: 1.2, repeat: Infinity, ease: 'easeInOut' }}
      >
        <LogoDot className="bg-lime" />
      </motion.span>
    </div>
  )
}
