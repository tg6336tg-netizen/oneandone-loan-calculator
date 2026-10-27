import { defineConfig } from '@playwright/test'
import { existsSync } from 'node:fs'

export default defineConfig({
  testDir: './tests/browser', workers: 1, timeout: 180000,
  use: {
    baseURL: 'http://127.0.0.1:4180/oneandone-loan-calculator/',
    launchOptions: { executablePath: process.env.CHROMIUM_EXECUTABLE_PATH || (existsSync('/usr/bin/chromium') ? '/usr/bin/chromium' : undefined) },
    // Never persist documents in automatic traces, videos or screenshots.
    trace: 'off', screenshot: 'off', video: 'off',
  },
  webServer: {
    command: 'npm run build && npm run preview -- --host 127.0.0.1 --port 4180 --strictPort',
    url: 'http://127.0.0.1:4180/oneandone-loan-calculator/', reuseExistingServer: false, timeout: 120000,
  },
})
