'use client'

export function Skeleton({ className = '' }: { className?: string }) {
  return (
    <span
      aria-hidden
      className={`block animate-pulse rounded-full bg-trip-fill motion-reduce:animate-none ${className}`}
    />
  )
}
