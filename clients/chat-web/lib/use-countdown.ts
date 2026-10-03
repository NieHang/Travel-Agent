import { useCallback, useEffect, useState } from 'react'

/** 每秒减一的倒计时；start 可在任意时刻重新开始。 */
export function useCountdown(): { seconds: number; start(seconds: number): void } {
  const [seconds, setSeconds] = useState(0)

  useEffect(() => {
    if (seconds <= 0) return
    const timer = setTimeout(() => setSeconds((s) => Math.max(0, s - 1)), 1000)
    return () => clearTimeout(timer)
  }, [seconds])

  const start = useCallback((n: number) => setSeconds(Math.max(0, Math.ceil(n))), [])
  return { seconds, start }
}
