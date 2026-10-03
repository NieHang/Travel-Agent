import { useTranslations } from 'next-intl'
import { screen } from '@testing-library/react'
import { renderWithProviders } from '@/test/render'

function Probe() {
  const t = useTranslations()
  return (
    <>
      <p data-testid="apostrophe">{t('chat.sendFailed')}</p>
      <p data-testid="apostrophe2">{t('drawer.confirmBody')}</p>
      <p data-testid="chip">{t('chat.chips.0')}</p>
      <p data-testid="prompt">{t('auth.pendingHint', { prompt: '里斯本' })}</p>
    </>
  )
}

it('English apostrophes render literally', () => {
  renderWithProviders(<Probe />, { locale: 'en' })
  expect(screen.getByTestId('apostrophe')).toHaveTextContent("Couldn't send. Try again")
  expect(screen.getByTestId('apostrophe2')).toHaveTextContent("This can't be undone")
})

it('numeric segment keys and placeholders resolve in zh', () => {
  renderWithProviders(<Probe />)
  expect(screen.getByTestId('chip')).toHaveTextContent('150 欧以内的酒店')
  expect(screen.getByTestId('prompt')).toHaveTextContent('登录后将为你规划：「里斯本」')
})
