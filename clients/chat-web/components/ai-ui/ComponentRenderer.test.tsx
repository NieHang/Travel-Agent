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
  renderWithProviders(<ComponentRenderer component={tripTypes} onCommand={onCommand} />)
  await user.click(screen.getByRole('button', { name: /个人游/ }))
  expect(onCommand).toHaveBeenCalledWith({ type: 'set_trip_type', value: 'solo' })
})

it('目的地建议发送 set_destination', async () => {
  const user = userEvent.setup()
  const onCommand = vi.fn()
  renderWithProviders(<ComponentRenderer onCommand={onCommand} component={{ type: 'choice', command: 'set_destination', title: '想去哪里？', options: [{ value: '巴厘岛', label: '巴厘岛', description: null }] }} />)
  await user.click(screen.getByRole('button', { name: '巴厘岛' }))
  expect(onCommand).toHaveBeenCalledWith({ type: 'set_destination', value: '巴厘岛' })
})

it('需求表单只提交填写的字段，人数保持数字，清空偏好提交空串', async () => {
  const user = userEvent.setup()
  const onCommand = vi.fn()
  renderWithProviders(<ComponentRenderer onCommand={onCommand} component={{
    type: 'form', command: 'submit_requirements', title: '旅游需求', submitLabel: '生成路线草案',
    initialValues: { destination: '杭州', preferences: '美食' },
    fields: [
      { name: 'travelers', kind: 'number', label: '出行人数', required: true, placeholder: null, min: 1, max: 100 },
      { name: 'preferences', kind: 'textarea', label: '兴趣与特殊需求', required: false, placeholder: null, min: null, max: null },
    ],
  }} />)
  await user.type(screen.getByRole('spinbutton', { name: '出行人数' }), '4')
  await user.clear(screen.getByRole('textbox', { name: '兴趣与特殊需求' }))
  await user.click(screen.getByRole('button', { name: '生成路线草案' }))
  expect(onCommand).toHaveBeenCalledWith({ type: 'submit_requirements', values: { travelers: 4, preferences: '' } })
})

it('按钮组发送 confirm/edit/resume', async () => {
  const user = userEvent.setup()
  const onCommand = vi.fn()
  renderWithProviders(<ComponentRenderer onCommand={onCommand} component={{ type: 'buttons', buttons: [{ command: 'confirm', label: '确认路线' }, { command: 'edit', label: '修改需求' }] }} />)
  await user.click(screen.getByRole('button', { name: '确认路线' }))
  expect(onCommand).toHaveBeenCalledWith({ type: 'confirm' })
})

it('禁用时不能操作，卡片列表渲染 ResultCard', async () => {
  renderWithProviders(<ComponentRenderer disabled onCommand={vi.fn()} component={tripTypes} />)
  expect(screen.getByRole('button', { name: /个人游/ })).toBeDisabled()
})

it('旧消息里的组件按文字显示，不可操作', () => {
  renderWithProviders(<ComponentRenderer onCommand={vi.fn()} component={{ id: 'x', type: 'card', title: '路线草案', description: '第 1 天' }} />)
  expect(screen.getByText('路线草案')).toBeInTheDocument()
  expect(screen.queryByRole('button')).toBeNull()
})
