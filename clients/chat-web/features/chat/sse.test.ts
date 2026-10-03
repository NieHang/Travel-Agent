import { describe, expect, it } from 'vitest'
import { makeMessage } from '@/test/fixtures'
import { createSseParser } from './sse'

const enc = (s: string) => new TextEncoder().encode(s)
const delta = (text: string) =>
  `event: delta\ndata: ${JSON.stringify({ text })}\n\n`

describe('createSseParser', () => {
  it('一块里的两个事件', () => {
    const p = createSseParser()
    expect(p.push(enc(delta('a') + delta('b')))).toEqual([
      { event: 'delta', data: { text: 'a' } },
      { event: 'delta', data: { text: 'b' } },
    ])
  })

  it('事件被拆在任意位置：逐字节喂入，结果相同', () => {
    const p = createSseParser()
    const out = [...enc(delta('好的，') + delta('里斯本'))].flatMap((b) =>
      p.push(Uint8Array.of(b)),
    )
    expect(out.map((e) => e.event === 'delta' && e.data.text)).toEqual([
      '好的，',
      '里斯本',
    ])
  })

  it('CRLF 换行', () => {
    const p = createSseParser()
    const raw = delta('a').replace(/\n/g, '\r\n') + delta('b').replace(/\n/g, '\r\n')
    expect(p.push(enc(raw))).toEqual([
      { event: 'delta', data: { text: 'a' } },
      { event: 'delta', data: { text: 'b' } },
    ])
  })

  it('CRLF 的 \r 与 \n 被拆在两个块之间', () => {
    const p = createSseParser()
    const raw = delta('a').replace(/\n/g, '\r\n')
    const out = [...enc(raw)].flatMap((b) => p.push(Uint8Array.of(b)))
    expect(out).toEqual([{ event: 'delta', data: { text: 'a' } }])
  })

  it('忽略注释行与未知事件名', () => {
    const p = createSseParser()
    expect(p.push(enc(': ping\n\n'))).toEqual([])
    expect(p.push(enc('event: ping\ndata: {}\n\n'))).toEqual([])
    expect(p.push(enc(': hi\n' + delta('x')))).toEqual([
      { event: 'delta', data: { text: 'x' } },
    ])
  })

  it('没有 data 的块被忽略', () => {
    const p = createSseParser()
    expect(p.push(enc('event: delta\n\n'))).toEqual([])
  })

  it('data 不是 JSON、或形状不符：丢弃，后续事件照常解析', () => {
    const p = createSseParser()
    const raw =
      'event: delta\ndata: {oops\n\n' +
      'event: delta\ndata: {"text":1}\n\n' +
      delta('ok')
    expect(p.push(enc(raw))).toEqual([{ event: 'delta', data: { text: 'ok' } }])
  })

  it('没有结尾空行的半个事件不产出，补上空行后产出', () => {
    const p = createSseParser()
    expect(p.push(enc('event: delta\ndata: {"text":"a"}\n'))).toEqual([])
    expect(p.push(enc('\n'))).toEqual([{ event: 'delta', data: { text: 'a' } }])
  })

  it('一个汉字的字节被拆在两个块：不出现乱码', () => {
    const p = createSseParser()
    const bytes = enc(delta('好'))
    const cut = bytes.indexOf(0xe5) + 1
    expect(p.push(bytes.slice(0, cut))).toEqual([])
    expect(p.push(bytes.slice(cut))).toEqual([
      { event: 'delta', data: { text: '好' } },
    ])
  })

  it('多行 data：用换行连接后再按 JSON 解析', () => {
    const p = createSseParser()
    expect(p.push(enc('event: delta\ndata: {"text":\ndata: "a"}\n\n'))).toEqual([
      { event: 'delta', data: { text: 'a' } },
    ])
  })

  it('开头的 BOM 被忽略', () => {
    const p = createSseParser()
    expect(
      p.push(Uint8Array.from([0xef, 0xbb, 0xbf, ...enc(delta('a'))])),
    ).toEqual([{ event: 'delta', data: { text: 'a' } }])
  })

  it('done 之后同一块里的事件照常解析（由调用方决定是否忽略）', () => {
    const p = createSseParser()
    const message = makeMessage({ role: 'ASSISTANT' })
    const raw = `event: done\ndata: ${JSON.stringify({ message })}\n\n` + delta('x')
    expect(p.push(enc(raw)).map((e) => e.event)).toEqual(['done', 'delta'])
  })

  it('解析带完整消息的 done 事件', () => {
    const p = createSseParser()
    const message = makeMessage({ role: 'ASSISTANT' })
    const raw = `event: done\ndata: ${JSON.stringify({ message })}\n\n`
    expect(p.push(enc(raw))).toEqual([{ event: 'done', data: { message } }])
  })
})
