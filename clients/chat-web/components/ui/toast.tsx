'use client'

import { Toast, toast as heroToast } from '@heroui/react'
import { CircleAlert } from 'lucide-react'

export function toast(
  message: string,
  opts: { tone?: 'default' | 'danger' } = {},
): void {
  heroToast(<span role="status">{message}</span>, {
    variant: opts.tone === 'danger' ? 'danger' : 'default',
  })
}

export function Toaster() {
  return (
    <Toast.Provider placement="bottom">
      {({ toast: item }) => (
        <Toast
          toast={item}
          variant={item.content?.variant}
          className="rounded-full bg-trip-ink px-6 font-trip text-white shadow-trip-card"
        >
          {item.content?.variant === 'danger' ? (
            <CircleAlert size={16} aria-hidden className="shrink-0 self-center text-danger" />
          ) : null}
          <Toast.Content>
            <Toast.Title className="text-inherit">
              {item.content?.title}
            </Toast.Title>
          </Toast.Content>
        </Toast>
      )}
    </Toast.Provider>
  )
}
