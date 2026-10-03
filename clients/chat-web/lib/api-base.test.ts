import { http, HttpResponse } from 'msw'
import { API_BASE_URL } from './api-base'
import { server, apiUrl } from '@/test/server'

it('API_BASE_URL 没有末尾斜杠', () => expect(API_BASE_URL).toBe('http://localhost:4001'))

it('MSW 拦截得到发往后端的请求', async () => {
  server.use(http.get(apiUrl('/health'), () => HttpResponse.json({ ok: true })))
  const res = await fetch(apiUrl('/health'))
  expect(await res.json()).toEqual({ ok: true })
})

it('未声明的请求让测试失败', async () => {
  await expect(fetch(apiUrl('/nope'))).rejects.toThrow()
})
