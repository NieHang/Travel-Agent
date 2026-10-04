import { QueryClient } from '@tanstack/react-query'
import { makeUser } from '@/test/fixtures'
import { authStore } from './auth-store'
import { bindAccountCache } from './account-cache'

it('丢失会话和更换账号同步清理缓存，同账号换 token 保留缓存', () => {
  authStore.setAuthed({ accessToken: 'A', user: makeUser({ id: 'A' }) })
  const client = new QueryClient()
  const unbind = bindAccountCache(client)
  client.setQueryData(['messages', 'private-A'], 'private')
  authStore.setAuthed({ accessToken: 'new-A', user: makeUser({ id: 'A' }) })
  expect(client.getQueryData(['messages', 'private-A'])).toBe('private')
  authStore.setGuest()
  expect(client.getQueryCache().getAll()).toHaveLength(0)
  authStore.setAuthed({ accessToken: 'A', user: makeUser({ id: 'A' }) })
  client.setQueryData(['messages', 'private-A'], 'private')
  authStore.setAuthed({ accessToken: 'B', user: makeUser({ id: 'B' }) })
  expect(client.getQueryCache().getAll()).toHaveLength(0)
  unbind()
  client.clear()
})
