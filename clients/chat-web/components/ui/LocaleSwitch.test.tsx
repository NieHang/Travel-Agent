import { vi } from 'vitest'
import { renderWithProviders } from '@/test/render'
import { LocaleSwitch } from './LocaleSwitch'

const setLocale = vi.fn()
vi.mock('@/features/auth/use-set-locale', () => ({
  useSetLocale: () => setLocale,
}))

describe('LocaleSwitch', () => {
  beforeEach(() => setLocale.mockClear())

  it('zh 界面：「中」aria-pressed，点击 EN 调用 setLocale("en")，点击「中」不调用', async () => {
    const { user, getByRole } = renderWithProviders(<LocaleSwitch />)
    expect(getByRole('button', { name: '中' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    expect(getByRole('button', { name: 'EN' })).toHaveAttribute(
      'aria-pressed',
      'false',
    )
    await user.click(getByRole('button', { name: '中' }))
    expect(setLocale).not.toHaveBeenCalled()
    await user.click(getByRole('button', { name: 'EN' }))
    expect(setLocale).toHaveBeenCalledWith('en')
  })

  it('en 界面：EN 选中，点击「中」调用 setLocale("zh")', async () => {
    const { user, getByRole } = renderWithProviders(<LocaleSwitch />, {
      locale: 'en',
    })
    expect(getByRole('button', { name: 'EN' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    await user.click(getByRole('button', { name: '中' }))
    expect(setLocale).toHaveBeenCalledWith('zh')
  })
})
