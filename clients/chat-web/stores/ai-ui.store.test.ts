import { createAIUIStore } from './ai-ui.store'
import type { Message, TripStreamEvent } from '@autix/contracts'

const phases = (store: ReturnType<typeof createAIUIStore>) => store.getState().steps.map((s) => s.phase)

const message: Message = {
  id: 'a1', conversationId: 'c1', role: 'ASSISTANT', content: '你好', status: 'complete',
  metadata: { components: [], revision: 2 }, createdAt: new Date(0).toISOString(),
}

it('按事件累积文本、阶段与最终组件，并忽略其他请求的事件', () => {
  const store = createAIUIStore()
  store.getState().begin('r1', 'c1')
  expect(phases(store)).toEqual(['understanding'])
  const events: TripStreamEvent[] = [
    { type: 'status', phase: 'searching' },
    { type: 'status', phase: 'writing' },
    { type: 'text', delta: '你' },
    { type: 'text', delta: '好' },
  ]
  for (const e of events) store.getState().receive('r1', e)
  store.getState().receive('other', { type: 'text', delta: '错' })
  expect(store.getState().text).toBe('你好')
  expect(phases(store)).toEqual(['understanding', 'searching', 'writing'])
  store.getState().receive('r1', { type: 'done', message, components: [{ type: 'buttons', buttons: [{ command: 'edit', label: '修改需求' }] }], trip: null })
  expect(store.getState()).toMatchObject({ terminal: true, outcome: 'completed', revision: 2, trip: null })
  expect(store.getState().components).toHaveLength(1)
  store.getState().receive('r1', { type: 'text', delta: '晚到' })
  expect(store.getState().text).toBe('你好')
})

it('开始搜索时丢弃此前流出的旁白', () => {
  const store = createAIUIStore()
  store.getState().begin('r1', 'c1')
  store.getState().receive('r1', { type: 'text', delta: '我先查一下。' })
  store.getState().receive('r1', { type: 'status', phase: 'searching' })
  store.getState().receive('r1', { type: 'text', delta: '## 草稿' })
  expect(store.getState().text).toBe('## 草稿')
})

it('错误和取消终止请求', () => {
  const store = createAIUIStore()
  store.getState().begin('r1', 'c1')
  store.getState().receive('r1', { type: 'error', code: 'MODEL_FAILED' })
  expect(store.getState()).toMatchObject({ terminal: true, outcome: 'failed' })
  store.getState().begin('r2', 'c1')
  store.getState().cancel('r2')
  expect(store.getState()).toMatchObject({ terminal: true, outcome: 'cancelled' })
  expect(phases(store)).toEqual(['understanding'])
})

it('只有 status 推进阶段，重复的阶段只记一次，并记录到达时间', () => {
  const store = createAIUIStore()
  store.getState().begin('r1', 'c1')
  for (const phase of ['searching', 'searching', 'writing', 'organizing'] as const) {
    store.getState().receive('r1', { type: 'status', phase })
  }
  store.getState().receive('r1', { type: 'draft', delta: '# 行程' })
  expect(phases(store)).toEqual(['understanding', 'searching', 'writing', 'organizing'])
  expect(store.getState().steps.every((s) => !Number.isNaN(Date.parse(s.at)))).toBe(true)
})
