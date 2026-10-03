import { act, renderHook } from '@testing-library/react'
import { useCountdown } from './use-countdown'

beforeEach(() => {
  vi.useFakeTimers()
})
afterEach(() => {
  vi.useRealTimers()
})

it('start(NaN) 与非正数：seconds 保持 0，不排定计时器', () => {
  const { result } = renderHook(() => useCountdown())
  for (const bad of [NaN, Infinity, -Infinity, 0, -3]) {
    act(() => result.current.start(bad))
    expect(result.current.seconds).toBe(0)
  }
  expect(vi.getTimerCount()).toBe(0)
})

it('上限 3600', () => {
  const { result } = renderHook(() => useCountdown())
  act(() => result.current.start(999999))
  expect(result.current.seconds).toBe(3600)
})

it('start(5) 后卸载不留计时器', () => {
  const { result, unmount } = renderHook(() => useCountdown())
  act(() => result.current.start(5))
  expect(result.current.seconds).toBe(5)
  unmount()
  expect(vi.getTimerCount()).toBe(0)
})

it('每秒减一直到 0', () => {
  const { result } = renderHook(() => useCountdown())
  act(() => result.current.start(2))
  act(() => {
    vi.advanceTimersByTime(1000)
  })
  expect(result.current.seconds).toBe(1)
  act(() => {
    vi.advanceTimersByTime(1000)
  })
  expect(result.current.seconds).toBe(0)
  expect(vi.getTimerCount()).toBe(0)
})
