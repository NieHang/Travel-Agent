import { resolveLocale } from './locale'

it.each([
  ['en', 'zh-CN,zh;q=0.9', 'en'], // Cookie 优先
  ['zh', 'en-US', 'zh'],
  [undefined, 'en-US,en;q=0.9', 'en'],
  [undefined, 'zh-TW,zh;q=0.9,en;q=0.8', 'zh'],
  [undefined, 'fr-FR,en;q=0.5', 'en'], // 按列表顺序取第一个认识的
  [undefined, 'fr-FR', 'zh'], // 无法判断用中文
  [undefined, null, 'zh'],
  ['de', 'en-US', 'en'], // 非法 Cookie 当作没有
])('cookie=%s accept=%s → %s', (cookie, accept, expected) => {
  expect(resolveLocale(cookie, accept)).toBe(expected)
})
