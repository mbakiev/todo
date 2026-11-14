// Data-loss checks (spec §7 "never lose keystrokes"): text typed in the detail panel survives
// hiding the window and quitting the app inside the autosave debounce window.
import { expect, test, type Page } from '@playwright/test'
import type { Api } from '../src/shared/ipc'
import type { Task } from '../src/shared/types'
import { launchShell, tempUserData, type ShellApp } from './shellHelpers'

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
  await editor(page).click()
  await page.keyboard.press('ControlOrMeta+End')
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
    // Saved by the hide itself, well before the 500 ms debounce would have fired.
    await expect
      .poll(async () => (await dbTasks(page)).some((t) => t[field].includes(marker.trim())), {
        timeout: 400,
        intervals: [25],
      })
      .toBe(true)
    expect(Date.now() - typedAt).toBeLessThan(1500)
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
