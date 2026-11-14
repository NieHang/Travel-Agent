'use client'
import { ComponentSchema, type Command } from '@autix/contracts'
import { ButtonsRow } from './ButtonsRow'
import { ChoiceCard } from './ChoiceCard'
import { TripSentence } from './requirements/TripSentence'
import { ResultCard } from './ResultCard'

/** How a component may behave: only `live` can send commands; `answered` shows what the user chose. */
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
  switch (c.type) {
    case 'choice':
      return <ChoiceCard component={c} onCommand={mode.kind === 'live' ? mode.onCommand : () => {}} disabled={mode.kind !== 'live'} />
    case 'form':
      return <TripSentence component={c} mode={mode} />
    case 'buttons':
      return <ButtonsRow component={c} mode={mode} />
    case 'cards':
      return <div className="grid gap-3 sm:grid-cols-2">{c.items.map((item) => <ResultCard key={item.ref} item={item} />)}</div>
  }
}
