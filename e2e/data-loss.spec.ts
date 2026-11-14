// Data-loss checks (spec §7 "never lose keystrokes"): text typed in the detail panel survives
// hiding the window and quitting the app inside the autosave debounce window.
import { expect, test, type Page } from '@playwright/test'
import type { Api } from '../src/shared/ipc'
import type { Task } from '../src/shared/types'
import { caretToEnd } from './launch'
import { hook, launchShell, tempUserData, type ShellApp } from './shellHelpers'

let shell: ShellApp | undefined

test.afterEach(async () => {
  await shell?.close()
  shell = undefined
})

const TASK = 'Reply to Anna about the offsite agenda'
const panel = (page: Page) => page.getByTestId('task-detail')
const editor = (page: Page) => panel(page).getByRole('textbox', { name: 'Description' })
const titleBox = (page: Page) => panel(page).getByRole('textbox', { name: 'Title' })

async function openTask(page: Page, title: string): Promise<void> {
  await page.locator('[data-task-id]', { hasText: title }).first().click()
  await expect(titleBox(page)).toHaveValue(title)
}

async function dbTasks(page: Page): Promise<Task[]> {
  return page.evaluate(() => (globalThis as unknown as { api: Api }).api.tasks.list())
}

async function hideMainWindow(s: ShellApp): Promise<void> {
  await s.app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()
      .find((w) => w.webContents.getURL().split(/[?#]/)[0]?.endsWith('/index.html'))
      ?.close(),
  )
}

async function typeDescription(page: Page, text: string): Promise<void> {
  await caretToEnd(editor(page))
  await page.keyboard.type(text)
}

async function typeTitle(page: Page, text: string): Promise<void> {
  await titleBox(page).click()
  await page.keyboard.press('End')
  await page.keyboard.type(text)
}

for (const field of ['description', 'title'] as const) {
  test(`${field}: hiding the window inside the debounce saves it`, async () => {
    shell = await launchShell({ seed: true })
    const { page } = shell
    await openTask(page, TASK)
    const marker = ` hidden-${field}`
    if (field === 'title') await typeTitle(page, marker)
    else await typeDescription(page, marker)
    const typedAt = Date.now()
    await hideMainWindow(shell)
    const saved = async (): Promise<Task | undefined> =>
      (await dbTasks(page)).find((t) => t[field].includes(marker.trim()))
    await expect.poll(async () => (await saved()) !== undefined).toBe(true)
    // Saved by the hide itself, before the 500 ms debounce would have fired. Judged by the
    // row's own updatedAt (same clock), not by how long the polling round trips take — a
    // busy CI runner can need several hundred ms per IPC call.
    expect(((await saved())?.updatedAt ?? Infinity) - typedAt).toBeLessThan(500)
  })

  test(`${field}: quitting inside the debounce keeps it after relaunch`, async () => {
    const userData = tempUserData()
    shell = await launchShell({ userData, seed: true })
    await openTask(shell.page, TASK)
    const marker = ` quit-${field}`
    if (field === 'title') await typeTitle(shell.page, marker)
    else await typeDescription(shell.page, marker)
    await shell.close({ keepUserData: true }) // app.quit(), i.e. Cmd+Q
    shell = await launchShell({ userData })
    const tasks = await dbTasks(shell.page)
    expect(tasks.some((t) => t[field].includes(marker.trim()))).toBe(true)
  })
}

test('a renderer that never answers cannot hang quit', async () => {
  shell = await launchShell()
  // Busy-loop the main window's renderer so it cannot answer the flush request.
  await shell.page.evaluate(() => {
    setTimeout(() => {
      const end = Date.now() + 8000
      while (Date.now() < end) {
        /* spin */
      }
    }, 0)
  })
  const started = Date.now()
  await shell.close()
  shell = undefined
  expect(Date.now() - started).toBeLessThan(6000)
})

/** Waits until the app process has exited (it quit on its own). */
async function waitForExit(s: ShellApp): Promise<void> {
  const proc = s.app.process()
  if (proc.exitCode !== null) return
  await new Promise<void>((done) => proc.once('exit', () => done()))
}

test('a second quit request while the flush is running cannot close the DB early', async () => {
  const userData = tempUserData()
  shell = await launchShell({ userData, seed: true })
  await openTask(shell.page, TASK)
  await typeDescription(shell.page, ' double-quit')
  const s = shell
  shell = undefined
  // Two quits back to back (e.g. Cmd+Q twice, or tray Quit then a logout signal).
  await s.app.evaluate(({ app }) => {
    app.quit()
    app.quit()
  })
  await waitForExit(s)
  shell = await launchShell({ userData })
  expect((await dbTasks(shell.page)).some((t) => t.description.includes('double-quit'))).toBe(true)
})

test('SIGTERM saves pending edits before exiting', async () => {
  // Windows has no catchable SIGTERM: Node's kill('SIGTERM') there is TerminateProcess. The
  // Windows equivalents (logoff / shutdown) go through query-session-end / session-end.
  test.skip(process.platform === 'win32', 'POSIX signals only; Windows kill() cannot be caught')
  const userData = tempUserData()
  shell = await launchShell({ userData, seed: true })
  await openTask(shell.page, TASK)
  await typeTitle(shell.page, ' sigterm')
  const s = shell
  shell = undefined
  s.app.process().kill('SIGTERM')
  await waitForExit(s)
  shell = await launchShell({ userData })
  expect((await dbTasks(shell.page)).some((t) => t.title.includes('sigterm'))).toBe(true)
})

test('a failed save keeps the panel open (close, Esc, switch, delete) and saves once it works', async () => {
  shell = await launchShell({ seed: true })
  const { page, app } = shell
  await openTask(page, TASK)
  await hook(app, 'failTaskUpdates', true)
  await typeDescription(page, ' not-saved-yet')
  await expect(panel(page).getByTestId('description-save-error')).toContainText('Not saved')

  // Esc (twice: leave the editor, then the panel), the close button, another task, Delete.
  await page.keyboard.press('Escape')
  await page.keyboard.press('Escape')
  await expect(page.getByText("Couldn't save your changes").first()).toBeVisible()
  await panel(page).getByRole('button', { name: 'Close' }).click()
  await page.locator('[data-task-id]', { hasText: 'Pick up dry cleaning' }).first().click()
  await panel(page).getByRole('button', { name: 'Delete task' }).click()
  await page.waitForTimeout(300)
  await expect(titleBox(page)).toHaveValue(TASK)
  await expect(editor(page)).toContainText('not-saved-yet')
  expect((await dbTasks(page)).find((t) => t.title === TASK)?.description).not.toContain(
    'not-saved-yet',
  )

  // Failure lifted: closing now saves first, then closes.
  await hook(app, 'failTaskUpdates', false)
  await panel(page).getByRole('button', { name: 'Close' }).click()
  await expect(panel(page)).toBeHidden()
  expect((await dbTasks(page)).find((t) => t.title === TASK)?.description).toContain(
    'not-saved-yet',
  )
})

test('text that could not be saved before quitting is offered back (Keep saves it)', async () => {
  const userData = tempUserData()
  shell = await launchShell({ userData, seed: true })
  await openTask(shell.page, TASK)
  await hook(shell.app, 'failTaskUpdates', true)
  await typeDescription(shell.page, ' kept-across-quit')
  await expect(panel(shell.page).getByTestId('description-save-error')).toBeVisible()
  await shell.close({ keepUserData: true })

  shell = await launchShell({ userData })
  const { page } = shell
  expect((await dbTasks(page)).find((t) => t.title === TASK)?.description).not.toContain(
    'kept-across-quit',
  )
  await openTask(page, TASK)
  const notice = panel(page).getByTestId('description-recovered')
  await expect(notice).toContainText('Recovered unsaved text')
  await expect(editor(page)).toContainText('kept-across-quit')
  await notice.getByRole('button', { name: 'Keep' }).click()
  await expect
    .poll(async () => (await dbTasks(page)).find((t) => t.title === TASK)?.description)
    .toContain('kept-across-quit')
  await expect(notice).toBeHidden()
  // Saved: not offered again.
  await page.reload()
  await page.waitForSelector('[data-slot="view"]')
  await openTask(page, TASK)
  await expect(panel(page).getByTestId('description-recovered')).toHaveCount(0)
})
