'use client'

export function Avatar({ name, size = 40 }: { name: string; size?: number }) {
  // 按字符（码点）而非 UTF-16 码元取第一个字符
  const first = Array.from(name.trim())[0]?.toLocaleUpperCase() ?? ''
  return (
    <span
      aria-hidden
      className="inline-flex shrink-0 items-center justify-center rounded-full bg-lime font-extrabold text-ink select-none"
      style={{ width: size, height: size, fontSize: Math.round(size * 0.45) }}
    >
      {first}
    </span>
  )
}
