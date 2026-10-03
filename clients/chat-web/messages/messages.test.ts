import zh from './zh.json'
import en from './en.json'

const keys = (o: object, p = ''): string[] =>
  Object.entries(o).flatMap(([k, v]) => (typeof v === 'object' ? keys(v, `${p}${k}.`) : [`${p}${k}`]))
const placeholders = (s: string) => [...s.matchAll(/\{(\w+)/g)].map((m) => m[1]).sort()

it('zh 与 en 的键完全一致', () => expect(keys(zh).sort()).toEqual(keys(en).sort()))
it('没有空文案', () => {
  for (const dict of [zh, en]) for (const k of keys(dict)) expect(k.split('.').reduce((o: any, p) => o[p], dict)).not.toBe('')
})
it('同一个键的占位符一致', () => {
  for (const k of keys(zh)) {
    const get = (d: object) => k.split('.').reduce((o: any, p) => o[p], d) as string
    expect(placeholders(get(en))).toEqual(placeholders(get(zh)))
  }
})
it('抽查文案', () => {
  expect(zh.landing.title).toBe('下一站，去哪？')
  expect(en.landing.title).toBe('Where to next?')
  expect(en.errors.RATE_LIMITED).toBe('Too many attempts. Try again in {n}s')
})
