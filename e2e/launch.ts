import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import {
  _electron as electron,
  type ElectronApplication,
  type Locator,
  type Page,
} from '@playwright/test'

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
 * Puts the caret at the very end of a rich-text editor by clicking the end of its last block.
 * Keyboard shortcuts for "document end" differ per OS (Cmd+End does nothing on macOS) and
 * were unreliable on CI runners; a click is the same everywhere.
 */
export async function caretToEnd(editor: Locator): Promise<void> {
  const last = editor.locator(':scope > *').last()
  const box = await last.boundingBox()
  if (!box) throw new Error('editor has no visible last block')
  await last.click({ position: { x: box.width - 2, y: box.height - 2 } })
}

/**
 * Resizes the main window's content area (what the renderer lays out in; on Windows the frame
 * is extra). Never use `BrowserWindow.getAllWindows()[0]`: the hidden quick-add
 * window exists too and may come first.
 */
export async function resizeMainWindow(
  app: ElectronApplication,
  width: number,
  height: number,
): Promise<void> {
  // The size the OS actually granted (it may clamp to the screen).
  const [w, h] = await app.evaluate(
    ({ BrowserWindow }, [cw, ch]) => {
      const win = BrowserWindow.getAllWindows().find((x) =>
        x.webContents.getURL().split(/[?#]/)[0]?.endsWith('/index.html'),
      )
      if (!win) throw new Error('main window not found')
      win.setContentSize(cw, ch)
      return win.getContentSize()
    },
    [width, height] as const,
  )
  // The renderer relayouts asynchronously; geometry read before that is stale (slow runners).
  const page = await windowByEntry(app, 'index')
  await page.waitForFunction(
    ([ew, eh]) => {
      const g = globalThis as unknown as { innerWidth: number; innerHeight: number }
      return g.innerWidth === ew && g.innerHeight === eh
    },
    [w, h] as const,
  )
}

/**
 * Launches the built app (`out/main/index.js`) against a fresh temp userData dir
 * (MARTIN_TODOS_USER_DATA) in test mode (MARTIN_TODOS_E2E=1), so tests never touch real or dev
 * data, real global shortcuts or login items.
 */
export async function launchApp(options: { seed?: boolean } = {}): Promise<LaunchedApp> {
  const userData = mkdtempSync(join(tmpdir(), 'martin-todos-e2e-'))
  const app = await electron.launch({
    args: [resolve(__dirname, '../out/main/index.js'), ...(options.seed ? ['--seed'] : [])],
    env: {
      ...process.env,
      MARTIN_TODOS_USER_DATA: userData,
      MARTIN_TODOS_E2E: '1',
      ELECTRON_RENDERER_URL: '',
    },
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
