import { EmailSchema, NicknameSchema } from '@autix/contracts'

export function validateEmail(v: string): 'auth.required' | 'auth.invalidEmail' | null {
  if (v.trim() === '') return 'auth.required'
  return EmailSchema.safeParse(v).success ? null : 'auth.invalidEmail'
}

/** 密码只校验非空，不去掉首尾空白。 */
export function validateRequired(v: string): 'auth.required' | null {
  return v.length === 0 ? 'auth.required' : null
}

export function validateNickname(
  v: string,
): 'auth.required' | 'auth.nicknameTooLong' | null {
  if (v.trim() === '') return 'auth.required'
  return NicknameSchema.safeParse(v).success ? null : 'auth.nicknameTooLong'
}

// 与 PasswordSchema 同一组规则：min(8)、含字母、含数字
export function passwordRules(v: string): { length: boolean; mixed: boolean } {
  return {
    length: v.length >= 8,
    mixed: /[A-Za-z]/.test(v) && /[0-9]/.test(v),
  }
}
