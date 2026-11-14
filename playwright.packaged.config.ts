// Playwright config for `npm run test:packaged` (e2e/packaged.smoke.ts): a smoke test of the
// electron-builder output, run in CI after packaging. Kept apart from playwright.config.ts so
// `npm run test:e2e` never launches a packaged build.
import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './e2e',
  testMatch: 'packaged.smoke.ts',
  timeout: 90_000,
  workers: 1,
  reporter: process.env['CI'] ? [['list'], ['html', { open: 'never' }]] : [['list']],
  outputDir: './test-results/packaged',
  use: { trace: 'retain-on-failure' },
})
