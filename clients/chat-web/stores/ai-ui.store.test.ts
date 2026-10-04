import { describe, expect, it } from 'vitest'
import { createAIUIStore } from './ai-ui.store'
describe('isolated streaming state', () => {
  it('replaces whole text and UI batches and ignores stale or terminal events', () => {
    const store = createAIUIStore()
    const timestamp = new Date().toISOString()
    store.getState().begin('r', 'c')
    store.getState().receive('r', {
      messageType: 'markdown',
      timestamp,
      payload: { messageId: 'm', content: 'Hel', isChunk: true },
    })
    store.getState().receive('r', {
      messageType: 'markdown',
      timestamp,
      payload: { messageId: 'm', content: 'Hello', isChunk: false },
    })
    expect(store.getState().text).toBe('Hello')
    store.getState().receive('old', {
      messageType: 'markdown',
      timestamp,
      payload: { messageId: 'm', content: 'BAD', isChunk: true },
    })
    expect(store.getState().text).toBe('Hello')
    store.getState().cancel('r')
    store.getState().receive('r', {
      messageType: 'progress',
      timestamp,
      payload: {
        agent: 'save',
        step: 4,
        totalSteps: 4,
        status: 'completed',
        label: 'save',
      },
    })
    expect(store.getState().outcome).toBe('cancelled')
    expect(store.getState().progress).toBeNull()
  })
})
