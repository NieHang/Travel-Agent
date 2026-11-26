import { act } from '@testing-library/react'
import { renderWithProviders } from '@/test/render'
import { Toaster, toast } from './toast'

describe('toast', () => {
  it('toast("x") 后页面出现 role=status 的 x，没有警示图标', async () => {
    const { findByRole } = renderWithProviders(<Toaster />)
    act(() => {
      toast('x')
    })
    const status = await findByRole('status')
    expect(status).toHaveTextContent('x')
    expect(status.closest('[data-slot="toast"]')?.querySelector('svg')).toBeNull()
  })

  it('danger 色调同样以 role=status 出现，消息前有警示图标', async () => {
    const { findByText } = renderWithProviders(<Toaster />)
    act(() => {
      toast('出错了', { tone: 'danger' })
    })
    const status = (await findByText('出错了')).closest('[role="status"]')
    expect(status).not.toBeNull()
    expect(status?.closest('[data-slot="toast"]')?.querySelector('svg')).not.toBeNull()
  })
})
