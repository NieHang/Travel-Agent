import { act, fireEvent, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ResultItem } from '@autix/contracts'
import { renderWithProviders } from '@/test/render'
import { ResultCard } from './ResultCard'

const amenities = ['Free WiFi', 'Kitchen', 'Bathtub', 'Parking', 'Pool'].map((original, i) => ({
  original,
  translation: ['免费无线网络', '厨房', '浴缸', '停车场', '游泳池'][i],
}))
const item: ResultItem = {
  ref: 'h1', id: '43615',
  title: { original: 'Casa do Fado Alfama', translation: '阿尔法玛法朵之家' },
  address: { original: 'Rua de São Miguel 12', translation: null },
  price: { amount: 118, currency: 'EUR' }, rating: 4,
  url: 'https://rollinggo.ai/h/43615', image: 'https://img.rollinggo.ai/43615.jpg',
  details: [], amenities, summary: '适合久住',
}

it('横幅显示图片，标题先译文后原文', () => {
  renderWithProviders(<ResultCard item={item} />)
  expect(screen.getByRole('img', { name: 'Casa do Fado Alfama' })).toHaveAttribute('src', item.image)
  expect(screen.getByText('阿尔法玛法朵之家')).toBeInTheDocument()
  expect(screen.getByText('Casa do Fado Alfama')).toBeInTheDocument()
  expect(screen.getByRole('link', { name: /预订/ })).toHaveAttribute('href', item.url)
})

it.each([
  ['null', { image: null }],
  ['http', { image: 'http://img.rollinggo.ai/x.jpg' }],
])('图片为 %s 时显示占位', (_, patch) => {
  renderWithProviders(<ResultCard item={{ ...item, ...patch }} />)
  expect(screen.queryByRole('img', { name: 'Casa do Fado Alfama' })).toBeNull()
  expect(screen.getByTestId('image-placeholder')).toBeInTheDocument()
})

it('图片加载失败时换成占位', () => {
  renderWithProviders(<ResultCard item={item} />)
  fireEvent.error(screen.getByRole('img', { name: 'Casa do Fado Alfama' }))
  expect(screen.getByTestId('image-placeholder')).toBeInTheDocument()
})

it('卡面显示 3 个设施和 +N，悬停、聚焦或点按打开全部设施，Esc 关闭', async () => {
  const user = userEvent.setup()
  renderWithProviders(<ResultCard item={item} />)
  expect(screen.getByText('+2')).toBeInTheDocument()
  expect(screen.queryByRole('tooltip')).toBeNull()
  const card = screen.getByRole('article')
  await user.hover(card)
  expect(screen.getByRole('tooltip')).toHaveTextContent('设施 · 5')
  expect(screen.getByRole('tooltip')).toHaveTextContent('游泳池')
  await user.unhover(card)
  expect(screen.queryByRole('tooltip')).toBeNull()
  act(() => card.focus())
  expect(screen.getByRole('tooltip')).toBeInTheDocument()
  await user.keyboard('{Escape}')
  expect(screen.queryByRole('tooltip')).toBeNull()
  fireEvent.pointerDown(card, { pointerType: 'touch' })
  expect(screen.getByRole('tooltip')).toBeInTheDocument()
})

it('没有设施时不显示芯片和弹层', async () => {
  const user = userEvent.setup()
  renderWithProviders(<ResultCard item={{ ...item, amenities: [] }} />)
  await user.hover(screen.getByRole('article'))
  expect(screen.queryByRole('tooltip')).toBeNull()
  expect(screen.queryByText(/^\+\d/)).toBeNull()
})

it('紧凑样式在聊天与面板里内容一致', () => {
  const { unmount } = renderWithProviders(<ResultCard item={item} />)
  const full = screen.getByRole('article').textContent
  unmount()
  renderWithProviders(<ResultCard item={item} variant="compact" />)
  expect(screen.getByRole('article').textContent).toContain('阿尔法玛法朵之家')
  expect(full).toContain('阿尔法玛法朵之家')
})
