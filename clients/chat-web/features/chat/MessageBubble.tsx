'use client'
import { memo } from 'react'
import { ComponentRenderer, type ComponentMode } from '@/components/ai-ui/ComponentRenderer'
import { Markdown } from '@/components/ui/Markdown'

import { useReducedMotion } from '@/lib/use-reduced-motion'

import type { Message } from '@autix/contracts'
import { motion, type MotionProps } from 'motion/react'
import { enter } from '@/lib/motion'
import { ReplyTrace, type ReplyStatus, type ReplyTraceData } from './ReplyTrace'

const LOCKED: ComponentMode = { kind: 'locked' }

export const MessageBubble = memo(function MessageBubble({
  role,
  content,
  status = 'complete',
  trace = null,
  components = [],
  mode = LOCKED,
  onResume,
}: {
  components?: unknown[]
  /** How this message's components behave; locked unless the list says otherwise. */
  mode?: ComponentMode
  role: Message['role']
  content: string
  /** `running` for the reply still streaming. */
  status?: ReplyStatus
  trace?: ReplyTraceData | null
  /** Retry a failed reply or continue a stopped one. */
  onResume?: () => void
}) {
  const reduced = useReducedMotion() ?? false

  if (role === 'USER') {
    return (
      <motion.div {...(enter(0, reduced) as MotionProps)} className="flex flex-col items-end gap-2">
        {content ? (
          <div
            data-bubble
            style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}
            className="max-w-[80%] rounded-trip-sm rounded-br-trip-tail bg-trip-fill px-4 py-[11px] text-[15px]"
          >
            {content}
          </div>
        ) : null}
      </motion.div>
    )
  }

  // Completed replies without a trace (older messages, button turns) show no trace row.
  const showTrace = status !== 'complete' || (trace !== null && trace.steps.length > 1)
  return (
    <motion.div {...(enter(0, reduced) as MotionProps)} className="flex flex-col items-start gap-2">
      {showTrace || content || components.length ? (
        // One bubble per reply: how it was produced, the text, then its components. It hugs its
        // content; components may widen it a little past a text-only reply. empty:hidden covers
        // a reply whose only components have been answered and step aside.
        <div
          data-bubble
          className={`flex flex-col gap-3 rounded-trip-sm rounded-bl-trip-tail bg-white px-4 py-[11px] text-[15px] empty:hidden ${
            components.length ? 'max-w-[88%]' : 'max-w-[80%]'
          }`}
        >
          {showTrace ? (
            <ReplyTrace trace={trace} status={status} folded={status !== 'running' || content !== ''} onResume={onResume} />
          ) : null}
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
    </motion.div>
  )
})
