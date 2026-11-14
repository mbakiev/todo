import { expect, test } from '@playwright/test'
import { launchApp, type LaunchedApp } from './launch'

let launched: LaunchedApp

test.afterEach(async () => {
  await launched?.close()
})

test('creates a task through the UI and shows it on the Today board', async () => {
  launched = await launchApp()
  const { page } = launched

  await expect(page.getByRole('heading', { name: 'Today' })).toBeVisible()
  await page.getByRole('button', { name: 'New task' }).click()
  const input = page.getByRole('textbox', { name: 'Task title' })
  await input.fill('Write the smoke test #e2e !high')
  await input.press('Enter')

  const card = page.locator('[data-testid="board-today"] [data-task-id]', {
    hasText: 'Write the smoke test',
  })
  await expect(card).toBeVisible()
  await expect(card).toContainText('e2e')
  // Token text is stripped from the saved title.
  await expect(card).not.toContainText('!high')

  // Data really reached the main process: it survives a reload.
  await page.reload()
  await expect(page.locator('[data-task-id]', { hasText: 'Write the smoke test' })).toBeVisible()
})

test('quick-add entry loads and renders its form', async () => {
  launched = await launchApp()
  const { app } = launched
  const pagePromise = app.waitForEvent('window')
  await app.evaluate(({ BrowserWindow }) => {
    const root = process.cwd()
    const win = new BrowserWindow({
      show: false,
      webPreferences: {
        preload: `${root}/out/preload/index.js`,
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
      },
    })
    void win.loadFile(`${root}/out/renderer/quick-add.html`)
  })
  const quickAdd = await pagePromise
  await expect(quickAdd.getByRole('textbox', { name: 'Task title' })).toBeVisible()
})
