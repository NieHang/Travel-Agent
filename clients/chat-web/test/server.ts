import { setupServer } from 'msw/node'
import { http, HttpResponse } from 'msw'
import { API_BASE_URL } from '@/lib/api-base'

export const server = setupServer(
  http.get(apiUrl('/api/conversations/:id/ui-state'), () =>
    HttpResponse.json({ trip: null, activeMessage: null }),
  ),
)

export function apiUrl(path: string): string {
  return API_BASE_URL + path
}
