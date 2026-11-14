'use client'
import { memo } from 'react'
import { ComponentRenderer, type ComponentMode } from '@/components/ai-ui/ComponentRenderer'
import { Markdown } from '@/components/ui/Markdown'

import { useReducedMotion } from '@/lib/use-reduced-motion'

import type { Message } from '@autix/contracts'
import { motion, type MotionProps } from 'motion/react'
import { useTranslations } from 'next-intl'
import { enter } from '@/lib/motion'

function TypingDots({ label }: { label: string }) {
  return (
    <span
      role="status"
      aria-label={label}
      className="flex items-center gap-1 py-2"
    >
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

const LOCKED: ComponentMode = { kind: 'locked' }

export const MessageBubble = memo(function MessageBubble({
  role,
  content,
  status = 'complete',
  typing = false,
  components = [],
  mode = LOCKED,
}: {
  components?: unknown[]
  /** How this message's components behave; locked unless the list says otherwise. */
  mode?: ComponentMode
  role: Message['role']
  content: string
  status?: Message['status']
  /** 正在生成且首个字还没到：显示三点跳动 */
  typing?: boolean
}) {
  const t = useTranslations('chat')
  const reduced = useReducedMotion() ?? false
  const isUser = role === 'USER'
  const label =
    status === 'partial'
      ? t('stopped')
      : status === 'error'
        ? t('failed')
        : null

  return (
    <motion.div
      {...(enter(0, reduced) as MotionProps)}
      className={`flex flex-col gap-2 ${isUser ? 'items-end' : 'items-start'}`}
    >
      {isUser ? (
        content ? (
          <div
            data-bubble
            style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}
            className="max-w-[85%] rounded-card bg-ink px-4 py-3 text-base text-white"
          >
            {content}
          </div>
        ) : null
      ) : typing || content || components.length ? (
        // One bubble per reply: the text, then its components. It hugs its content;
        // components may widen it a little past a text-only reply. empty:hidden covers
        // a reply whose only components have been answered and step aside.
        <div
          data-bubble
          className={`flex flex-col gap-3 rounded-card bg-paper px-4 py-3 text-base text-ink empty:hidden ${
            components.length ? 'max-w-[95%]' : 'max-w-[85%]'
          }`}
        >
          {typing ? <TypingDots label={t('typing')} /> : null}
          {content ? (
            <div style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>
              <Markdown content={content} />
            </div>
          ) : null}
          {components.map((c, i) => (
            <ComponentRenderer key={i} component={c} mode={mode} />
          ))}
        </div>
      ) : null}
      {label ? (
        <span className="px-2 text-xs font-bold text-ink">{label}</span>
      ) : null}
    </motion.div>
  )
})
