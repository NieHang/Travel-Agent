'use client'
import { useEffect, useState } from 'react'
import { motion } from 'motion/react'
import { useTranslations } from 'next-intl'
import type { ProgressPayload } from '@autix/contracts'
import type { StreamOutcome } from '@/stores/ai-ui.store'
import { useReducedMotion } from '@/lib/use-reduced-motion'

export function StreamProgress({
  progress,
  outcome,
}: {
  progress: ProgressPayload | null
  outcome: StreamOutcome
}) {
  const t = useTranslations('chat.progress')
  const reduced = useReducedMotion()
  const [hidden, setHidden] = useState(false)
  useEffect(() => {
    setHidden(false)
    if (outcome !== 'completed') return
    const timer = setTimeout(() => setHidden(true), 1750)
    return () => clearTimeout(timer)
  }, [outcome])
  if (!progress || hidden) return null
  const complete = outcome === 'completed'
  const value = complete
    ? 100
    : Math.min(
        99,
        Math.floor(
          ((progress.step - (progress.status === 'completed' ? 0 : 1)) /
            progress.totalSteps) *
            100,
        ),
      )
  const phase = ['understand', 'generate', 'panels', 'save'].includes(
    progress.agent,
  )
    ? progress.agent
    : 'understand'
  const label =
    outcome === 'failed'
      ? t('failed')
      : outcome === 'cancelled'
        ? t('cancelled')
        : complete
          ? t('completed')
          : t(phase)
  const circumference = 2 * Math.PI * 42
  return (
    <div
      className="flex items-center gap-3 px-2 py-2"
      role="status"
      aria-live="polite"
    >
      <div
        role="progressbar"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={value}
        className="relative size-20 shrink-0 overflow-hidden rounded-full bg-paper shadow-md"
      >
        <svg
          viewBox="0 0 100 100"
          className="absolute inset-0 size-full -rotate-90"
          aria-hidden
        >
          <circle
            cx="50"
            cy="50"
            r="42"
            fill="none"
            stroke="#ede8ff"
            strokeWidth="7"
          />
          <circle
            cx="50"
            cy="50"
            r="42"
            fill="none"
            stroke="#8057ff"
            strokeWidth="7"
            strokeLinecap="round"
            strokeDasharray={circumference}
            strokeDashoffset={circumference * (1 - value / 100)}
            style={{
              transition: reduced ? 'none' : 'stroke-dashoffset 200ms ease',
            }}
          />
        </svg>
        <span className="absolute inset-0 flex items-center justify-center text-lg font-extrabold text-ink">
          {value}%
        </span>
        {complete && (
          <motion.div
            data-testid="progress-fill"
            className="absolute inset-0 flex items-center justify-center rounded-full bg-[#8057ff]"
            initial={
              reduced
                ? false
                : { clipPath: 'polygon(100% 100%, 100% 100%, 100% 100%)' }
            }
            animate={{ clipPath: 'polygon(-100% 100%, 100% -100%, 100% 100%)' }}
            transition={{ duration: reduced ? 0 : 0.35, ease: 'easeOut' }}
          >
            <motion.svg
              data-testid="progress-check"
              viewBox="0 0 48 48"
              className="size-10 text-white"
              aria-hidden
              initial={reduced ? false : { scale: 0, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={{
                duration: reduced ? 0 : 0.2,
                delay: reduced ? 0 : 0.15,
                type: 'spring',
                bounce: 0.35,
              }}
            >
              <path
                d="m11 25 9 9 18-20"
                fill="none"
                stroke="currentColor"
                strokeWidth="6"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </motion.svg>
          </motion.div>
        )}
      </div>
      <span className="text-sm font-bold text-ink">{label}</span>
    </div>
  )
}
