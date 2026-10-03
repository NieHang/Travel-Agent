import type { ReactNode } from 'react'
import { AuthGate } from '@/features/auth/AuthGate'

export default function AppLayout({ children }: { children: ReactNode }) {
  return <AuthGate>{children}</AuthGate>
}
