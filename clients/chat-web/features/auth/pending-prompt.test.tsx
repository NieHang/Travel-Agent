import { render, waitFor } from '@testing-library/react'
import { StrictMode, useState } from 'react'
import {
  PENDING_KEY,
  peekPendingPrompt,
  savePendingPrompt,
  takePendingPrompt,
  truncatePrompt,
  usePendingPrompt,
  type PendingPrompt,
} from './pending-prompt'

function Probe({
  enabled,
  onReady,
}: {
  enabled: boolean
  onReady(p: PendingPrompt): void
}) {
  usePendingPrompt(enabled, onReady)
  return null
}

afterEach(() => {
  vi.restoreAllMocks()
})

it('take 读出后清除，第二次为 null', () => {
  savePendingPrompt({ prompt: '京都', conversationId: 'c1' })
  expect(takePendingPrompt()).toEqual({ prompt: '京都', conversationId: 'c1' })
  expect(sessionStorage.getItem(PENDING_KEY)).toBeNull()
  expect(takePendingPrompt()).toBeNull()
})

it('peek 不清除', () => {
  savePendingPrompt({ prompt: '京都' })
  expect(peekPendingPrompt()).toEqual({ prompt: '京都' })
  expect(peekPendingPrompt()).toEqual({ prompt: '京都' })
})

it('存储内容不是合法 JSON：peek 与 take 返回 null', () => {
  sessionStorage.setItem(PENDING_KEY, '{oops')
  expect(peekPendingPrompt()).toBeNull()
  expect(takePendingPrompt()).toBeNull()
})

it('存储内容形状不对：返回 null', () => {
  sessionStorage.setItem(PENDING_KEY, JSON.stringify({ prompt: 5 }))
  expect(peekPendingPrompt()).toBeNull()
})

it('sessionStorage 抛错时 save、peek、take 都不抛错', () => {
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
    throw new Error('denied')
  })
  vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
    throw new Error('denied')
  })
  vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => {
    throw new Error('denied')
  })
  expect(() => savePendingPrompt({ prompt: 'x' })).not.toThrow()
  expect(peekPendingPrompt()).toBeNull()
  expect(takePendingPrompt()).toBeNull()
})

describe('truncatePrompt', () => {
  it('不超过 40 个字符原样返回', () => {
    expect(truncatePrompt('旅'.repeat(40))).toBe('旅'.repeat(40))
  })
  it('超过 40 个字符截断并加省略号，按字符而不是 UTF-16 单元', () => {
    expect(truncatePrompt('旅'.repeat(50))).toBe('旅'.repeat(40) + '…')
    expect(truncatePrompt('😀'.repeat(41))).toBe('😀'.repeat(40) + '…')
  })
})

it('StrictMode 下 onReady 只调用一次，且调用时存储已清空', async () => {
  savePendingPrompt({ prompt: '里斯本 5 天' })
  const onReady = vi.fn(() => expect(sessionStorage.getItem(PENDING_KEY)).toBeNull())
  render(
    <StrictMode>
      <Probe enabled onReady={onReady} />
    </StrictMode>,
  )
  await waitFor(() => expect(onReady).toHaveBeenCalledTimes(1))
  expect(onReady).toHaveBeenCalledWith({ prompt: '里斯本 5 天' })
  await new Promise((r) => setTimeout(r, 20))
  expect(onReady).toHaveBeenCalledTimes(1)
})

it('没有暂存内容时不调用 onReady', async () => {
  const onReady = vi.fn()
  render(<Probe enabled onReady={onReady} />)
  await new Promise((r) => setTimeout(r, 20))
  expect(onReady).not.toHaveBeenCalled()
})

it('enabled 为 false 时不消费，变为 true 后消费', async () => {
  savePendingPrompt({ prompt: '大阪' })
  const onReady = vi.fn()
  function Toggle() {
    const [on, setOn] = useState(false)
    return (
      <>
        <button onClick={() => setOn(true)}>enable</button>
        <Probe enabled={on} onReady={onReady} />
      </>
    )
  }
  const { getByText } = render(<Toggle />)
  await new Promise((r) => setTimeout(r, 20))
  expect(onReady).not.toHaveBeenCalled()
  expect(peekPendingPrompt()).toEqual({ prompt: '大阪' })
  getByText('enable').click()
  await waitFor(() => expect(onReady).toHaveBeenCalledWith({ prompt: '大阪' }))
  expect(onReady).toHaveBeenCalledTimes(1)
})
