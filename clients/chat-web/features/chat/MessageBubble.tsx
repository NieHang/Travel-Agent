'use client'

import { useReducedMotion } from '@/lib/use-reduced-motion'

import type { Message, Requirement } from '@autix/contracts'
import { motion, type MotionProps } from 'motion/react'
import { useTranslations } from 'next-intl'
import { enter } from '@/lib/motion'
import { RequirementCards } from './RequirementCards'

function TypingDots({ label }: { label: string }) {
  return (
    <span role="status" aria-label={label} className="flex items-center gap-1 py-2">
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          aria-hidden
          style={{ animationDelay: `${i * 150}ms` }}
          className="block size-2 animate-bounce rounded-full bg-ink motion-reduce:animate-none"
        />
      ))}
    </span>
  )
}

export function MessageBubble({
  role,
  content,
  status = 'complete',
  requirements = [],
  typing = false,
}: {
  role: Message['role']
  content: string
  status?: Message['status']
  requirements?: Requirement[]
  /** 正在生成且首个字还没到：显示三点跳动 */
  typing?: boolean
}) {
  const t = useTranslations('chat')
  const reduced = useReducedMotion() ?? false
  const isUser = role === 'USER'
  const label = status === 'partial' ? t('stopped') : status === 'error' ? t('failed') : null

  return (
    <motion.div
      {...(enter(0, reduced) as MotionProps)}
      className={`flex flex-col gap-2 ${isUser ? 'items-end' : 'items-start'}`}
    >
      {typing ? (
        <div data-bubble className="rounded-card bg-paper px-4 py-2 text-ink">
          <TypingDots label={t('typing')} />
        </div>
      ) : content ? (
        <div
          data-bubble
          style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}
          className={`max-w-[85%] rounded-card px-4 py-3 text-base ${
            isUser ? 'bg-ink text-white' : 'bg-paper text-ink'
          }`}
        >
          {content}
        </div>
      ) : null}
      {label ? <span className="px-2 text-xs font-bold text-ink">{label}</span> : null}
      {isUser ? null : <RequirementCards requirements={requirements} />}
    </motion.div>
  )
}
