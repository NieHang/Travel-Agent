import { safeNext } from './safe-next'

it.each(['/chat', '/chat/abc123', '/chat?x=1', '/'])('接受站内路径 %s', (v) =>
  expect(safeNext(v)).toBe(v),
)
it.each([
  null, undefined, '', 'chat', '//evil.com', 'https://evil.com', 'https:/evil.com', 'javascript:alert(1)',
  '/\\evil.com', '/%2F%2Fevil.com', '/%5Cevil.com', '/\tevil', '/a\nb', '/%E0%A4%A',
])('拒绝 %s', (v) => expect(safeNext(v)).toBe('/chat'))
