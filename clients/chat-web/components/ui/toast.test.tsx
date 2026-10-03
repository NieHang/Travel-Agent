import { act } from '@testing-library/react'
import { renderWithProviders } from '@/test/render'
import { Toaster, toast } from './toast'

describe('toast', () => {
  it('toast("x") 后页面出现 role=status 的 x', async () => {
    const { findByRole } = renderWithProviders(<Toaster />)
    act(() => {
      toast('x')
    })
    expect(await findByRole('status')).toHaveTextContent('x')
  })

  it('danger 色调同样以 role=status 出现', async () => {
    const { findByText } = renderWithProviders(<Toaster />)
    act(() => {
      toast('出错了', { tone: 'danger' })
    })
    expect(
      (await findByText('出错了')).closest('[role="status"]'),
    ).not.toBeNull()
  })
})
