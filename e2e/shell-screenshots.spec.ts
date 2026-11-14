// Captures the quick-add popup, the new-task dialog and every Settings section in light and
// dark into e2e/screenshots/shell/ (gitignored) for visual review.
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test, type Page } from '@playwright/test'
import type { Api } from '../src/shared/ipc'
import { launchShell, MOD, openQuickAdd, type ShellApp } from './shellHelpers'

const OUT = join(__dirname, 'screenshots', 'shell')
let shell: ShellApp

test.afterEach(async () => {
  await shell?.close()
})

const setTheme = (page: Page, theme: 'light' | 'dark') =>
  page.evaluate(
    (t) => (globalThis as unknown as { api: Api }).api.settings.set({ theme: t }),
    theme,
  )

test('quick add, new-task dialog and settings (light + dark)', async () => {
  test.setTimeout(120_000)
  mkdirSync(OUT, { recursive: true })
  shell = await launchShell({
    seed: true,
    // One refused combo so the Shortcuts section shows its failure state.
    env: { MARTIN_TODOS_FAKE_TAKEN_SHORTCUTS: 'Alt+Shift+T' },
  })
  const { app, page } = shell
  await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()
      .find((w) => w.webContents.getURL().endsWith('index.html'))
      ?.setSize(1400, 860),
  )

  for (const theme of ['light', 'dark'] as const) {
    await setTheme(page, theme)

    // --- quick-add popup
    const qa = await openQuickAdd(app)
    await qa.waitForTimeout(250)
    await qa.screenshot({ path: join(OUT, `quick-add-empty-${theme}.png`) })
    const title = qa.getByRole('textbox', { name: 'Task title' })
    await title.fill('Send Q4 budget draft to Anna #work #finance !high @fri')
    await qa.getByRole('textbox', { name: 'Description' }).fill('Include the hiring plan numbers.')
    await qa.waitForTimeout(250)
    await qa.screenshot({ path: join(OUT, `quick-add-tokens-${theme}.png`) })
    await qa.getByRole('button', { name: /^(Today|Due date)$/ }).click()
    await qa.waitForTimeout(400)
    await qa.screenshot({ path: join(OUT, `quick-add-datepicker-${theme}.png`) })
    await qa.keyboard.press('Escape') // closes the popover only
    await qa.keyboard.press('Escape') // hides + clears

    // --- in-app dialog
    await page.bringToFront()
    await page.keyboard.press(`${MOD}+n`)
    const dialog = page.getByTestId('new-task-dialog')
    await expect(dialog).toBeVisible()
    await dialog
      .getByRole('textbox', { name: 'Task title' })
      .fill('Book flights for the offsite #travel !crit @nov20')
    await page.waitForTimeout(250)
    await page.screenshot({ path: join(OUT, `new-task-dialog-${theme}.png`) })
    await page.keyboard.press('Escape')

    // --- settings
    await page
      .locator('nav[aria-label="Views"]')
      .getByRole('button', { name: /Settings/ })
      .click()
    const settings = page.getByTestId('settings-dialog')
    await expect(settings).toBeVisible()
    for (const section of ['general', 'shortcuts', 'tags', 'data'] as const) {
      await settings.locator(`[data-section="${section}"]`).click()
      await page.waitForTimeout(200)
      await page.screenshot({ path: join(OUT, `settings-${section}-${theme}.png`) })
    }
    await page.keyboard.press('Escape')
  }
})
