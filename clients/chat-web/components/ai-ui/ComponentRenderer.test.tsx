import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ComponentRenderer } from './ComponentRenderer'
import type { UIResponse } from './types'

const selection: Extract<UIResponse, { type: 'selection' }> = {
  id: 'trip', type: 'selection', purpose: 'trip_type', title: '旅行类型', mode: 'single',
  options: [{ value: 'solo', label: '独自旅行', description: '自由探索' }, { value: 'family', label: '家庭旅行', description: null }],
}

it('选择卡片提交协议 action，多选在确认后提交', async () => {
  const user = userEvent.setup()
  const onAction = vi.fn()
  const { rerender } = render(<ComponentRenderer component={selection} onAction={onAction} />)
  await user.click(screen.getByRole('button', { name: /独自旅行/ }))
  expect(onAction).toHaveBeenCalledWith({ type: 'selection', componentId: 'trip', values: ['solo'] })
  onAction.mockClear()
  rerender(<ComponentRenderer key="multiple" component={{ ...selection, mode: 'multiple' }} onAction={onAction} />)
  expect(screen.getByRole('button', { name: '确认选择' })).toBeDisabled()
  await user.click(screen.getByRole('checkbox', { name: /独自旅行/ }))
  await user.click(screen.getByRole('checkbox', { name: /家庭旅行/ }))
  expect(onAction).not.toHaveBeenCalled()
  await user.click(screen.getByRole('button', { name: '确认选择' }))
  expect(onAction).toHaveBeenCalledWith({ type: 'selection', componentId: 'trip', values: ['solo', 'family'] })
})

it('动态表单支持全部字段，数字保持数字，空可选值提交 null', async () => {
  const user = userEvent.setup()
  const onAction = vi.fn()
  render(<ComponentRenderer onAction={onAction} component={{
    id: 'requirements', type: 'form', title: '旅行需求', submitLabel: '提交需求', fields: [
      { name: 'destination', type: 'input', label: '目的地', required: true, placeholder: '城市' },
      { name: 'preferences', type: 'textarea', label: '偏好', required: false, placeholder: null },
      { name: 'departureDate', type: 'date', label: '出发日期', required: true, placeholder: null },
      { name: 'budget', type: 'number', label: '预算', required: true, min: 0, max: 10000 },
      { name: 'travelers', type: 'number', label: '人数', required: false, min: 1, max: null },
      { name: 'tripType', type: 'select', label: '类型', required: true, options: selection.options },
    ],
  }} />)
  await user.type(screen.getByRole('textbox', { name: '目的地' }), '杭州')
  fireEvent.change(screen.getByLabelText(/出发日期/), { target: { value: '2026-10-10' } })
  await user.type(screen.getByRole('spinbutton', { name: '预算' }), '1200.5')
  await user.selectOptions(screen.getByRole('combobox', { name: '类型' }), 'solo')
  await user.click(screen.getByRole('button', { name: '提交需求' }))
  expect(onAction).toHaveBeenCalledWith({ type: 'form_submit', componentId: 'requirements', values: [
    { name: 'destination', value: '杭州' }, { name: 'preferences', value: null },
    { name: 'departureDate', value: '2026-10-10' }, { name: 'budget', value: 1200.5 },
    { name: 'travelers', value: null }, { name: 'tripType', value: 'solo' },
  ] })
})

it('必填与数字范围阻止无效表单提交', async () => {
  const user = userEvent.setup()
  const onAction = vi.fn()
  render(<ComponentRenderer onAction={onAction} component={{ id: 'f', type: 'form', title: '需求', submitLabel: '提交', fields: [
    { name: 'budget', type: 'number', label: '预算', required: true, min: 0, max: 10 },
    { name: 'city', type: 'input', label: '城市', required: true, placeholder: null },
  ] }} />)
  await user.click(screen.getByRole('button', { name: '提交' }))
  expect(onAction).not.toHaveBeenCalled()
  await user.type(screen.getByRole('spinbutton', { name: '预算' }), '11')
  await user.type(screen.getByRole('textbox', { name: '城市' }), '杭州')
  await user.click(screen.getByRole('button', { name: '提交' }))
  expect(onAction).not.toHaveBeenCalled()
})

it('select 选项 ID 原样提交，自由文本去除首尾空白', async () => {
  const user = userEvent.setup()
  const onAction = vi.fn()
  render(<ComponentRenderer onAction={onAction} component={{ id: 'select-form', type: 'form', title: '筛选', submitLabel: '提交', fields: [
    { name: 'hotel', type: 'select', label: '酒店', required: true, options: [{ value: ' hotel-1 ', label: '酒店一', description: null }] },
    { name: 'query', type: 'input', label: '关键词', required: false, placeholder: null },
  ] }} />)
  await user.selectOptions(screen.getByRole('combobox', { name: '酒店' }), ' hotel-1 ')
  await user.type(screen.getByRole('textbox', { name: '关键词' }), ' 湖畔 ')
  await user.click(screen.getByRole('button', { name: '提交' }))
  expect(onAction).toHaveBeenCalledWith({ type: 'form_submit', componentId: 'select-form', values: [{ name: 'hotel', value: ' hotel-1 ' }, { name: 'query', value: '湖畔' }] })
})

it('确认和取消、按钮点击使用正确的组件与按钮 ID', async () => {
  const user = userEvent.setup()
  const onAction = vi.fn()
  const { rerender } = render(<ComponentRenderer onAction={onAction} component={{ id: 'confirm', type: 'confirmation', title: '确认行程', summary: '杭州三日', confirmLabel: '确认', cancelLabel: '取消' }} />)
  await user.click(screen.getByRole('button', { name: '确认' }))
  await user.click(screen.getByRole('button', { name: '取消' }))
  expect(onAction.mock.calls).toEqual([[{ type: 'confirmation', componentId: 'confirm', confirmed: true }], [{ type: 'confirmation', componentId: 'confirm', confirmed: false }]])
  rerender(<ComponentRenderer onAction={onAction} component={{ id: 'actions', type: 'action_buttons', buttons: [{ id: 'edit', label: '修改', action: 'edit_itinerary' }] }} />)
  await user.click(screen.getByRole('button', { name: '修改' }))
  expect(onAction).toHaveBeenLastCalledWith({ type: 'button_click', componentId: 'actions', buttonId: 'edit' })
  rerender(<ComponentRenderer disabled onAction={onAction} component={selection} />)
  expect(screen.getByRole('button', { name: /独自旅行/ })).toBeDisabled()
})

it('渲染文字、结构化卡片、步骤状态、按列 key 对齐的表格和空表格', () => {
  const onAction = vi.fn()
  const components: UIResponse[] = [
    { id: 'text', type: 'text', content: '<script>alert(1)</script>', format: 'markdown' },
    { id: 'card', type: 'card', title: '杭州', category: 'place', description: '西湖', sourceStatus: 'unverified', details: [{ label: '地区', value: '浙江' }] },
    { id: 'steps', type: 'steps', title: '规划进度', items: [{ id: 's1', label: '需求', status: 'completed' }, { id: 's2', label: '行程', status: 'current' }, { id: 's3', label: '确认', status: 'pending' }] },
    { id: 'table', type: 'table', title: '酒店', columns: [{ key: 'name', label: '名称' }, { key: 'price', label: '价格' }], rows: [{ id: 'r1', cells: [{ key: 'price', value: '500' }, { key: 'name', value: '湖畔' }] }] },
    { id: 'empty', type: 'table', title: '航班', columns: [{ key: 'flight', label: '航班号' }], rows: [] },
  ]
  render(<>{components.map(component => <ComponentRenderer key={component.id} component={component} onAction={onAction} />)}</>)
  expect(screen.getByText('<script>alert(1)</script>')).toBeInTheDocument()
  expect(document.querySelector('script')).toBeNull()
  expect(screen.getByText('浙江')).toBeInTheDocument()
  expect(screen.getByText('未核实')).toBeInTheDocument()
  expect(screen.getByText('行程').closest('li')).toHaveAttribute('aria-current', 'step')
  expect(screen.getAllByRole('cell').slice(0, 2).map(cell => cell.textContent)).toEqual(['湖畔', '500'])
  expect(screen.getByText('暂无数据')).toBeInTheDocument()
})
