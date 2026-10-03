import { act, render } from '@testing-library/react'
import { BOTTOM_THRESHOLD_PX, isNearBottom, useStickToBottom } from './use-stick-to-bottom'

function setGeometry(el: HTMLElement, g: { scrollTop?: number; scrollHeight?: number; clientHeight?: number }) {
  for (const [key, value] of Object.entries(g)) {
    Object.defineProperty(el, key, { value, configurable: true, writable: true })
  }
}

it('阈值为 80px', () => {
  expect(BOTTOM_THRESHOLD_PX).toBe(80)
})

it.each([
  [920, true],
  [919, false],
])('scrollTop=%i（scrollHeight 1500、clientHeight 500）→ %s', (scrollTop, expected) => {
  expect(isNearBottom({ scrollTop, scrollHeight: 1500, clientHeight: 500 })).toBe(expected)
})

function Harness({ dep }: { dep: unknown }) {
  const { ref, atBottom, scrollToBottom } = useStickToBottom(dep)
  return (
    <>
      <div ref={ref} data-testid="scroller" />
      <output data-testid="at-bottom">{String(atBottom)}</output>
      <button onClick={scrollToBottom}>jump</button>
    </>
  )
}

function setup() {
  const view = render(<Harness dep="a" />)
  return {
    el: view.getByTestId('scroller'),
    atBottom: () => view.getByTestId('at-bottom').textContent,
    jump: () => act(() => view.getByText('jump').click()),
    rerender: (dep: string) => view.rerender(<Harness dep={dep} />),
  }
}

it('在底部时内容变化会跟随到底；向上滚动后不再跟随', () => {
  const s = setup()
  setGeometry(s.el, { scrollHeight: 1500, clientHeight: 500, scrollTop: 1000 })
  act(() => {
    s.el.dispatchEvent(new Event('scroll'))
  })
  expect(s.atBottom()).toBe('true')

  setGeometry(s.el, { scrollHeight: 1800 })
  s.rerender('b')
  expect(s.el.scrollTop).toBe(1800)

  setGeometry(s.el, { scrollTop: 300 })
  act(() => {
    s.el.dispatchEvent(new Event('scroll'))
  })
  expect(s.atBottom()).toBe('false')

  setGeometry(s.el, { scrollHeight: 2000 })
  s.rerender('c')
  expect(s.el.scrollTop).toBe(300)
})

it('scrollToBottom 平滑滚到底并恢复跟随', () => {
  const s = setup()
  setGeometry(s.el, { scrollHeight: 1500, clientHeight: 500, scrollTop: 100 })
  act(() => {
    s.el.dispatchEvent(new Event('scroll'))
  })
  const scrollTo = vi.fn()
  s.el.scrollTo = scrollTo
  s.jump()
  expect(scrollTo).toHaveBeenCalledWith({ top: 1500, behavior: 'smooth' })

  setGeometry(s.el, { scrollHeight: 1700 })
  s.rerender('d')
  expect(s.el.scrollTop).toBe(1700)
})
