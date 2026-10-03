'use client'

import { Check, Circle } from 'lucide-react'
import type { Locale } from '@autix/contracts'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { useLocale, useTranslations } from 'next-intl'
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
import { register } from './session'
import {
  passwordRules,
  validateEmail,
  validateNickname,
} from './validation'

const EMAIL_TAKEN = 'errors.EMAIL_TAKEN'
const PASSWORD_MAX = 72

type Errors = { nickname?: string; email?: string }

function PasswordRules({
  password,
  submitted,
}: {
  password: string
  submitted: boolean
}) {
  const t = useTranslations('auth')
  const rules = passwordRules(password)
  const items = [
    { met: rules.length, label: t('ruleLength') },
    { met: rules.mixed, label: t('ruleMixed') },
  ]
  const state = (met: boolean) => (met ? t('ruleMet') : t('ruleUnmet'))
  return (
    <span className="flex flex-col gap-1">
      {items.map(({ met, label }) => (
        <span
          key={label}
          data-met={met}
          className={`flex items-center gap-1.5 text-sm ${
            met ? 'text-lime' : submitted ? 'text-danger' : 'text-white'
          }`}
        >
          {met ? (
            <Check aria-hidden className="size-4 shrink-0" />
          ) : (
            <Circle aria-hidden className="size-4 shrink-0" />
          )}
          {label}
          <span className="sr-only">{state(met)}</span>
        </span>
      ))}
    </span>
  )
}

export function RegisterForm() {
  const t = useTranslations()
  const locale = useLocale() as Locale
  const router = useRouter()
  const next = useSearchParams().get('next')
  const auth = useAuth()
  const countdown = useCountdown()
  const [pending] = useState(peekPendingPrompt)

  const [nickname, setNickname] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [errors, setErrors] = useState<Errors>({})
  const [passwordSubmitted, setPasswordSubmitted] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [shakeKey, setShakeKey] = useState(0)
  const inFlight = useRef(false)
  const nicknameRef = useRef<HTMLInputElement>(null)
  const emailRef = useRef<HTMLInputElement>(null)
  const passwordRef = useRef<HTMLInputElement>(null)

  const limited = countdown.seconds > 0
  const safe = next ? safeNext(next) : null
  const loginHref = safe ? `/login?next=${encodeURIComponent(safe)}` : '/login'

  function edit(field: keyof Errors, set: (v: string) => void) {
    return (value: string) => {
      set(value)
      setErrors((e) => (e[field] ? { ...e, [field]: undefined } : e))
    }
  }

  function showErrors(found: Errors, passwordBad: boolean) {
    setErrors(found)
    setPasswordSubmitted(passwordBad)
    if (found.nickname) nicknameRef.current?.focus()
    else if (found.email) emailRef.current?.focus()
    else if (passwordBad) passwordRef.current?.focus()
  }

  function renderError(key: string | undefined) {
    if (!key) return undefined
    if (key === EMAIL_TAKEN) {
      return (
        <>
          {t(EMAIL_TAKEN)}{' '}
          <Link
            href={loginHref}
            className="inline-flex min-h-11 items-center font-bold text-lime underline"
          >
            {t('auth.goLogin')}
          </Link>
        </>
      )
    }
    return t(key)
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    if (inFlight.current || limited) return
    const found: Errors = {}
    const nicknameKey = validateNickname(nickname)
    const emailKey = validateEmail(email)
    if (nicknameKey) found.nickname = nicknameKey
    if (emailKey) found.email = emailKey
    const rules = passwordRules(password)
    const passwordBad = !rules.length || !rules.mixed
    if (nicknameKey || emailKey || passwordBad) {
      showErrors(found, passwordBad)
      return
    }

    inFlight.current = true
    setSubmitting(true)
    setPasswordSubmitted(false)
    try {
      await register({
        email: email.trim(),
        password,
        nickname: nickname.trim(),
        locale,
      })
      router.replace(safeNext(next))
    } catch (err) {
      inFlight.current = false
      setSubmitting(false)
      if (!(err instanceof ApiRequestError)) {
        toast(t('errors.network'), { tone: 'danger' })
      } else if (err.code === 'EMAIL_TAKEN') {
        showErrors({ email: EMAIL_TAKEN }, false)
      } else if (err.code === 'RATE_LIMITED') {
        countdown.start(err.retryAfter ?? 1)
        setShakeKey((k) => k + 1)
      } else if (err.code === 'VALIDATION_FAILED') {
        const fields = (
          err.details as { fieldErrors?: Record<string, string[]> } | undefined
        )?.fieldErrors
        // 昵称、邮箱有对应文案；密码已满足两条规则，没有一条正确的字段文案，走通用提示
        const mapped: Errors = {}
        if (fields?.nickname) mapped.nickname = 'auth.nicknameTooLong'
        if (fields?.email) mapped.email = 'auth.invalidEmail'
        showErrors(mapped, false)
        if (!mapped.nickname && !mapped.email && fields?.password) {
          passwordRef.current?.focus()
        }
        if (fields?.password || (!mapped.nickname && !mapped.email)) {
          toast(t('errors.generic'), { tone: 'danger' })
        }
      } else {
        toast(t('errors.network'), { tone: 'danger' })
      }
    }
  }

  return (
    <AuthPanel shakeKey={shakeKey}>
      <form noValidate onSubmit={onSubmit} className="flex flex-col gap-5">
        <h1 className="text-3xl font-extrabold">{t('auth.registerTitle')}</h1>
        <PanelNotices
          pending={pending}
          sessionEnded={auth.status === 'guest' && auth.reason === 'reused'}
        />
        <Field
          ref={nicknameRef}
          label={t('auth.nickname')}
          name="nickname"
          type="text"
          value={nickname}
          onChange={edit('nickname', setNickname)}
          onBlur={() => {
            const key = validateNickname(nickname)
            if (key && nickname !== '')
              setErrors((er) => ({ ...er, nickname: key }))
          }}
          error={renderError(errors.nickname)}
          autoComplete="nickname"
          autoFocus
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
          error={renderError(errors.email)}
          autoComplete="email"
        />
        <Field
          ref={passwordRef}
          label={t('auth.password')}
          name="password"
          type="password"
          value={password}
          onChange={setPassword}
          hint={<PasswordRules password={password} submitted={passwordSubmitted} />}
          autoComplete="new-password"
          maxLength={PASSWORD_MAX}
        />
        {limited ? (
          <FormError>{t('errors.RATE_LIMITED', { n: countdown.seconds })}</FormError>
        ) : null}
        <PillButton
          type="submit"
          variant="lime"
          size="lg"
          loading={submitting}
          disabled={limited}
        >
          {t('auth.registerSubmit')}
        </PillButton>
        <Link
          href={loginHref}
          className="inline-flex min-h-11 items-center justify-center text-sm font-bold text-lime underline"
        >
          {t('auth.toLogin')}
        </Link>
      </form>
    </AuthPanel>
  )
}
