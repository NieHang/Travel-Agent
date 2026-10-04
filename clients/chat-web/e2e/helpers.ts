import AxeBuilder from '@axe-core/playwright'
import { expect, type Page } from '@playwright/test'

export const PASSWORD = 'Travel2026'
export function uniqueEmail(): string { return `e2e-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com` }
export async function registerViaUi(page: Page, opts: { nickname?: string; email?: string } = {}) {
  const email = opts.email ?? uniqueEmail()
  await page.goto('/register')
  await page.getByLabel('昵称', { exact: true }).fill(opts.nickname ?? 'Ann')
  await page.getByLabel('邮箱', { exact: true }).fill(email)
  await page.getByLabel('密码', { exact: true }).fill(PASSWORD)
  await page.getByRole('button', { name: '创建账号', exact: true }).click()
  await expect(page).toHaveURL(/\/chat$/)
  await expect(page.getByRole('heading', { name: '嗨，Ann，想去哪？' })).toBeVisible()
  return { email, password: PASSWORD }
}
export async function signOut(page: Page) {
  await page.getByRole('button', { name: '账号菜单' }).click()
  await page.getByRole('button', { name: '退出登录' }).click()
  await expect(page).toHaveURL(/localhost:3102\/$/)
}
export async function expectNoSeriousViolations(page: Page) {
  await page.waitForFunction(() => Array.from(document.querySelectorAll<HTMLElement>('[style]')).every(el => {
    if (el.closest('[aria-hidden="true"], nextjs-portal') || !el.getClientRects().length) return true
    return !el.style.opacity || Number(el.style.opacity) >= 0.99
  }))
  const results = await new AxeBuilder({ page }).exclude('nextjs-portal').analyze()
  expect(results.violations.filter((v) => v.impact === 'critical' || v.impact === 'serious')).toEqual([])
}
