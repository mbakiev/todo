// Playwright config for `npm run guide:screenshots` (scripts/capture-guide-screenshots.ts).
// Kept apart from playwright.config.ts so `npm run test:e2e` never regenerates the guide images.
import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: '.',
  testMatch: 'capture-guide-screenshots.ts',
  timeout: 240_000,
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  outputDir: '../test-results/guide-screenshots',
})
