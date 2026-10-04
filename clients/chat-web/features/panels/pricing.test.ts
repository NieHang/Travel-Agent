import { fullStayPrice } from './pricing'
it.each([[120, 528], [145, 638], [89, 392], [1, 4]])('每晚 %i → 全程 %i', (n, total) => {
  expect(fullStayPrice(n)).toBe(total)
})
