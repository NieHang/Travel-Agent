'use client'

import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { useRef, useState, type FormEvent } from 'react'
import { Field } from '@/components/ui/Field'
import { PillButton } from '@/components/ui/PillButton'
import { toast } from '@/components/ui/toast'
import { useCountdown } from '@/lib/use-countdown'
import { AuthPanel, FormError, PanelNotices } from './AuthPanel'
import { ApiRequestError } from './api-client'
import { useAuth } from './auth-store'
import { peekPendingPrompt } from './pending-prompt'
import { safeNext } from './safe-next'
import { login } from './session'
import { validateEmail, validateRequired } from './validation'


type Errors = { email?: string; password?: string }

export function LoginForm() {
  const t = useTranslations()
  const router = useRouter()
  const next = useSearchParams().get('next')
  const auth = useAuth()
  const countdown = useCountdown()
  const [pending] = useState(peekPendingPrompt)

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [errors, setErrors] = useState<Errors>({})
  const [credentialsError, setCredentialsError] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [shakeKey, setShakeKey] = useState(0)
  const inFlight = useRef(false)
  const emailRef = useRef<HTMLInputElement>(null)
  const passwordRef = useRef<HTMLInputElement>(null)

  const limited = countdown.seconds > 0
  const registerHref = next
    ? `/register?next=${encodeURIComponent(safeNext(next))}`
    : '/register'

  function edit(field: keyof Errors, set: (v: string) => void) {
    return (value: string) => {
      set(value)
      // 限流提示有意保留：它随倒计时自行消失，只有凭据错误在修改输入后清除
      setCredentialsError(false)
      setErrors((e) => (e[field] ? { ...e, [field]: undefined } : e))
    }
  }

  function showFieldErrors(found: Errors) {
    setErrors(found)
    if (found.email) emailRef.current?.focus()
    else if (found.password) passwordRef.current?.focus()
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    if (inFlight.current || limited) return
    const found: Errors = {}
    const emailKey = validateEmail(email)
    const passwordKey = validateRequired(password)
    if (emailKey) found.email = emailKey
    if (passwordKey) found.password = passwordKey
    if (emailKey || passwordKey) {
      showFieldErrors(found)
      return
    }

    inFlight.current = true
    setSubmitting(true)
    setCredentialsError(false)
    try {
      await login({ email: email.trim(), password })
      router.replace(safeNext(next))
    } catch (err) {
      inFlight.current = false
      setSubmitting(false)
      if (!(err instanceof ApiRequestError)) {
        toast(t('errors.network'), { tone: 'danger' })
      } else if (err.code === 'INVALID_CREDENTIALS') {
        setCredentialsError(true)
        setPassword('')
        setShakeKey((k) => k + 1)
        passwordRef.current?.focus()
      } else if (err.code === 'RATE_LIMITED') {
        countdown.start(err.retryAfter ?? 1)
        setShakeKey((k) => k + 1)
      } else if (err.code === 'VALIDATION_FAILED') {
        const fields = (
          err.details as { fieldErrors?: Record<string, string[]> } | undefined
        )?.fieldErrors
        // 邮箱有对应文案；密码已通过非空校验，没有一条正确的字段文案，走通用提示
        const mapped: Errors = {}
        if (fields?.email) mapped.email = 'auth.invalidEmail'
        setErrors(mapped)
        if (fields?.email) emailRef.current?.focus()
        else if (fields?.password) passwordRef.current?.focus()
        if (!fields?.email || fields?.password) {
          toast(t('errors.generic'), { tone: 'danger' })
        }
      } else {
        toast(t('errors.network'), { tone: 'danger' })
      }
    }
  }

  const formError = limited
    ? t('errors.RATE_LIMITED', { n: countdown.seconds })
    : credentialsError
      ? t('errors.INVALID_CREDENTIALS')
      : null

  return (
    <AuthPanel shakeKey={shakeKey}>
      <form noValidate onSubmit={onSubmit} className="flex flex-col gap-5">
        <h1 className="text-3xl font-extrabold">{t('auth.loginTitle')}</h1>
        <PanelNotices
          pending={pending}
          sessionEnded={auth.status === 'guest' && auth.reason === 'reused'}
        />
        <Field
          ref={emailRef}
          label={t('auth.email')}
          name="email"
          type="email"
          value={email}
          onChange={edit('email', setEmail)}
          onBlur={() => {
            const key = validateEmail(email)
            if (key && email !== '') setErrors((er) => ({ ...er, email: key }))
          }}
          error={errors.email ? t(errors.email) : undefined}
          autoComplete="email"
          autoFocus
        />
        <Field
          ref={passwordRef}
          label={t('auth.password')}
          name="password"
          type="password"
          value={password}
          onChange={edit('password', setPassword)}
          error={errors.password ? t(errors.password) : undefined}
          autoComplete="current-password"
        />
        {formError ? <FormError>{formError}</FormError> : null}
        <PillButton
          type="submit"
          variant="lime"
          size="lg"
          loading={submitting}
          disabled={limited}
        >
          {t('auth.loginSubmit')}
        </PillButton>
        <Link
          href={registerHref}
          className="inline-flex min-h-11 items-center justify-center text-sm font-bold text-lime underline"
        >
          {t('auth.toRegister')}
        </Link>
      </form>
    </AuthPanel>
  )
}
