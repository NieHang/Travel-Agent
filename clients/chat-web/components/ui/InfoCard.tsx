'use client'

import type { ReactNode } from 'react'

export function InfoCard({
  icon,
  title,
  subtitle,
  time,
}: {
  icon?: ReactNode
  title: string
  subtitle?: string
  time?: string
}) {
  return (
    <div className="flex items-start gap-3 rounded-card bg-paper p-4 text-ink">
      {icon ? (
        <span
          aria-hidden
          className="flex size-10 shrink-0 items-center justify-center rounded-full bg-lime"
        >
          {icon}
        </span>
      ) : null}
      <div className="min-w-0 flex-1">
        <p className="truncate text-base font-bold">{title}</p>
        {subtitle ? <p className="truncate text-sm">{subtitle}</p> : null}
      </div>
      {time ? <span className="shrink-0 text-xs font-bold">{time}</span> : null}
    </div>
  )
}
