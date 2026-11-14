// A crashed renderer never leaves a blank window: it is reloaded; a crash loop asks instead
// (answer stubbed with MARTIN_TODOS_CRASH_DIALOG_CHOICE, honoured only in test mode). A
// destroyed quick-add window is recreated.
import { expect, test, type ElectronApplication } from '@playwright/test'
import { launchShell, openQuickAdd, type ShellApp } from './shellHelpers'

let shell: ShellApp | undefined

test.afterEach(async () => {
  await shell?.close()
  shell = undefined
})

/**
 * Crashes the window's renderer and waits until the main process has seen it go
 * (`render-process-gone`). Without the wait the next "alive?" check can still see the old
 * renderer (on Windows the crash is noticed noticeably later) and a second crash would hit
 * the same dying process, so the crash loop would never be counted.
 */
async function crash(app: ElectronApplication, entry: 'index' | 'quick-add'): Promise<void> {
  await app.evaluate(
    ({ BrowserWindow }, e) =>
      new Promise<void>((resolveGone, reject) => {
        const win = BrowserWindow.getAllWindows().find((w) =>
          w.webContents.getURL().split(/[?#]/)[0]?.endsWith(`/${e}.html`),
        )
        if (!win) return reject(new Error(`no ${e} window`))
        win.webContents.once('render-process-gone', () => resolveGone())
        win.webContents.forcefullyCrashRenderer()
      }),
    entry,
  )
}

async function rendererAlive(app: ElectronApplication, entry: 'index' | 'quick-add') {
  return app.evaluate(
    ({ BrowserWindow }, e) =>
      BrowserWindow.getAllWindows().some(
        (w) =>
          w.webContents.getURL().split(/[?#]/)[0]?.endsWith(`/${e}.html`) &&
          !w.webContents.isCrashed() &&
          !w.webContents.isLoading(),
      ),
    entry,
  )
}

test('a crashed main-window renderer is reloaded, not left blank', async () => {
  const s = (shell = await launchShell({ seed: true }))
  await crash(s.app, 'index')
  await expect.poll(() => rendererAlive(s.app, 'index'), { timeout: 10_000 }).toBe(true)
  // Playwright's Page for the crashed target stays dead; ask the reloaded renderer directly.
  const taskCards = (): Promise<number> =>
    s.app.evaluate(async ({ BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows().find((w) =>
        w.webContents.getURL().split(/[?#]/)[0]?.endsWith('/index.html'),
      )
      return (await win?.webContents.executeJavaScript(
        "document.querySelectorAll('[data-task-id]').length",
      )) as number
    })
  await expect.poll(taskCards, { timeout: 10_000 }).toBeGreaterThan(0)
})

test('three crashes within a minute ask instead of reloading forever (Quit exits)', async () => {
  shell = await launchShell({ env: { MARTIN_TODOS_CRASH_DIALOG_CHOICE: 'quit' } })
  const s = shell
  shell = undefined
  const exited = new Promise<void>((done) => s.app.process().once('exit', () => done()))
  for (let i = 0; i < 3; i++) {
    await expect.poll(() => rendererAlive(s.app, 'index'), { timeout: 10_000 }).toBe(true)
    await crash(s.app, 'index')
  }
  await exited
})

test('the quick-add window comes back after a crash and after being destroyed', async () => {
  const s = (shell = await launchShell())
  await openQuickAdd(s.app)
  await crash(s.app, 'quick-add')
  await expect.poll(() => rendererAlive(s.app, 'quick-add'), { timeout: 10_000 }).toBe(true)

  await s.app.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()
      .find((w) => w.webContents.getURL().split(/[?#]/)[0]?.endsWith('/quick-add.html'))
      ?.destroy()
  })
  await expect.poll(() => rendererAlive(s.app, 'quick-add'), { timeout: 10_000 }).toBe(true)
  const page = await openQuickAdd(s.app)
  await expect(page.getByTestId('quick-add-form')).toBeVisible()
})
