const FALLBACK = '/chat'
const BACKSLASH = 0x5c

function isSafePath(value: string): boolean {
  if (value[0] !== '/') return false
  if (value[1] === '/' || value[1] === '\\') return false
  for (let i = 0; i < value.length; i += 1) {
    const code = value.charCodeAt(i)
    if (code === BACKSLASH || code <= 0x1f || code === 0x7f) return false
  }
  return true
}

export function safeNext(raw: string | null | undefined): string {
  if (!raw || !isSafePath(raw)) return FALLBACK
  try {
    return isSafePath(decodeURIComponent(raw)) ? raw : FALLBACK
  } catch {
    return FALLBACK
  }
}
