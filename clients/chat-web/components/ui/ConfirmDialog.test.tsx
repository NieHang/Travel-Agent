import { vi } from 'vitest'
import { renderWithProviders } from '@/test/render'
import { ConfirmDialog } from './ConfirmDialog'

function setup(open = true) {
  const onConfirm = vi.fn()
  const onCancel = vi.fn()
  const utils = renderWithProviders(
    <ConfirmDialog
      open={open}
      title="删除对话"
      body="删除后无法恢复"
      confirmLabel="删除"
      cancelLabel="取消"
      onConfirm={onConfirm}
      onCancel={onCancel}
    />,
  )
  return { ...utils, onConfirm, onCancel }
}

describe('ConfirmDialog', () => {
  it('打开时焦点在取消按钮上', async () => {
    const { findByRole } = setup()
    const dialog = await findByRole('alertdialog')
    expect(dialog).toHaveAccessibleName('删除对话')
    expect(await findByRole('button', { name: '取消' })).toHaveFocus()
  })

  it('Esc 调用 onCancel；点确认调用 onConfirm', async () => {
    const { user, findByRole, onCancel, onConfirm } = setup()
    await findByRole('alertdialog')
    await user.keyboard('{Escape}')
    expect(onCancel).toHaveBeenCalledTimes(1)
    await user.click(await findByRole('button', { name: '删除' }))
    expect(onConfirm).toHaveBeenCalledTimes(1)
  })

  it('关闭时不渲染', () => {
    const { queryByRole } = setup(false)
    expect(queryByRole('alertdialog')).toBeNull()
  })
})
