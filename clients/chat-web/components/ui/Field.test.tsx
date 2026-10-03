import { useState } from 'react'
import { renderWithProviders } from '@/test/render'
import { Field } from './Field'

function Harness(props: {
  type?: 'text' | 'email' | 'password'
  error?: string
}) {
  const [value, setValue] = useState('')
  return (
    <Field
      label="邮箱"
      name="email"
      type={props.type ?? 'email'}
      value={value}
      onChange={setValue}
      error={props.error}
    />
  )
}

describe('Field', () => {
  it('标签与输入框关联', () => {
    const { getByLabelText } = renderWithProviders(<Harness />)
    expect(getByLabelText('邮箱')).toHaveAttribute('name', 'email')
  })

  it('错误：aria-invalid 且错误文字可由 aria-describedby 找到', () => {
    const { getByLabelText } = renderWithProviders(
      <Harness error="邮箱格式不对" />,
    )
    const input = getByLabelText('邮箱')
    expect(input).toHaveAttribute('aria-invalid', 'true')
    expect(input).toHaveAccessibleDescription('邮箱格式不对')
  })

  it('无错误时不标记 aria-invalid', () => {
    const { getByLabelText } = renderWithProviders(<Harness />)
    expect(getByLabelText('邮箱')).not.toHaveAttribute('aria-invalid', 'true')
  })

  it('密码显隐：点击后 type 变为 text、按钮标签变为「隐藏密码」，值不变', async () => {
    const { user, getByLabelText, getByRole } = renderWithProviders(
      <Harness type="password" />,
    )
    const input = getByLabelText('邮箱') as HTMLInputElement
    await user.type(input, 'secret1')
    expect(input).toHaveAttribute('type', 'password')
    await user.click(getByRole('button', { name: '显示密码' }))
    expect(input).toHaveAttribute('type', 'text')
    expect(input.value).toBe('secret1')
    expect(getByRole('button', { name: '隐藏密码' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
  })

  it('非密码字段没有显隐按钮', () => {
    const { queryByRole } = renderWithProviders(<Harness />)
    expect(queryByRole('button')).toBeNull()
  })
})
