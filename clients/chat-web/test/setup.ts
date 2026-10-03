import '@testing-library/jest-dom/vitest'
import { cleanup } from '@testing-library/react'
import { afterAll, afterEach, beforeAll } from 'vitest'
import { server } from './server'

beforeAll(() => server.listen({ onUnhandledFrame: 'error' }))
afterEach(() => {
  server.resetHandlers()
  cleanup()
  sessionStorage.clear()
})
afterAll(() => server.close())

if (!window.matchMedia) {
  window.matchMedia = (query: string) =>
    ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    }) as MediaQueryList
}

class NoopObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
  takeRecords() {
    return []
  }
}
if (!globalThis.IntersectionObserver) {
  globalThis.IntersectionObserver =
    NoopObserver as unknown as typeof IntersectionObserver
}
if (!globalThis.ResizeObserver) {
  globalThis.ResizeObserver = NoopObserver as unknown as typeof ResizeObserver
}
Element.prototype.scrollTo = () => {}
