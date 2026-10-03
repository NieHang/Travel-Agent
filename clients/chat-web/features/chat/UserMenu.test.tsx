import { screen, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { authStore } from '@/features/auth/auth-store'
import { makeConversation, makeUser } from '@/test/fixtures'
import { renderWithProviders } from '@/test/render'
import { apiUrl, server } from '@/test/server'
import { UserMenu } from './UserMenu'

const replace = vi.fn()
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace, refresh: vi.fn() }),
}))

beforeEach(() => {
  replace.mockClear()
  authStore.reset()
  authStore.setAuthed({
    accessToken: 't',
    user: makeUser({ nickname: 'Ann', email: 'ann@example.com' }),
  })
})

it('头像按钮读屏标签「账号菜单」；菜单里有昵称、邮箱、语言切换、退出登录', async () => {
  const { user } = renderWithProviders(<UserMenu />)
  const trigger = screen.getByRole('button', { name: '账号菜单' })
  expect(screen.queryByText('ann@example.com')).not.toBeInTheDocument()
  await user.click(trigger)
  expect(await screen.findByText('Ann', { selector: 'p' })).toBeInTheDocument()
  expect(screen.getByText('ann@example.com')).toBeInTheDocument()
  expect(screen.getByRole('button', { name: '中' })).toHaveAttribute('aria-pressed', 'true')
  expect(screen.getByRole('button', { name: 'EN' })).toBeInTheDocument()
  expect(screen.getByRole('button', { name: '退出登录' })).toBeInTheDocument()
})

it('Esc 关闭菜单', async () => {
  const { user } = renderWithProviders(<UserMenu />)
  await user.click(screen.getByRole('button', { name: '账号菜单' }))
  await screen.findByText('ann@example.com')
  await user.keyboard('{Escape}')
  await waitFor(() => expect(screen.queryByText('ann@example.com')).not.toBeInTheDocument())
})

it('退出：接口 500 也清空缓存、置为 guest 并 router.replace("/")', async () => {
  server.use(
    http.post(apiUrl('/api/auth/logout'), () => new HttpResponse(null, { status: 500 })),
  )
  const { user, queryClient } = renderWithProviders(<UserMenu />)
  queryClient.setQueryData(['conversations', { q: '' }], [makeConversation()])
  await user.click(screen.getByRole('button', { name: '账号菜单' }))
  await user.click(await screen.findByRole('button', { name: '退出登录' }))
  await waitFor(() => expect(replace).toHaveBeenCalledWith('/'))
  expect(authStore.getState().status).toBe('guest')
  expect(queryClient.getQueryData(['conversations', { q: '' }])).toBeUndefined()
})
