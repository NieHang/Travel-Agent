'use client'

import { APP_NAME, type RequirementResult } from '@autix/contracts'
import { useState, type FormEvent } from 'react'

export default function Home() {
  const [input, setInput] = useState('用户注册时必须绑定手机号，密码至少8位')
  const [result, setResult] = useState<RequirementResult | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  async function extractRequirement(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (loading) return
    setLoading(true)
    setError('')
    setResult(null)
    try {
      const baseUrl = process.env.NEXT_PUBLIC_API_BASE_URL || 'http://localhost:4001'
      const res = await fetch(`${baseUrl.replace(/\/$/, '')}/requirement/extract`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ input }),
      })
      if (!res.ok) throw new Error(`需求抽取失败（HTTP ${res.status}）`)
      const data: RequirementResult = await res.json()
      setResult(data)
    } catch (err) {
      setError(err instanceof Error ? err.message : '需求抽取失败，请重试')
    } finally {
      setLoading(false)
    }
  }

  return (
    <main style={{ padding: 24 }}>
      <h1>{APP_NAME}</h1>
      <h2>需求结构化抽取</h2>
      <form onSubmit={extractRequirement} style={{ marginTop: 16 }}>
        <label htmlFor="requirement-input">输入需求</label>
        <textarea
          id="requirement-input"
          value={input}
          onChange={(event) => setInput(event.target.value)}
          rows={5}
          disabled={loading}
          style={{ display: 'block', width: '100%', maxWidth: 720, margin: '8px 0 16px' }}
        />
        <button type="submit" disabled={loading}>
          {loading ? '抽取中…' : '提交'}
        </button>
      </form>
      {error && <p role="alert" style={{ marginTop: 16 }}>{error}</p>}
      <h2 style={{ marginTop: 24 }}>JSON 结果</h2>
      <pre aria-live="polite" style={{ marginTop: 16, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>
        {JSON.stringify(result ?? {}, null, 2)}
      </pre>
    </main>
  )
}

