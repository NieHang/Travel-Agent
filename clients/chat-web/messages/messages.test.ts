import zh from './zh.json'
import en from './en.json'

const keys = (o: object, p = ''): string[] =>
  Object.entries(o).flatMap(([k, v]) => (typeof v === 'object' ? keys(v, `${p}${k}.`) : [`${p}${k}`]))
const placeholders = (s: string) => [...s.matchAll(/\{(\w+)/g)].map((m) => m[1]).sort()
const getMessage = (dict: object, key: string): string => {
  const value = key.split('.').reduce<unknown>((node, part) => {
    if (typeof node !== 'object' || node === null) throw new Error(`Invalid message path: ${key}`)
    return Reflect.get(node, part)
  }, dict)
  if (typeof value !== 'string') throw new Error(`Expected a string message: ${key}`)
  return value
}

it('zh 与 en 的键完全一致', () => expect(keys(zh).sort()).toEqual(keys(en).sort()))
it('没有空文案', () => {
  for (const dict of [zh, en]) for (const k of keys(dict)) expect(getMessage(dict, k)).not.toBe('')
})
it('同一个键的占位符一致', () => {
  for (const k of keys(zh)) {
    expect(placeholders(getMessage(en, k))).toEqual(placeholders(getMessage(zh, k)))
  }
})
it('抽查文案', () => {
  expect(zh.landing.title).toBe('下一站，去哪？')
  expect(en.landing.title).toBe('Where to next?')
  expect(en.errors.RATE_LIMITED).toBe('Too many attempts. Try again in {n}s')
})
