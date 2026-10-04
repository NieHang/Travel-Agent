import { screen } from '@testing-library/react'
import { renderWithProviders } from '@/test/render'
import { MobileSheet, shouldDismiss } from './MobileSheet'
it.each([[149, 600, false], [150, 600, false], [151, 600, true]])('拖动 %i / 高 %i → %s', (offset, height, expected) => {
  expect(shouldDismiss(offset, height)).toBe(expected)
})
it('打开底部面板有模态语义，Esc 和关闭按钮可收起', async () => {
  const onClose = vi.fn()
  const { user } = renderWithProviders(<MobileSheet open onClose={onClose}><p>行程内容</p></MobileSheet>)
  expect(await screen.findByRole('dialog')).toHaveAttribute('aria-modal', 'true')
  await user.keyboard('{Escape}')
  expect(onClose).toHaveBeenCalledOnce()
  await user.click(screen.getByRole('button', { name: '关闭' }))
  expect(onClose).toHaveBeenCalledTimes(2)
})
