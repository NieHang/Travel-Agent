import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { Component } from '@autix/contracts'
import { renderWithProviders } from '@/test/render'
import { ComponentRenderer } from './ComponentRenderer'

const tripTypes: Component = {
  type: 'choice', command: 'set_trip_type', title: '这次是什么类型的出行？',
  options: [{ value: 'solo', label: '个人游', description: '按个人兴趣安排行程' }, { value: 'family', label: '亲子游', description: null }],
}

it('选择卡片直接发送自己的命令', async () => {
  const user = userEvent.setup()
  const onCommand = vi.fn()
  renderWithProviders(<ComponentRenderer component={tripTypes} mode={{ kind: 'live', onCommand }} />)
  await user.click(screen.getByRole('button', { name: /个人游/ }))
  expect(onCommand).toHaveBeenCalledWith({ type: 'set_trip_type', value: 'solo' })
})

it('目的地建议发送 set_destination', async () => {
  const user = userEvent.setup()
  const onCommand = vi.fn()
  renderWithProviders(<ComponentRenderer mode={{ kind: 'live', onCommand }} component={{ type: 'choice', command: 'set_destination', title: '想去哪里？', options: [{ value: '巴厘岛', label: '巴厘岛', description: null }] }} />)
  await user.click(screen.getByRole('button', { name: '巴厘岛' }))
  expect(onCommand).toHaveBeenCalledWith({ type: 'set_destination', value: '巴厘岛' })
})

it('按钮组发送 confirm/edit/resume', async () => {
  const user = userEvent.setup()
  const onCommand = vi.fn()
  renderWithProviders(<ComponentRenderer mode={{ kind: 'live', onCommand }} component={{ type: 'buttons', buttons: [{ command: 'confirm', label: '确认路线' }, { command: 'edit', label: '修改需求' }] }} />)
  await user.click(screen.getByRole('button', { name: '确认路线' }))
  expect(onCommand).toHaveBeenCalledWith({ type: 'confirm' })
})

it('锁定时不能操作', async () => {
  renderWithProviders(<ComponentRenderer mode={{ kind: 'locked' }} component={tripTypes} />)
  expect(screen.getByRole('button', { name: /个人游/ })).toBeDisabled()
})

it('旧消息里的组件按文字显示，不可操作', () => {
  renderWithProviders(<ComponentRenderer mode={{ kind: 'locked' }} component={{ id: 'x', type: 'card', title: '路线草案', description: '第 1 天' }} />)
  expect(screen.getByText('路线草案')).toBeInTheDocument()
  expect(screen.queryByRole('button')).toBeNull()
})

const reviewButtons: Component = { type: 'buttons', buttons: [{ command: 'edit', label: '修改需求' }, { command: 'confirm', label: '确认路线' }] }

it('确认排在修改前面', () => {
  renderWithProviders(<ComponentRenderer mode={{ kind: 'live', onCommand: vi.fn() }} component={reviewButtons} />)
  expect(screen.getAllByRole('button').map((b) => b.textContent)).toEqual(['确认路线', '修改需求'])
})

it('已回答的按钮组不再渲染：选择已作为用户消息显示', () => {
  const { container } = renderWithProviders(<ComponentRenderer mode={{ kind: 'answered', command: { type: 'edit' } }} component={reviewButtons} />)
  expect(container).toBeEmptyDOMElement()
})

it('锁定且未回答的按钮组不可点击', () => {
  renderWithProviders(<ComponentRenderer mode={{ kind: 'locked' }} component={reviewButtons} />)
  for (const b of screen.getAllByRole('button')) expect(b).toBeDisabled()
})

it('已回答的选项卡片收起；结果卡片是内容，回答后仍然显示', () => {
  const answered = { kind: 'answered', command: { type: 'set_trip_type', value: 'solo' } } as const
  const { container } = renderWithProviders(<ComponentRenderer mode={answered} component={tripTypes} />)
  expect(container).toBeEmptyDOMElement()
  const cards: Component = {
    type: 'cards',
    items: [{
      ref: 'h1', id: '1', title: { original: 'Hotel Kanra', translation: null }, address: null,
      price: null, rating: null, url: 'https://rollinggo.ai/h/1', image: null, details: [], amenities: [], summary: null,
    }],
  }
  renderWithProviders(<ComponentRenderer mode={answered} component={cards} />)
  expect(screen.getByText('Hotel Kanra')).toBeInTheDocument()
})
