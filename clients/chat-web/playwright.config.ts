import { defineConfig } from '@playwright/test'
import path from 'node:path'

export default defineConfig({
  testDir: './e2e', timeout: 45_000, expect: { timeout: 15_000 }, retries: 0, workers: 1,
  reporter: [['list']], use: { baseURL: 'http://localhost:3102', locale: 'zh-CN',
    viewport: { width: 1440, height: 1000 }, trace: 'retain-on-failure' },
  webServer: [
    { cwd: path.resolve(__dirname, '../../services/chat'),
      command: 'bun run db:generate && bunx nest build && bun --env-file=.env.test dist/main.js',
      env: { PORT: '4101', CORS_ORIGIN: 'http://localhost:3102', LLM_FAKE: '1' },
      url: 'http://localhost:4101/health', timeout: 120_000, reuseExistingServer: false },
    { command: 'bunx next dev --port 3102', env: { NEXT_PUBLIC_API_BASE_URL: 'http://localhost:4101' },
      url: 'http://localhost:3102', timeout: 120_000, reuseExistingServer: false },
  ],
})
