import { fireEvent, screen } from '@testing-library/react'
import { useState } from 'react'
import { renderWithProviders } from '@/test/render'
import { Composer } from './Composer'

function setup(over: Partial<React.ComponentProps<typeof Composer>> = {}, initial = '') {
  const onSend = vi.fn()
  const onStop = vi.fn()
  function Host() {
    const [value, setValue] = useState(initial)
    return (
      <Composer
        value={value}
        onChange={setValue}
        generating={false}
        rateLimitSeconds={0}
        onSend={onSend}
        onStop={onStop}
        {...over}
      />
    )
  }
  const view = renderWithProviders(<Host />)
  return { ...view, onSend, onStop, input: screen.getByRole('textbox') }
}

it('回车发送，Shift+回车换行', async () => {
  const { user, onSend, input } = setup()
  await user.type(input, '你好')
  await user.keyboard('{Shift>}{Enter}{/Shift}')
  expect(onSend).not.toHaveBeenCalled()
  expect(input).toHaveValue('你好\n')
  await user.keyboard('{Enter}')
  expect(onSend).toHaveBeenCalledTimes(1)
})

it('输入法组字中的回车不发送', () => {
  const { onSend, input } = setup({}, '你好')
  fireEvent.keyDown(input, { key: 'Enter', isComposing: true })
  fireEvent.keyDown(input, { key: 'Enter', keyCode: 229 })
  expect(onSend).not.toHaveBeenCalled()
  fireEvent.keyDown(input, { key: 'Enter' })
  expect(onSend).toHaveBeenCalledTimes(1)
})

it('空或全空白：发送按钮禁用，回车不触发 onSend', async () => {
  const { user, onSend, input } = setup()
  expect(screen.getByRole('button', { name: '发送' })).toBeDisabled()
  await user.type(input, '   ')
  expect(screen.getByRole('button', { name: '发送' })).toBeDisabled()
  await user.keyboard('{Enter}')
  expect(onSend).not.toHaveBeenCalled()
})

it('有内容时点击发送按钮触发 onSend', async () => {
  const { user, onSend } = setup({}, '你好')
  await user.click(screen.getByRole('button', { name: '发送' }))
  expect(onSend).toHaveBeenCalledTimes(1)
})

it('generating：按钮读屏标签为「停止」，点击触发 onStop；输入框仍可输入，回车不发送', async () => {
  const { user, onSend, onStop, input } = setup({ generating: true })
  expect(screen.queryByRole('button', { name: '发送' })).not.toBeInTheDocument()
  await user.type(input, 'abc{Enter}')
  expect(onSend).not.toHaveBeenCalled()
  await user.click(screen.getByRole('button', { name: '停止' }))
  expect(onStop).toHaveBeenCalledTimes(1)
})

it('3799 字不显示计数；3800 字显示「3800 / 4000」；输入框 maxLength 为 4000', () => {
  const { unmount, input } = setup({}, 'a'.repeat(3799))
  expect(input).toHaveAttribute('maxlength', '4000')
  expect(screen.queryByText(/\/ 4000/)).not.toBeInTheDocument()
  unmount()
  setup({}, 'a'.repeat(3800))
  expect(screen.getByText('3800 / 4000')).toBeInTheDocument()
})

it('rateLimitSeconds 为 5：显示「发送太快了，请 5 秒后再试」且发送禁用；为 0 时不显示', () => {
  const { unmount } = setup({ rateLimitSeconds: 5 }, '你好')
  expect(screen.getByText('发送太快了，请 5 秒后再试')).toBeInTheDocument()
  expect(screen.getByRole('button', { name: '发送' })).toBeDisabled()
  unmount()
  setup({ rateLimitSeconds: 0 }, '你好')
  expect(screen.queryByText(/发送太快了/)).not.toBeInTheDocument()
  expect(screen.getByRole('button', { name: '发送' })).toBeEnabled()
})

it('ref 指向输入框', () => {
  let el: HTMLTextAreaElement | null = null
  renderWithProviders(
    <Composer
      ref={(node) => {
        el = node
      }}
      value=""
      onChange={() => {}}
      generating={false}
      rateLimitSeconds={0}
      onSend={() => {}}
      onStop={() => {}}
    />,
  )
  expect(el).toBe(screen.getByRole('textbox'))
})
