// Helpers for the desktop-shell e2e specs: launching against a reusable userData dir,
// the main-process test hooks (installed only when MARTIN_TODOS_USER_DATA is set), and
// window visibility checks.
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { _electron as electron, type ElectronApplication, type Page } from '@playwright/test'
import { windowByEntry } from './launch'

export interface ShellApp {
  app: ElectronApplication
  page: Page
  userData: string
  /** Quits the app; removes userData unless `keepUserData`. */
  close(options?: { keepUserData?: boolean }): Promise<void>
}

export const MOD = process.platform === 'darwin' ? 'Meta' : 'Control'

export function tempUserData(): string {
  return mkdtempSync(join(tmpdir(), 'martin-todos-e2e-'))
}

export async function launchShell(
  options: { userData?: string; seed?: boolean; env?: Record<string, string> } = {},
): Promise<ShellApp> {
  const userData = options.userData ?? tempUserData()
  const app = await electron.launch({
    args: [resolve(__dirname, '../out/main/index.js'), ...(options.seed ? ['--seed'] : [])],
    env: {
      ...process.env,
      MARTIN_TODOS_USER_DATA: userData,
      ELECTRON_RENDERER_URL: '',
      ...options.env,
    },
  })
  const page = await windowByEntry(app, 'index')
  await page.waitForSelector('[data-slot="view"]')
  return {
    app,
    page,
    userData,
    async close({ keepUserData = false } = {}) {
      await app.close()
      if (!keepUserData) rmSync(userData, { recursive: true, force: true })
    },
  }
}

type Hooks = Record<string, (...args: unknown[]) => unknown>

/** Calls a `__martinTodosTest` hook in the main process. */
export async function hook(
  app: ElectronApplication,
  name: string,
  ...args: unknown[]
): Promise<unknown> {
  return app.evaluate(
    (_electron, [n, a]) => {
      const hooks = (globalThis as unknown as { __martinTodosTest?: Hooks }).__martinTodosTest
      const fn = hooks?.[n as string]
      if (!fn) throw new Error(`No test hook ${String(n)}`)
      return fn(...(a as unknown[]))
    },
    [name, args] as const,
  )
}

export async function windowVisible(
  app: ElectronApplication,
  entry: 'index' | 'quick-add',
): Promise<boolean> {
  return app.evaluate(
    ({ BrowserWindow }, e) =>
      BrowserWindow.getAllWindows().some(
        (w) => w.webContents.getURL().split(/[?#]/)[0]?.endsWith(`/${e}.html`) && w.isVisible(),
      ),
    entry,
  )
}

/** Shows the quick-add popup the way the global shortcut does, and returns its page. */
export async function openQuickAdd(app: ElectronApplication): Promise<Page> {
  await hook(app, 'triggerShortcut', 'quickAdd')
  const page = await windowByEntry(app, 'quick-add')
  await page.waitForSelector('[data-testid="quick-add-form"]')
  return page
}
