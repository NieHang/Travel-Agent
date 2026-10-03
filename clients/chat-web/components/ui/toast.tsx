'use client'

import { Toast, toast as heroToast } from '@heroui/react'

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
      {({ toast: item }) => {
        const danger = item.content?.variant === 'danger'
        return (
          <Toast
            toast={item}
            variant={item.content?.variant}
            data-on-ink={danger ? undefined : true}
            className={`rounded-full px-6 shadow-float ${
              danger ? 'bg-danger text-ink' : 'bg-ink text-white'
            }`}
          >
            <Toast.Content>
              <Toast.Title className="text-inherit">
                {item.content?.title}
              </Toast.Title>
            </Toast.Content>
          </Toast>
        )
      }}
    </Toast.Provider>
  )
}
