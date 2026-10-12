import { createAIUIStore } from './ai-ui.store'
import type { Message, TripStreamEvent } from '@autix/contracts'

const message: Message = {
  id: 'a1', conversationId: 'c1', role: 'ASSISTANT', content: '你好', status: 'complete',
  metadata: { components: [], revision: 2 }, createdAt: new Date(0).toISOString(),
}

it('按事件累积文本、阶段与最终组件，并忽略其他请求的事件', () => {
  const store = createAIUIStore()
  store.getState().begin('r1', 'c1')
  expect(store.getState().phase).toBe('waiting')
  const events: TripStreamEvent[] = [
    { type: 'status', phase: 'searching' },
    { type: 'text', delta: '你' },
    { type: 'text', delta: '好' },
  ]
  for (const e of events) store.getState().receive('r1', e)
  store.getState().receive('other', { type: 'text', delta: '错' })
  expect(store.getState()).toMatchObject({ text: '你好', phase: 'writing' })
  store.getState().receive('r1', { type: 'done', message, components: [{ type: 'buttons', buttons: [{ command: 'edit', label: '修改需求' }] }], trip: null })
  expect(store.getState()).toMatchObject({ terminal: true, outcome: 'completed', revision: 2, trip: null, phase: 'writing' })
  expect(store.getState().components).toHaveLength(1)
  store.getState().receive('r1', { type: 'text', delta: '晚到' })
  expect(store.getState().text).toBe('你好')
})

it('错误和取消终止请求', () => {
  const store = createAIUIStore()
  store.getState().begin('r1', 'c1')
  store.getState().receive('r1', { type: 'error', code: 'MODEL_FAILED' })
  expect(store.getState()).toMatchObject({ terminal: true, outcome: 'failed' })
  store.getState().begin('r2', 'c1')
  store.getState().cancel('r2')
  expect(store.getState()).toMatchObject({ terminal: true, outcome: 'cancelled', phase: null })
})
