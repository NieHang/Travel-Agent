import { screen, waitFor } from '@testing-library/react'
import { Toaster } from '@/components/ui/toast'
import { renderWithProviders } from '@/test/render'
import { TripPanels, SaveTripButton } from './TripPanels'
import { getTripMock } from './mock'

it('行程默认第一天，切换日期后展示该天站点', async () => {
  const { user } = renderWithProviders(<TripPanels tab="plan" data={getTripMock('zh')} />)
  expect(screen.getByRole('tab', { name: '第 1 天' })).toHaveAttribute('aria-selected', 'true')
  expect(screen.getByText('示例')).toBeInTheDocument()
  await user.click(screen.getByRole('tab', { name: '第 3 天' }))
  expect(screen.getByText('贝伦与河岸')).toBeInTheDocument()
  expect(screen.getAllByText(/09:00|12:00|16:00/)).toHaveLength(3)
})
it('酒店键盘选择改变预订按钮；全程价格按折扣计算', async () => {
  const { user } = renderWithProviders(<TripPanels tab="hotels" data={getTripMock('zh')} />)
  expect(screen.getByText('住在哪')).toBeInTheDocument()
  const options = screen.getAllByRole('radio')
  options[0].focus()
  await user.keyboard('{ArrowRight}')
  expect(options[1]).toHaveAttribute('aria-checked', 'true')
  expect(screen.getByRole('button', { name: '预订 河岸之家' })).toBeInTheDocument()
  await user.click(screen.getByRole('tab', { name: /全程/ }))
  expect(screen.getByText(/638/)).toBeInTheDocument()
})
it('路线切换电车改变总时长，地图有文字说明', async () => {
  const { user } = renderWithProviders(<TripPanels tab="routes" data={getTripMock('zh')} />)
  expect(screen.getByRole('img')).toHaveAccessibleName(/六个站点/)
  expect(screen.getByText('60分钟')).toBeInTheDocument()
  await user.click(screen.getByRole('tab', { name: '28 路电车' }))
  expect(screen.getByText('30分钟')).toBeInTheDocument()
})
it('热点筛选与添加可切换；空分类有提示', async () => {
  const data = getTripMock('zh')
  const { user, rerender } = renderWithProviders(<TripPanels tab="hotspots" data={data} />)
  await user.click(screen.getByRole('tab', { name: '美食' }))
  await waitFor(() => expect(screen.getAllByRole('button', { name: '+ 添加' })).toHaveLength(2))
  await user.click(screen.getAllByRole('button', { name: '+ 添加' })[0])
  await user.click(screen.getByRole('button', { name: '已添加 ✓' }))
  expect(screen.getAllByRole('button', { name: '+ 添加' })).toHaveLength(2)
  rerender(<TripPanels tab="hotspots" data={{ ...data, hotspots: data.hotspots.filter((s) => s.category !== 'nightlife') }} />)
  await user.click(screen.getByRole('tab', { name: '夜生活' }))
  expect(screen.getByText('这个分类下暂时没有地点')).toBeInTheDocument()
})
it('切换面板后局部选中状态复位', async () => {
  const data = getTripMock('zh')
  const { user, rerender } = renderWithProviders(<TripPanels tab="plan" data={data} />)
  await user.click(screen.getByRole('tab', { name: '第 3 天' }))
  rerender(<TripPanels tab="hotels" data={data} />)
  rerender(<TripPanels tab="plan" data={data} />)
  expect(screen.getByRole('tab', { name: '第 1 天' })).toHaveAttribute('aria-selected', 'true')
})
it('保存和预订按钮提供即将上线提示', async () => {
  const { user } = renderWithProviders(<><Toaster /><SaveTripButton /><TripPanels tab="hotels" data={getTripMock('zh')} /></>)
  await user.click(screen.getByRole('button', { name: '保存行程' }))
  expect(await screen.findByText('保存行程即将上线')).toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: /预订/ }))
  expect(await screen.findByText('预订功能即将上线')).toBeInTheDocument()
})
