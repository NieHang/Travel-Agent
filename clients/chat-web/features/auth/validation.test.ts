import {
  passwordRules,
  validateEmail,
  validateNickname,
  validateRequired,
} from './validation'

describe('validateEmail', () => {
  it.each([
    ['', 'auth.required'],
    ['  ', 'auth.required'],
    ['a@', 'auth.invalidEmail'],
    [' Ann@Example.com ', null],
  ])('validateEmail(%j)', (input, expected) => {
    expect(validateEmail(input)).toBe(expected)
  })
})

describe('validateRequired', () => {
  it.each([
    ['', 'auth.required'],
    ['x', null],
    ['        ', null],
  ])('validateRequired(%j)', (input, expected) => {
    expect(validateRequired(input)).toBe(expected)
  })
})

describe('validateNickname', () => {
  it.each([
    ['', 'auth.required'],
    ['   ', 'auth.required'],
    ['x'.repeat(21), 'auth.nicknameTooLong'],
    ['旅'.repeat(20), null],
    [' a ', null],
  ])('validateNickname(%j)', (input, expected) => {
    expect(validateNickname(input)).toBe(expected)
  })
})

it('passwordRules', () => {
  expect(passwordRules('abc')).toEqual({ length: false, mixed: false })
  expect(passwordRules('abcdefgh')).toEqual({ length: true, mixed: false })
  expect(passwordRules('abc12345')).toEqual({ length: true, mixed: true })
  expect(passwordRules('12345678')).toEqual({ length: true, mixed: false })
})
