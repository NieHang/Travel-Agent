'use client'
import { Button, Disclosure } from '@heroui/react'
import type { Message, TraceVerification } from '@autix/contracts'
import { AnimatePresence, motion } from 'motion/react'
import { useFormatter, useTranslations } from 'next-intl'
import { IconSwap } from '@/components/ui/IconSwap'
import { enter, springs } from '@/lib/motion'
import { useReducedMotion } from '@/lib/use-reduced-motion'
import type { TraceStep } from '@/stores/ai-ui.store'

export type ReplyTraceData = {
  steps: TraceStep[]
  /** Absent while the reply is still streaming. */
  endedAt?: string
  verification?: TraceVerification
}

export type ReplyStatus = Message['status'] | 'running'

/**
 * How a reply was produced, inside its bubble. While running with no text yet it lists the
 * phases reached so far; once text streams in, or the reply is saved, it folds into one line
 * that expands to the same list plus the paid-tier verification detail when the server sent it.
 */
export function ReplyTrace({
  trace,
  status,
  folded,
  onResume,
}: {
  trace: ReplyTraceData | null
  status: ReplyStatus
  folded: boolean
  onResume?: () => void
}) {
  const t = useTranslations('chat.trace')
  const reduced = useReducedMotion() ?? false
  const steps = trace?.steps ?? []
  const last = steps.at(-1)

  if (!folded && status === 'running') {
    return (
      <ol role="status" aria-live="polite" className="flex flex-col gap-1">
        <AnimatePresence initial={false}>
          {steps.map((step, i) => (
            <StepRow key={step.phase + step.at} step={step} next={steps[i + 1]} endedAt={trace?.endedAt} active={i === steps.length - 1} animateIn reduced={reduced} />
          ))}
        </AnimatePresence>
      </ol>
    )
  }

  const summary = summarize()
  const detail = steps.length > 1 || trace?.verification
  return (
    <motion.div layout={!reduced} transition={springs.smooth} className="flex items-center gap-2">
      {detail ? (
        <Disclosure className="min-w-0 flex-1">
          <Disclosure.Heading>
            <Disclosure.Trigger className="flex items-center gap-1 text-[13px] text-trip-muted hover:text-trip-ink">
              <Summary text={summary} status={status} />
              <Disclosure.Indicator className="ms-0" />
            </Disclosure.Trigger>
          </Disclosure.Heading>
          <Disclosure.Content>
            <Disclosure.Body className="px-0 pt-2 pb-0">
              <ol className="flex flex-col gap-1">
                {steps.map((step, i) => (
                  <StepRow key={step.phase + step.at} step={step} next={steps[i + 1]} endedAt={trace?.endedAt} active={false} interrupted={i === steps.length - 1 && status !== 'complete' && status !== 'running'} animateIn={false} reduced={reduced} />
                ))}
              </ol>
              {trace?.verification ? <Verification data={trace.verification} /> : null}
            </Disclosure.Body>
          </Disclosure.Content>
        </Disclosure>
      ) : (
        <span className="min-w-0 flex-1 text-[13px] text-trip-muted">
          <Summary text={summary} status={status} />
        </span>
      )}
      {onResume ? (
        <Button size="sm" variant="ghost" onPress={onResume} className="shrink-0 text-trip-ink">
          {status === 'error' ? t('retry') : t('resume')}
        </Button>
      ) : null}
    </motion.div>
  )

  function summarize(): string {
    const phase = last ? t(`phase.${last.phase}`) : null
    switch (status) {
      case 'running':
        return phase ?? ''
      case 'partial':
        return phase ? t('stopped', { phase }) : t('stoppedPlain')
      case 'error':
        return phase ? t('failed', { phase }) : t('failedPlain')
      case 'complete':
        return trace?.endedAt && steps[0] ? t('took', { duration: t('seconds', { n: secondsBetween(steps[0].at, trace.endedAt) }) }) : ''
    }
  }
}

/** One decimal under ten seconds, whole seconds above. */
function secondsBetween(from: string, to: string): number {
  const s = (Date.parse(to) - Date.parse(from)) / 1000
  return s < 10 ? Math.max(0.1, Math.round(s * 10) / 10) : Math.round(s)
}

function Summary({ text, status }: { text: string; status: ReplyStatus }) {
  return <span className={status === 'running' ? 'trace-shimmer' : status === 'error' ? 'text-danger' : undefined}>{text}</span>
}

function StepRow({ step, next, endedAt, active, interrupted = false, animateIn, reduced }: {
  step: TraceStep
  next: TraceStep | undefined
  endedAt: string | undefined
  active: boolean
  interrupted?: boolean
  animateIn: boolean
  reduced: boolean
}) {
  const t = useTranslations('chat.trace')
  const end = next?.at ?? endedAt
  const duration = !active && end ? secondsBetween(step.at, end) : null
  const mark = active ? 'spin' : interrupted ? 'stop' : 'done'
  return (
    <motion.li {...(animateIn ? enter(0, reduced) : {})} className="flex items-center gap-2 text-[13px]">
      <span className="grid size-4 shrink-0 place-items-center" aria-hidden>
        <IconSwap swapKey={mark}>
          {mark === 'spin' ? (
            <span className="block size-3.5 animate-spin rounded-full border-2 border-trip-line border-t-trip-ink motion-reduce:animate-none" />
          ) : mark === 'stop' ? (
            <span className="block size-2.5 rounded-xs bg-trip-muted" />
          ) : (
            <Check draw={animateIn && !reduced} />
          )}
        </IconSwap>
      </span>
      <span className={active ? 'trace-shimmer' : 'text-trip-muted'}>{t(`phase.${step.phase}`)}</span>
      {duration !== null && !interrupted ? (
        <span className="text-xs text-trip-muted tabular-nums">
          {t('seconds', { n: duration })}
        </span>
      ) : null}
    </motion.li>
  )
}

function Check({ draw }: { draw: boolean }) {
  return (
    <svg viewBox="0 0 16 16" className="size-4 text-trip-ink">
      <motion.path
        d="M3.5 8.5l3 3 6-7"
        fill="none"
        stroke="currentColor"
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
        initial={draw ? { pathLength: 0 } : false}
        animate={{ pathLength: 1 }}
        transition={{ duration: 0.28, ease: 'easeOut' }}
      />
    </svg>
  )
}

/** One city's usual read (its directory page, a few areas, a few sights) fits in about two lines. */
const READING_SHOWN = 8

function Verification({ data }: { data: TraceVerification }) {
  const t = useTranslations('chat.trace')
  const format = useFormatter()
  if (!data.lookups.length && !data.reading.length && !data.grounding) return null
  const titles = data.reading.slice(0, READING_SHOWN).map((page) => page.title)
  const hidden = data.reading.length - titles.length
  return (
    <div className="mt-3 flex flex-col gap-1 border-t border-trip-line pt-3 text-[13px]">
      <span className="text-xs font-semibold text-trip-muted">{t('verification')}</span>
      <ul className="flex flex-col gap-1 text-trip-muted">
        {titles.length ? (
          <li>{t('reading', { pages: format.list(hidden ? [...titles, t('readingMore', { n: hidden })] : titles) })}</li>
        ) : null}
        {data.lookups.map((lookup, i) => (
          <li key={i} className={lookup.ok ? undefined : 'text-danger'}>
            {t('lookup', {
              subject: lookup.subject ?? lookup.tool,
              time: format.dateTime(new Date(lookup.at), { hour: '2-digit', minute: '2-digit' }),
            })}
            {lookup.ok ? (lookup.count !== null ? ` · ${t('lookupCount', { n: lookup.count })}` : '') : ` · ${t('lookupFailed')}`}
          </li>
        ))}
        {data.grounding ? <li>{t('grounding', data.grounding)}</li> : null}
      </ul>
    </div>
  )
}
