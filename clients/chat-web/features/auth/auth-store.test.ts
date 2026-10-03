import { renderHook, act } from '@testing-library/react'
import { makeUser } from '@/test/fixtures'
import { authStore, useAuth } from './auth-store'

beforeEach(() => authStore.reset())

it('初始为 loading', () => expect(authStore.getState()).toEqual({ status: 'loading' }))

it('subscribe 在每次状态变化时通知一次，取消订阅后不再通知', () => {
  const listener = vi.fn()
  const off = authStore.subscribe(listener)
  authStore.setAuthed({ accessToken: 't', user: makeUser() })
  expect(listener).toHaveBeenCalledTimes(1)
  authStore.setUser(makeUser({ nickname: 'New' }))
  expect(listener).toHaveBeenCalledTimes(2)
  authStore.setGuest()
  expect(listener).toHaveBeenCalledTimes(3)
  off()
  authStore.reset()
  expect(listener).toHaveBeenCalledTimes(3)
})

it('setUser 在 authed 时更新用户并保留 token', () => {
  authStore.setAuthed({ accessToken: 't', user: makeUser() })
  authStore.setUser(makeUser({ nickname: 'New' }))
  expect(authStore.getState()).toMatchObject({
    status: 'authed',
    accessToken: 't',
    user: { nickname: 'New' },
  })
})

it('setUser 在 guest 时不改变状态', () => {
  authStore.setGuest('reused')
  const listener = vi.fn()
  authStore.subscribe(listener)
  authStore.setUser(makeUser())
  expect(authStore.getState()).toEqual({ status: 'guest', reason: 'reused' })
  expect(listener).not.toHaveBeenCalled()
})

it('setGuest 默认 reason 为 null', () => {
  authStore.setGuest()
  expect(authStore.getState()).toEqual({ status: 'guest', reason: null })
})

it('useAuth 在 renderHook 里随 setAuthed 更新', () => {
  const { result } = renderHook(() => useAuth())
  expect(result.current.status).toBe('loading')
  act(() => authStore.setAuthed({ accessToken: 't', user: makeUser() }))
  expect(result.current).toMatchObject({ status: 'authed', accessToken: 't' })
})
