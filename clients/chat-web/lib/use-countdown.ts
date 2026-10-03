import { useCallback, useEffect, useState } from 'react'

export const COUNTDOWN_MAX_SECONDS = 3600

/** 每秒减一的倒计时；start 可在任意时刻重新开始，非有限或非正数的输入被忽略，上限 3600。 */
export function useCountdown(): { seconds: number; start(seconds: number): void } {
  const [seconds, setSeconds] = useState(0)

  useEffect(() => {
    if (seconds <= 0) return
    const timer = setTimeout(() => setSeconds((s) => Math.max(0, s - 1)), 1000)
    return () => clearTimeout(timer)
  }, [seconds])

  const start = useCallback((n: number) => {
    if (!Number.isFinite(n) || n <= 0) return
    setSeconds(Math.min(COUNTDOWN_MAX_SECONDS, Math.ceil(n)))
  }, [])
  return { seconds, start }
}
