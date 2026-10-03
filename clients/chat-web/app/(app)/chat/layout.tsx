import type { ReactNode } from 'react'
import { ChatScreen } from '@/features/chat/ChatScreen'

export default function ChatLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <ChatScreen />
      {children}
    </>
  )
}
