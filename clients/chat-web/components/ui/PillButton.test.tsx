import { vi } from 'vitest'
import { renderWithProviders } from '@/test/render'
import { PillButton } from './PillButton'

describe('PillButton', () => {
  it('加载态：aria-busy，点击不触发 onClick，文案仍在 DOM 里以保持宽度', async () => {
    const onClick = vi.fn()
    const { user, getByRole } = renderWithProviders(
      <PillButton loading onClick={onClick}>
        开始规划
      </PillButton>,
    )
    const button = getByRole('button')
    expect(button).toHaveAttribute('aria-busy', 'true')
    expect(button).toHaveTextContent('开始规划')
    await user.click(button)
    expect(onClick).not.toHaveBeenCalled()
  })

  it('禁用态：点击不触发 onClick', async () => {
    const onClick = vi.fn()
    const { user, getByRole } = renderWithProviders(
      <PillButton disabled onClick={onClick}>
        提交
      </PillButton>,
    )
    expect(getByRole('button')).toBeDisabled()
    await user.click(getByRole('button'))
    expect(onClick).not.toHaveBeenCalled()
  })

  it('正常态：点击触发 onClick，默认 type 为 button', async () => {
    const onClick = vi.fn()
    const { user, getByRole } = renderWithProviders(
      <PillButton onClick={onClick}>提交</PillButton>,
    )
    expect(getByRole('button')).toHaveAttribute('type', 'button')
    await user.click(getByRole('button'))
    expect(onClick).toHaveBeenCalledTimes(1)
  })

  it('iconOnly 必须能按 aria-label 找到', () => {
    const { getByRole } = renderWithProviders(
      <PillButton iconOnly aria-label="发送">
        <svg aria-hidden />
      </PillButton>,
    )
    expect(getByRole('button', { name: '发送' })).toBeInTheDocument()
  })
})
