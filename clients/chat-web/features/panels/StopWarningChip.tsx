'use client'

import { Chip, Link, Popover, Tooltip } from '@heroui/react'
import type { StopWarning } from '@autix/contracts'
import { useFormatter, useTranslations } from 'next-intl'

/**
 * A stop the server could not make work as planned. Hover and keyboard focus preview the notes in a
 * tooltip; a press (click, tap, Enter) opens them with their sources in a popover, because a tooltip
 * cannot hold links.
 */
export function StopWarningChip({ name, warning }: { name: string; warning: StopWarning }) {
  const t = useTranslations('panels.live.warning')
  const format = useFormatter()
  return (
    <Popover>
      <Tooltip delay={0} closeDelay={0}>
        <Popover.Trigger tabIndex={0} className="shrink-0 rounded-2xl">
          {/* The panel is ink; HeroUI's dark tokens are the ones drawn for that surface. */}
          <Chip data-theme="dark" color="warning" variant="soft">{t('label')}</Chip>
        </Popover.Trigger>
        <Tooltip.Content placement="top end" className="flex flex-col gap-1 break-normal">
          {warning.notes.map((note, i) => <p key={i}>{note.text}</p>)}
        </Tooltip.Content>
      </Tooltip>
      <Popover.Content placement="bottom end" className="max-w-xs">
        <Popover.Dialog aria-label={name}>
          <ul className="flex flex-col gap-3">
            {warning.notes.map((note, i) => (
              <li key={i} className="flex flex-col gap-1">
                <p>{note.text}</p>
                <p className="flex flex-wrap items-center gap-x-2 text-xs text-muted">
                  {/* A calendar date: read and shown in UTC so no time zone moves it a day. */}
                  <span>{t('checkedOn', { date: format.dateTime(new Date(note.checkedOn), { dateStyle: 'medium', timeZone: 'UTC' }) })}</span>
                  <Link href={note.source} target="_blank" rel="noopener noreferrer">
                    {t('source')}
                    <Link.Icon />
                  </Link>
                </p>
              </li>
            ))}
          </ul>
        </Popover.Dialog>
      </Popover.Content>
    </Popover>
  )
}
