'use client'
import { ComponentSchema, type Command } from '@autix/contracts'
import { ButtonsRow } from './ButtonsRow'
import { ChoiceCard } from './ChoiceCard'
import { TripSentence } from './requirements/TripSentence'
import { ResultCard } from './ResultCard'

/**
 * How a component may behave: only `live` can send commands. Once `answered`, the
 * user's reply right below already says what they chose, so controls step aside.
 */
export type ComponentMode =
  | { kind: 'live'; onCommand: (command: Command) => void }
  | { kind: 'locked' }
  | { kind: 'answered'; command: Command }

export interface ComponentRendererProps {
  component: unknown
  mode: ComponentMode
}

/** Components saved by the old protocol: show their text, never their controls. */
function LegacyComponent({ component }: { component: unknown }) {
  const c = (component ?? {}) as Record<string, unknown>
  const parts = [c.title, c.description, c.content].filter((v): v is string => typeof v === 'string' && v.trim() !== '')
  if (!parts.length) return null
  return <div className="space-y-1 text-sm">{parts.map((p, i) => <p key={i} className={i === 0 ? 'font-bold' : 'whitespace-pre-wrap'}>{p}</p>)}</div>
}

export function ComponentRenderer({ component, mode }: ComponentRendererProps) {
  const parsed = ComponentSchema.safeParse(component)
  if (!parsed.success) return <LegacyComponent component={component} />
  const c = parsed.data
  if (mode.kind === 'answered' && c.type !== 'cards') return null
  switch (c.type) {
    case 'choice':
      return <ChoiceCard component={c} onCommand={mode.kind === 'live' ? mode.onCommand : undefined} />
    case 'form':
      return <TripSentence component={c} onCommand={mode.kind === 'live' ? mode.onCommand : undefined} />
    case 'buttons':
      return <ButtonsRow component={c} onCommand={mode.kind === 'live' ? mode.onCommand : undefined} />
    case 'cards':
      return <div className="grid gap-3 sm:grid-cols-2">{c.items.map((item) => <ResultCard key={item.ref} item={item} />)}</div>
  }
}
