import { test, expect } from '@playwright/test'
import { expectNoSeriousViolations, registerViaUi } from './helpers'

test('落地页、登录、注册、对话和抽屉无严重无障碍问题', async ({ page }) => {
  for (const path of ['/', '/login', '/register']) {
    await page.goto(path)
    await expectNoSeriousViolations(page)
  }
  await registerViaUi(page)
  await expectNoSeriousViolations(page)
  await page.getByRole('button', { name: '历史对话' }).click()
  await expect(page.getByRole('dialog', { name: '历史对话' })).toBeVisible()
  await expectNoSeriousViolations(page)
})
test('减少动态效果时标题和装饰卡片无位移', async ({ browser }) => {
  const context = await browser.newContext({ reducedMotion: 'reduce', locale: 'zh-CN', viewport: { width: 1440, height: 1000 } })
  const page = await context.newPage()
  const hydrationErrors: string[] = []
  page.on('console', message => { if (message.type() === 'error' && /hydration|hydrated/i.test(message.text())) hydrationErrors.push(message.text()) })
  await page.goto('http://localhost:3102')
  const heading = page.getByRole('heading', { name: '下一站，去哪？' })
  const top = (await heading.boundingBox())!.y
  for (let i = 0; i < 4; i++) {
    await page.waitForTimeout(100)
    expect((await heading.boundingBox())!.y).toBeCloseTo(top, 0)
  }
  const cards = page.getByTestId('floating-cards')
  const before = await cards.locator('[inert]').evaluateAll((els) => els.map((el) => getComputedStyle(el).transform))
  await page.waitForTimeout(2000)
  expect(await cards.locator('[inert]').evaluateAll((els) => els.map((el) => getComputedStyle(el).transform))).toEqual(before)
  expect(hydrationErrors).toEqual([])
  await context.close()
})
