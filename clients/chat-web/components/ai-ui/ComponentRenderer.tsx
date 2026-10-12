'use client'
import { ComponentSchema, type Command } from '@autix/contracts'
import { ButtonsRow } from './ButtonsRow'
import { ChoiceCard } from './ChoiceCard'
import { RequirementsForm } from './RequirementsForm'
import { ResultCard } from './ResultCard'

export interface ComponentRendererProps {
  component: unknown
  onCommand: (command: Command) => void
  disabled?: boolean
}

/** Components saved by the old protocol: show their text, never their controls. */
function LegacyComponent({ component }: { component: unknown }) {
  const c = (component ?? {}) as Record<string, unknown>
  const parts = [c.title, c.description, c.content].filter((v): v is string => typeof v === 'string' && v.trim() !== '')
  if (!parts.length) return null
  return <div className="space-y-1 text-sm">{parts.map((p, i) => <p key={i} className={i === 0 ? 'font-bold' : 'whitespace-pre-wrap'}>{p}</p>)}</div>
}

export function ComponentRenderer({ component, onCommand, disabled = false }: ComponentRendererProps) {
  const parsed = ComponentSchema.safeParse(component)
  if (!parsed.success) return <LegacyComponent component={component} />
  const c = parsed.data
  const interactive = { onCommand, disabled }
  switch (c.type) {
    case 'choice':
      return <ChoiceCard component={c} {...interactive} />
    case 'form':
      return <RequirementsForm component={c} {...interactive} />
    case 'buttons':
      return <ButtonsRow component={c} {...interactive} />
    case 'cards':
      return <div className="grid gap-3 sm:grid-cols-2">{c.items.map((item) => <ResultCard key={item.ref} item={item} />)}</div>
  }
}
