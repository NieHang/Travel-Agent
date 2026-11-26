'use client'
import type { Command, Component, TripType } from '@autix/contracts'

/** Without `onCommand` the options are read-only. */
export function ChoiceCard({ component, onCommand }: {
  component: Extract<Component, { type: 'choice' }>
  onCommand?: (command: Command) => void
}) {
  return (
    // The bubble hugs its content; a fixed width keeps single-column options from shrinking to their text.
    <section aria-label={component.title} className="flex w-72 max-w-full flex-col gap-3 sm:w-auto">
      <h3 className="text-[13px] font-medium text-trip-muted">{component.title}</h3>
      <div className="grid gap-2 sm:grid-cols-2">
        {component.options.map((option) => (
          <button
            key={option.value}
            type="button"
            disabled={!onCommand}
            className="min-h-11 rounded-[max(8px,calc(var(--radius-trip-sm)_-_16px))] border border-trip-line px-4 py-2.5 text-left text-[15px] font-semibold text-trip-ink transition-colors enabled:hover:border-trip-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-trip-ink disabled:cursor-not-allowed disabled:opacity-40"
            onClick={() =>
              onCommand?.(
                component.command === 'set_trip_type'
                  ? { type: 'set_trip_type', value: option.value as TripType }
                  : { type: 'set_destination', value: option.value },
              )
            }
          >
            <span className="block">{option.label}</span>
            {option.description ? <span className="mt-0.5 block text-[13px] font-normal text-trip-muted">{option.description}</span> : null}
          </button>
        ))}
      </div>
    </section>
  )
}
