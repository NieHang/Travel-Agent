import { useState } from 'react'
import { vi } from 'vitest'
import { renderWithProviders } from '@/test/render'
import { PillTabs } from './PillTabs'

const ITEMS = [
  { value: 'a', label: '行程' },
  { value: 'b', label: '酒店', badge: '3' },
  { value: 'c', label: '路线' },
]

function Harness({ onChange }: { onChange?: (v: string) => void }) {
  const [value, setValue] = useState('a')
  return (
    <PillTabs
      aria-label="结果"
      layoutId="t"
      items={ITEMS}
      value={value}
      onChange={(v) => {
        onChange?.(v)
        setValue(v)
      }}
    />
  )
}

describe('PillTabs', () => {
  it('渲染 tablist，选中项 aria-selected', () => {
    const { getByRole, getAllByRole } = renderWithProviders(<Harness />)
    expect(getByRole('tablist', { name: '结果' })).toBeInTheDocument()
    const tabs = getAllByRole('tab')
    expect(tabs).toHaveLength(3)
    expect(tabs[0]).toHaveAttribute('aria-selected', 'true')
    expect(tabs[1]).toHaveAttribute('aria-selected', 'false')
  })

  it('右方向键选中下一项，末项再按回到首项；左方向键相反', async () => {
    const { user, getAllByRole } = renderWithProviders(<Harness />)
    const tabs = () => getAllByRole('tab')
    tabs()[0].focus()
    await user.keyboard('{ArrowRight}')
    expect(tabs()[1]).toHaveAttribute('aria-selected', 'true')
    expect(tabs()[1]).toHaveFocus()
    await user.keyboard('{ArrowRight}{ArrowRight}')
    expect(tabs()[0]).toHaveAttribute('aria-selected', 'true')
    await user.keyboard('{ArrowLeft}')
    expect(tabs()[2]).toHaveAttribute('aria-selected', 'true')
    expect(tabs()[2]).toHaveFocus()
  })

  it('点击已选中项不触发 onChange', async () => {
    const onChange = vi.fn()
    const { user, getAllByRole } = renderWithProviders(
      <Harness onChange={onChange} />,
    )
    await user.click(getAllByRole('tab')[0])
    expect(onChange).not.toHaveBeenCalled()
    await user.click(getAllByRole('tab')[2])
    expect(onChange).toHaveBeenCalledWith('c')
  })
})
