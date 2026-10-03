import type { Locale } from '@autix/contracts'

export const LOCALE_COOKIE = 'hilda_locale'
export const DEFAULT_LOCALE: Locale = 'zh'

const isLocale = (v: string | undefined): v is Locale => v === 'zh' || v === 'en'

/** Cookie wins; otherwise the first recognised Accept-Language entry (by q, then order); otherwise zh. */
export function resolveLocale(cookie: string | undefined, acceptLanguage: string | null): Locale {
  if (isLocale(cookie)) return cookie
  if (!acceptLanguage) return DEFAULT_LOCALE
  const ranked = acceptLanguage
    .split(',')
    .map((part, index) => {
      const [tag, ...params] = part.trim().split(';')
      const q = params.map((p) => p.trim()).find((p) => p.startsWith('q='))
      const weight = q ? Number(q.slice(2)) : 1
      return { primary: tag.trim().toLowerCase().split('-')[0], weight: Number.isNaN(weight) ? 0 : weight, index }
    })
    .sort((a, b) => b.weight - a.weight || a.index - b.index)
  const hit = ranked.find((r) => r.weight > 0 && isLocale(r.primary))
  return hit && isLocale(hit.primary) ? hit.primary : DEFAULT_LOCALE
}

export function writeLocaleCookie(locale: Locale): void {
  document.cookie = `${LOCALE_COOKIE}=${locale}; path=/; max-age=31536000; samesite=lax`
}
