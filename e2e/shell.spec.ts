// Desktop shell, quick add and settings (spec §8, §9). Global shortcuts are never really
// registered in test runs: a fake registrar stands in and `triggerShortcut` fires them.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test, type Page } from '@playwright/test'
import type { Api } from '../src/shared/ipc'
import type { ExportFile } from '../src/shared/types'
import { windowByEntry } from './launch'
import { hook, launchShell, MOD, openQuickAdd, windowVisible, type ShellApp } from './shellHelpers'

let shell: ShellApp | undefined

test.afterEach(async () => {
  await shell?.close()
  shell = undefined
})

type W = { api: Api }
const api = <T>(page: Page, fn: (api: Api) => Promise<T>): Promise<T> =>
  page.evaluate(`(${fn.toString()})(globalThis.api)`) as Promise<T>
const listTasks = (page: Page) => page.evaluate(() => (globalThis as unknown as W).api.tasks.list())
const listTags = (page: Page) => page.evaluate(() => (globalThis as unknown as W).api.tags.list())

async function openSettings(page: Page, section: string): Promise<void> {
  await page.keyboard.press(`${MOD}+,`)
  await expect(page.getByTestId('settings-dialog')).toBeVisible()
  await page.getByTestId('settings-dialog').locator(`[data-section="${section}"]`).click()
}

test('closing the main window hides it; the app keeps running and can be re-shown', async () => {
  shell = await launchShell({ env: { MARTIN_TODOS_FAKE_TAKEN_SHORTCUTS: 'Alt+Shift+T' } })
  const { app, page } = shell

  // Registration failures are reported, never silent.
  const status = await page.evaluate(() => (globalThis as unknown as W).api.app.getShortcutStatus())
  expect(status.quickAdd).toEqual({ accelerator: 'Alt+Shift+N', registered: true })
  expect(status.toggleApp.registered).toBe(false)
  expect(status.toggleApp.error).toMatch(/in use/)

  await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()
      .find((w) => w.webContents.getURL().endsWith('index.html'))
      ?.close(),
  )
  await expect.poll(() => windowVisible(app, 'index')).toBe(false)
  expect(await hook(app, 'isQuitting')).toBe(false)
  // Same window (and renderer state) survives.
  expect(app.windows()).toContain(page)

  // Fix the taken shortcut, then use it to bring the window back.
  await page.evaluate(() =>
    (globalThis as unknown as W).api.settings.set({ shortcuts: { toggleApp: 'Alt+Shift+M' } }),
  )
  expect(await hook(app, 'triggerShortcut', 'toggleApp')).toBe(true)
  await expect.poll(() => windowVisible(app, 'index')).toBe(true)
})

test('quick add: tokens are parsed, the task lands in the main window, the popup hides', async () => {
  shell = await launchShell()
  const { app, page } = shell
  expect(await windowVisible(app, 'quick-add')).toBe(false)

  const qa = await openQuickAdd(app)
  expect(await windowVisible(app, 'quick-add')).toBe(true)
  const title = qa.getByRole('textbox', { name: 'Task title' })
  await expect(title).toBeFocused()
  await title.fill('Email the plumber #home !high @today')
  // Each parsed value shows once: priority and due date in their controls, tags as chips.
  await expect(qa.getByRole('button', { name: 'Priority: High' })).toBeVisible()
  await expect(qa.getByRole('button', { name: 'Due date: Today' })).toBeVisible()
  await expect(qa.getByTestId('quick-add-tags')).toHaveText('home')
  await expect(qa.getByText('High', { exact: true })).toHaveCount(1)
  await title.press('Enter')

  await expect.poll(() => windowVisible(app, 'quick-add')).toBe(false)
  const card = page.locator('[data-testid="board-today"] [data-task-id]', {
    hasText: 'Email the plumber',
  })
  await expect(card).toBeVisible()
  await expect(card).toContainText('home')
  await expect(card).not.toContainText('!high')

  const [task] = await listTasks(page)
  const [tag] = await listTags(page)
  expect(task).toMatchObject({
    title: 'Email the plumber',
    priority: 3,
    status: 'not_started',
    tagIds: [tag?.id],
  })
  expect(task?.dueDate).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  expect(tag?.name).toBe('home')

  // Reopened empty after a save.
  const again = await openQuickAdd(app)
  await expect(again.getByRole('textbox', { name: 'Task title' })).toHaveValue('')
})

test('quick add: controls override tokens, tag chips remove theirs; blur keeps the draft, Esc clears', async () => {
  shell = await launchShell()
  const { app } = shell
  const qa = await openQuickAdd(app)
  const title = qa.getByRole('textbox', { name: 'Task title' })
  await title.fill('Ping @john about #ops')

  // Focus moves elsewhere → popup hides but keeps the draft. macOS only delivers real focus
  // changes while the app is frontmost, which a test run cannot guarantee, so the window's
  // blur is emitted directly.
  await app.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()
      .find((w) => w.webContents.getURL().endsWith('quick-add.html'))
      ?.emit('blur')
  })
  await expect.poll(() => windowVisible(app, 'quick-add')).toBe(false)
  await openQuickAdd(app)
  await expect(title).toHaveValue('Ping @john about #ops')

  await qa.keyboard.press('Escape')
  await expect.poll(() => windowVisible(app, 'quick-add')).toBe(false)
  await openQuickAdd(app)
  await expect(title).toHaveValue('')

  await title.fill('Ping @john about #ops !low @tomorrow')
  await expect(qa.getByRole('button', { name: 'Priority: Low' })).toBeVisible()
  // Changing the control is the override: the token leaves the title.
  await qa.getByRole('button', { name: 'Priority: Low' }).click()
  await qa.getByRole('menuitem', { name: /High$/ }).click()
  await expect(title).toHaveValue('Ping @john about #ops @tomorrow')
  await expect(qa.getByRole('button', { name: 'Priority: High' })).toBeVisible()
  // Clearing the due date there removes the @date token.
  await qa.getByRole('button', { name: 'Due date: Tomorrow' }).click()
  await qa.getByRole('button', { name: 'Clear' }).click()
  await expect(title).toHaveValue('Ping @john about #ops')
  await expect(qa.getByRole('button', { name: 'Due date: none' })).toBeVisible()
  // A tag chip's × removes its token.
  await qa.getByTestId('quick-add-tags').getByRole('button').click()
  await expect(title).toHaveValue('Ping @john about')
})

test('in-app new-task dialog (Cmd/Ctrl+N) creates a task, and "create more" keeps it open', async () => {
  shell = await launchShell()
  const { page } = shell
  await page.keyboard.press(`${MOD}+n`)
  const dialog = page.getByTestId('new-task-dialog')
  await expect(dialog).toBeVisible()
  const title = dialog.getByRole('textbox', { name: 'Task title' })
  await title.fill('First from dialog !crit')
  await dialog.getByRole('textbox', { name: 'Description' }).fill('- [ ] step one')
  await page.keyboard.press(`${MOD}+Shift+Enter`)
  await expect(title).toHaveValue('')
  await expect(dialog).toBeVisible()
  await title.fill('Second from dialog')
  await title.press('Enter')
  await expect(dialog).toBeHidden()

  const tasks = await listTasks(page)
  expect(tasks.map((t) => t.title).sort()).toEqual(['First from dialog', 'Second from dialog'])
  expect(tasks.find((t) => t.title === 'First from dialog')).toMatchObject({
    priority: 4,
    description: '- [ ] step one',
  })
})

test('settings persist across a restart', async () => {
  shell = await launchShell()
  await openSettings(shell.page, 'general')
  await shell.page.getByTestId('theme-dark').click()
  await shell.page.getByTestId('week-sunday').click()
  await expect(shell.page.locator('html')).toHaveClass(/dark/)
  const userData = shell.userData
  await shell.close({ keepUserData: true })

  shell = await launchShell({ userData })
  const { page } = shell
  await expect(page.locator('html')).toHaveClass(/dark/)
  const settings = await page.evaluate(() => (globalThis as unknown as W).api.settings.get())
  expect(settings).toMatchObject({ theme: 'dark', weekStartsOn: 0 })
  await openSettings(page, 'general')
  await expect(page.getByTestId('week-sunday')).toHaveAttribute('data-state', 'on')
  await expect(page.getByTestId('theme-dark')).toHaveAttribute('data-state', 'on')
})

test('tag rename and delete in Settings propagate to tasks and the sidebar', async () => {
  shell = await launchShell()
  const { page } = shell
  await page.evaluate(() =>
    (globalThis as unknown as W).api.tasks.create({
      title: 'Tagged task',
      newTagNames: ['errand'],
    }),
  )
  const sidebarTags = page.locator('section[aria-label="Tags"]')
  await expect(sidebarTags).toContainText('errand')

  await openSettings(page, 'tags')
  const list = page.getByTestId('tags-list')
  await list.getByRole('button', { name: 'Rename errand' }).click()
  const input = list.getByRole('textbox', { name: 'New name for errand' })
  await input.fill('shopping')
  await input.press('Enter')
  await expect(list).toContainText('shopping')
  await expect(list).toContainText('1 task')
  await expect(sidebarTags).toContainText('shopping')
  await expect(sidebarTags).not.toContainText('errand')

  await list.getByRole('button', { name: 'Delete shopping' }).click()
  const confirm = page.getByRole('dialog', { name: /Delete tag/ })
  await expect(confirm).toContainText('1 task uses this tag')
  await confirm.getByRole('button', { name: 'Delete tag' }).click()
  await expect(sidebarTags).not.toContainText('shopping')
  const [task] = await listTasks(page)
  expect(task?.tagIds).toEqual([])
})

test('export → wipe → import round-trips the data (merge and replace)', async () => {
  shell = await launchShell({ seed: true })
  const { app, page } = shell
  const file = join(shell.userData, 'export.json')
  await app.evaluate(({ dialog }, path) => {
    dialog.showSaveDialog = (async () => ({
      canceled: false,
      filePath: path,
    })) as typeof dialog.showSaveDialog
    dialog.showOpenDialog = (async () => ({
      canceled: false,
      filePaths: [path],
    })) as typeof dialog.showOpenDialog
  }, file)

  const before = await listTasks(page)
  const tagsBefore = await listTags(page)
  expect(before.length).toBeGreaterThan(10)

  await openSettings(page, 'data')
  const settings = page.getByTestId('settings-dialog')
  await settings.getByRole('button', { name: 'Export…' }).click()
  await expect(settings.getByRole('status')).toContainText(`Exported ${before.length} tasks`)
  const exported = JSON.parse(readFileSync(file, 'utf8')) as ExportFile
  expect(exported).toMatchObject({ app: 'martin-todos', formatVersion: 1 })
  expect(exported.tasks).toHaveLength(before.length)

  // Wipe everything through the normal API.
  await api(page, async (a) => {
    for (const t of await a.tasks.list()) await a.tasks.delete(t.id)
    for (const t of await a.tags.list()) await a.tags.delete(t.id)
  })
  await expect.poll(async () => (await listTasks(page)).length).toBe(0)

  const byId = (xs: typeof before) => [...xs].sort((x, y) => x.id.localeCompare(y.id))

  await settings.getByRole('button', { name: 'Replace all…' }).click()
  const confirm = page.getByRole('dialog', { name: 'Replace all data?' })
  await expect(confirm).toContainText('A backup of the current data is taken first')
  await confirm.getByRole('button', { name: /Choose file and replace/ }).click()
  await expect(settings.getByRole('status')).toContainText('Replaced everything')
  await expect(settings.getByRole('status')).toContainText('backups')

  const after = await listTasks(page)
  expect(byId(after)).toEqual(byId(before))
  expect((await listTags(page)).map((t) => t.name).sort()).toEqual(
    tagsBefore.map((t) => t.name).sort(),
  )
  // Merging the same file again changes nothing: every local copy is as new as the file's.
  await settings.getByRole('button', { name: 'Merge…' }).click()
  await expect(settings.getByRole('status')).toContainText(
    `Merged: 0 added, 0 updated, ${before.length} unchanged`,
  )

  // The main window shows the restored data without a reload.
  await page.keyboard.press('Escape')
  await expect(page.locator('[data-task-id]').first()).toBeVisible()
  // The quick-add window got the broadcast too (its store is used for tag matching).
  const qa = await windowByEntry(app, 'quick-add')
  const qaTags = await qa.evaluate(() => (globalThis as unknown as W).api.tags.list())
  expect(qaTags).toHaveLength(tagsBefore.length)
})
