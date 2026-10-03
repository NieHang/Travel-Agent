import { renderWithProviders } from '@/test/render'
import { Avatar } from './Avatar'

describe('Avatar', () => {
  it('「🧳旅行」显示 🧳，「ann」显示 A', () => {
    const first = renderWithProviders(<Avatar name="🧳旅行" />)
    expect(first.getByText('🧳')).toBeInTheDocument()
    first.unmount()
    const second = renderWithProviders(<Avatar name="ann" />)
    expect(second.getByText('A')).toBeInTheDocument()
  })

  it('空名字不崩溃', () => {
    const { container } = renderWithProviders(<Avatar name="" />)
    expect(container.firstChild).not.toBeNull()
  })
})
