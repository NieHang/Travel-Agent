import type { Locale } from '@autix/contracts'
import { zh } from './zh'
import { en } from './en'
export function getTripMock(locale: Locale) { return locale === 'en' ? en : zh }
