import { test, expect } from '@playwright/test'
import { pickTripDates, registerViaUi } from './helpers'

test('trip planning commands, panels and refresh recovery', async ({
  page,
}, testInfo) => {
  await registerViaUi(page)
  await page.getByRole('textbox').fill('杭州')
  await page.getByRole('button', { name: '发送', exact: true }).click()
  const solo = page
    .getByRole('button', { name: /个人游/ })
    .and(page.locator(':enabled'))
  await expect(solo).toBeVisible()
  await solo.click()
  await pickTripDates(page, 30, 32)
  await page.getByRole('button', { name: '增加一人', exact: true }).click()
  await page.getByRole('button', { name: '生成路线草案', exact: true }).click()
  const panel = page.getByTestId('live-trip-panel')
  await expect(
    page.getByRole('heading', { name: '杭州行程草稿' }),
  ).toBeVisible()
  await expect(panel.getByText('行程草稿', { exact: true })).toBeVisible()
  await expect(
    page
      .getByRole('button', { name: '确认路线', exact: true })
      .and(page.locator(':enabled')),
  ).toBeInViewport()
  await page.screenshot({
    path: testInfo.outputPath('ui-streaming-draft.png'),
    fullPage: true,
  })
  await page.reload()
  await expect(
    page.getByRole('heading', { name: '杭州行程草稿' }),
  ).toBeVisible()
  await expect(panel.getByText('行程草稿', { exact: true })).toBeVisible()
  const confirm = page
    .getByRole('button', { name: '确认路线', exact: true })
    .and(page.locator(':enabled'))
  await expect(confirm).toBeEnabled()
  await confirm.click()
  await expect(panel.getByText('已确认', { exact: true })).toBeVisible()
  await page.screenshot({
    path: testInfo.outputPath('ui-streaming-confirmed.png'),
    fullPage: true,
  })
})

test('mobile trip sheet uses the same conversation snapshot', async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await registerViaUi(page)
  await page.getByRole('textbox').fill('杭州')
  await page.getByRole('button', { name: '发送', exact: true }).click()
  await expect(
    page.getByRole('button', { name: /个人游/ }).and(page.locator(':enabled')),
  ).toBeVisible()
  await page.getByRole('button', { name: '查看行程', exact: true }).click()
  await expect(
    page
      .getByTestId('live-trip-panel')
      .getByRole('heading', { name: '杭州', exact: true }),
  ).toBeVisible()
  await expect(
    page.getByTestId('live-trip-panel').getByText('完善需求中'),
  ).toBeVisible()
  await page.screenshot({
    path: testInfo.outputPath('ui-streaming-mobile.png'),
    fullPage: true,
  })
})
