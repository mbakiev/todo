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

/** The page whose URL is the given renderer entry (`index` = main window). */
export async function windowByEntry(
  app: ElectronApplication,
  entry: 'index' | 'quick-add',
): Promise<Page> {
  const matches = (p: Page): boolean =>
    p.url().split(/[?#]/)[0]?.endsWith(`/${entry}.html`) ?? false
  const deadline = Date.now() + 20_000
  while (Date.now() < deadline) {
    const found = app.windows().find(matches)
    if (found) return found
    await new Promise((r) => setTimeout(r, 50))
  }
  throw new Error(`No ${entry}.html window appeared`)
}

async function mainWindowPage(app: ElectronApplication): Promise<Page> {
  return windowByEntry(app, 'index')
}

/**
 * Resizes the main window. Never use `BrowserWindow.getAllWindows()[0]`: the hidden quick-add
 * window exists too and may come first.
 */
export async function resizeMainWindow(
  app: ElectronApplication,
  width: number,
  height: number,
): Promise<void> {
  await app.evaluate(
    ({ BrowserWindow }, [w, h]) => {
      const win = BrowserWindow.getAllWindows().find((x) =>
        x.webContents.getURL().split(/[?#]/)[0]?.endsWith('/index.html'),
      )
      if (!win) throw new Error('main window not found')
      win.setSize(w, h)
    },
    [width, height] as const,
  )
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
  // The hidden quick-add window is created at startup too; pick the main window by entry.
  const page = await mainWindowPage(app)
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

/**
 * Inserts tasks straight through the main-process repos in one transaction (test runs only),
 * then reloads the main window so the renderer picks them up. Thousands of tasks take well
 * under a second, versus ~30 s one by one over IPC.
 */
export async function bulkCreateTasks(
  launched: Pick<LaunchedApp, 'app' | 'page'>,
  tasks: Array<Record<string, unknown> & { title: string }>,
): Promise<void> {
  await launched.app.evaluate((_electron, input) => {
    const hooks = (
      globalThis as unknown as {
        __martinTodosTest?: Record<string, (...args: unknown[]) => unknown>
      }
    ).__martinTodosTest
    if (!hooks?.bulkCreateTasks) throw new Error('bulkCreateTasks hook missing')
    return hooks.bulkCreateTasks(input)
  }, tasks)
  await launched.page.reload()
  await launched.page.waitForSelector('[data-slot="view"]')
}
