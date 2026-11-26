import { act, screen } from '@testing-library/react'
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

class FakeObserver {
  static last: FakeObserver | undefined
  targets: Element[] = []
  constructor(readonly callback: (entries: { isIntersecting: boolean }[]) => void, readonly options: IntersectionObserverInit) {
    FakeObserver.last = this
  }
  observe(target: Element) { this.targets.push(target) }
  unobserve() {}
  disconnect() {}
  takeRecords() { return [] }
}

it('封面滚到控件条下面后，控件后面淡入实底，把手变成描边色', async () => {
  vi.stubGlobal('IntersectionObserver', FakeObserver)
  renderWithProviders(<MobileSheet open onClose={() => {}}><div data-testid="cover" data-sheet-hero /><p>行程内容</p></MobileSheet>)
  await screen.findByRole('dialog')
  const observer = FakeObserver.last
  expect(observer?.options.root).toBe(screen.getByTestId('sheet-scroll'))
  expect(observer?.options.rootMargin).toBe('-76px 0px 0px 0px')
  expect(observer?.targets).toEqual([screen.getByTestId('cover')])
  const bar = screen.getByTestId('sheet-bar')
  const pill = screen.getByTestId('sheet-handle').firstElementChild
  expect(bar).toHaveClass('opacity-0')
  expect(pill).toHaveClass('bg-white')
  act(() => observer?.callback([{ isIntersecting: false }]))
  expect(bar).toHaveClass('opacity-100')
  expect(pill).toHaveClass('bg-trip-line')
  act(() => observer?.callback([{ isIntersecting: true }]))
  expect(bar).toHaveClass('opacity-0')
  vi.unstubAllGlobals()
})
