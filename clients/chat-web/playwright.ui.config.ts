import { defineConfig } from '@playwright/test'
import base from './playwright.config'
// Verification against the already-running, test-owned servers.
export default defineConfig({ ...base, webServer: undefined })
