import { test, expect } from '@playwright/test'
import { registerViaUi, signOut } from './helpers'

test('刷新恢复登录、已登录访问登录页跳转、两个标签页同步退出', async ({ page, context }) => {
  await registerViaUi(page)
  await page.reload()
  await expect(page.getByRole('heading', { name: '嗨，Ann，想去哪？' })).toBeVisible()
  await page.goto('/login')
  await expect(page).toHaveURL(/\/chat$/)
  const second = await context.newPage()
  await second.goto('/chat')
  await expect(second.getByRole('heading', { name: '嗨，Ann，想去哪？' })).toBeVisible()
  await signOut(page)
  await expect(second).toHaveURL(/\/login\?next=%2Fchat$/)
})
