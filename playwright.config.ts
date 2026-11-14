import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  fullyParallel: false,
  workers: 1,
  // CI also writes an HTML report (playwright-report/), uploaded as an artifact on failure.
  reporter: process.env['CI'] ? [['list'], ['html', { open: 'never' }]] : [['list']],
  use: { trace: 'retain-on-failure' },
})
