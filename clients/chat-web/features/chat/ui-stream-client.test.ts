import { describe, expect, it, vi, beforeEach } from 'vitest'
import { streamUIChat } from './ui-stream-client'
import { apiFetch, ApiRequestError } from '@/features/auth/api-client'
vi.mock('@/features/auth/api-client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/features/auth/api-client')>()),
  apiFetch: vi.fn(),
}))
const mocked = vi.mocked(apiFetch)
beforeEach(() => mocked.mockReset())
function response(events: unknown[]) {
  const bytes = new TextEncoder().encode(
    events
      .map((e) => `event: message\ndata: ${JSON.stringify(e)}\n\n`)
      .join(''),
  )
  return new Response(
    new ReadableStream({
      start(c) {
        for (let i = 0; i < bytes.length; i += 3)
          c.enqueue(bytes.slice(i, i + 3))
        c.close()
      },
    }),
    { headers: { 'Content-Type': 'text/event-stream' } },
  )
}
describe('POST UI SSE transport', () => {
  it('normalizes native reader failures after opening the stream', async () => {
    let sent = false
    mocked.mockResolvedValue(
      new Response(
        new ReadableStream({
          pull(controller) {
            if (sent) {
              controller.error(new TypeError('connection lost'))
              return
            }
            sent = true
            controller.enqueue(
              new TextEncoder().encode(
                `event: message\ndata: ${JSON.stringify({ messageType: 'markdown', timestamp: new Date().toISOString(), payload: { messageId: 'm', content: 'part', isChunk: true } })}\n\n`,
              ),
            )
          },
        }),
        { headers: { 'Content-Type': 'text/event-stream' } },
      ),
    )
    const error = await streamUIChat(
      '/path',
      { content: 'hi' },
      new AbortController().signal,
      vi.fn(),
    ).catch((e) => e)
    expect(error).toBeInstanceOf(ApiRequestError)
    expect(error).toMatchObject({
      code: 'NETWORK',
      details: { streamOpened: true },
    })
    expect(mocked).toHaveBeenCalledTimes(1)
  })
  it('parses UTF-8 chunks and never retries a POST on missing terminal event', async () => {
    mocked.mockResolvedValue(
      response([
        {
          messageType: 'markdown',
          timestamp: new Date().toISOString(),
          payload: { messageId: 'm', content: '你好', isChunk: true },
        },
      ]),
    )
    const received = vi.fn()
    await expect(
      streamUIChat(
        '/path',
        { content: 'hi' },
        new AbortController().signal,
        received,
      ),
    ).rejects.toThrow()
    expect(received.mock.calls[0][0].payload.content).toBe('你好')
    expect(mocked).toHaveBeenCalledTimes(1)
  })
  it('rejects malformed envelopes without retry', async () => {
    mocked.mockResolvedValue(
      response([{ messageType: 'ui', payload: 'invalid' }]),
    )
    await expect(
      streamUIChat(
        '/path',
        { content: 'hi' },
        new AbortController().signal,
        vi.fn(),
      ),
    ).rejects.toThrow()
    expect(mocked).toHaveBeenCalledTimes(1)
  })
})
