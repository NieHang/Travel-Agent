import type { Locale } from '@autix/contracts'
import en from '@/messages/en.json'
import zh from '@/messages/zh.json'

const MESSAGES = { zh, en }

export type Messages = typeof zh

export function loadMessages(locale: Locale): Messages {
  return MESSAGES[locale]
}
