'use client'

import { useReducedMotion } from '@/lib/use-reduced-motion'

import { motion } from 'motion/react'
import type { ReactNode, Ref } from 'react'
import { springs } from '@/lib/motion'

type Variant = 'ink' | 'lime' | 'pink' | 'ghost' | 'danger'
type Size = 'sm' | 'md' | 'lg'

const VARIANT: Record<Variant, string> = {
  ink: 'bg-ink text-white',
  lime: 'bg-lime text-ink',
  pink: 'bg-stage-pink text-ink',
  ghost: 'bg-transparent text-ink border-2 border-ink',
  danger: 'bg-danger text-ink',
}

// 每档都不小于 44px 触摸区域
const SIZE: Record<Size, string> = {
  sm: 'min-h-11 min-w-11 px-4 text-sm',
  md: 'min-h-12 min-w-12 px-6 text-base',
  lg: 'min-h-14 min-w-14 px-8 text-lg',
}

const ICON_SIZE: Record<Size, string> = {
  sm: 'size-11',
  md: 'size-12',
  lg: 'size-14',
}

export type PillButtonProps = {
  variant?: Variant
  size?: Size
  loading?: boolean
  disabled?: boolean
  iconOnly?: boolean
  'aria-label'?: string
  type?: 'button' | 'submit'
  onClick?: () => void
  autoFocus?: boolean
  ref?: Ref<HTMLButtonElement>
  children: ReactNode
}

export function PillButton({
  variant = 'ink',
  size = 'md',
  loading = false,
  disabled = false,
  iconOnly = false,
  type = 'button',
  onClick,
  autoFocus,
  ref,
  children,
  ...aria
}: PillButtonProps) {
  const reduced = useReducedMotion()
  const inert = disabled || loading
  const feedback = !inert && !reduced
  return (
    <motion.button
      ref={ref}
      type={loading ? 'button' : type}
      disabled={disabled}
      autoFocus={autoFocus}
      aria-label={aria['aria-label']}
      aria-busy={loading || undefined}
      aria-disabled={loading || undefined}
      onClick={inert ? undefined : onClick}
      whileHover={feedback ? { scale: 1.03 } : undefined}
      whileTap={feedback ? { scale: 0.96 } : undefined}
      transition={springs.snappy}
      className={`relative inline-flex items-center justify-center rounded-full font-bold whitespace-nowrap ${
        VARIANT[variant]
      } ${iconOnly ? ICON_SIZE[size] : SIZE[size]} ${
        disabled ? 'cursor-not-allowed opacity-40' : loading ? 'cursor-progress' : 'cursor-pointer'
      }`}
    >
      <span className={loading ? 'invisible' : undefined}>{children}</span>
      {loading ? (
        <span
          aria-hidden
          className="absolute size-5 animate-spin rounded-full border-2 border-current border-t-transparent motion-reduce:animate-none"
        />
      ) : null}
    </motion.button>
  )
}
