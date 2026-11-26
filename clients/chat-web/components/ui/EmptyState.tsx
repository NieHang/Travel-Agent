import type { LucideIcon } from 'lucide-react'
import type { ReactNode } from 'react'

export function EmptyState({ icon: Icon, title, action }: { icon: LucideIcon; title: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-trip-md border border-dashed border-trip-line px-6 py-8 text-center">
      <Icon size={24} aria-hidden className="text-trip-muted" />
      <p className="text-lg font-semibold">{title}</p>
      {action}
    </div>
  )
}
