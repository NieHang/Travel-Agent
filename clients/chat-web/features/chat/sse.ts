import { ChatStreamEventSchema, type ChatStreamEvent } from '@autix/contracts'

const BLOCK_END = /\r?\n\r?\n/

function parseBlock(block: string): ChatStreamEvent | null {
  let name = ''
  const data: string[] = []
  for (const line of block.split(/\r?\n/)) {
    if (line === '' || line.startsWith(':')) continue
    const colon = line.indexOf(':')
    const field = colon === -1 ? line : line.slice(0, colon)
    let value = colon === -1 ? '' : line.slice(colon + 1)
    if (value.startsWith(' ')) value = value.slice(1)
    if (field === 'event') name = value
    else if (field === 'data') data.push(value)
  }
  if (data.length === 0) return null
  let json: unknown
  try {
    json = JSON.parse(data.join('\n'))
  } catch {
    return null
  }
  const parsed = ChatStreamEventSchema.safeParse({ event: name, data: json })
  return parsed.success ? parsed.data : null
}

/** 字节级 SSE 解析器：按空行分事件，非法或未知事件丢弃。 */
export function createSseParser(): {
  push(chunk: Uint8Array): ChatStreamEvent[]
} {
  const decoder = new TextDecoder('utf-8')
  let buffer = ''
  return {
    push(chunk) {
      buffer += decoder.decode(chunk, { stream: true })
      const events: ChatStreamEvent[] = []
      for (;;) {
        const match = BLOCK_END.exec(buffer)
        if (!match) break
        const block = buffer.slice(0, match.index)
        buffer = buffer.slice(match.index + match[0].length)
        const event = parseBlock(block)
        if (event) events.push(event)
      }
      return events
    },
  }
}
