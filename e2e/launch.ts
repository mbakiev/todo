import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { _electron as electron, type ElectronApplication, type Page } from '@playwright/test'

export interface LaunchedApp {
  app: ElectronApplication
  page: Page
  userData: string
  close(): Promise<void>
}

/**
 * Launches the built app (`out/main/index.js`) against a fresh temp userData dir
 * (MARTIN_TODOS_USER_DATA), so tests never touch real or dev data.
 */
export async function launchApp(options: { seed?: boolean } = {}): Promise<LaunchedApp> {
  const userData = mkdtempSync(join(tmpdir(), 'martin-todos-e2e-'))
  const app = await electron.launch({
    args: [resolve(__dirname, '../out/main/index.js'), ...(options.seed ? ['--seed'] : [])],
    env: { ...process.env, MARTIN_TODOS_USER_DATA: userData, ELECTRON_RENDERER_URL: '' },
  })
  const page = await app.firstWindow()
  await page.waitForSelector('[data-slot="view"]')
  return {
    app,
    page,
    userData,
    async close() {
      await app.close()
      rmSync(userData, { recursive: true, force: true })
    },
  }
}
