// Captures screenshots of the shell with seeded demo data into e2e/screenshots/ (gitignored).
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test } from '@playwright/test'
import type { Api } from '../src/shared/ipc'
import { launchApp, type LaunchedApp } from './launch'

const OUT = join(__dirname, 'screenshots')
let launched: LaunchedApp

test.afterEach(async () => {
  await launched?.close()
})

test('shell renders seeded data (light + dark)', async () => {
  mkdirSync(OUT, { recursive: true })
  launched = await launchApp({ seed: true })
  const { page, app } = launched
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.setSize(1400, 860))

  await expect(page.locator('[data-testid="board-today"] [data-task-id]').first()).toBeVisible()
  await page.screenshot({ path: join(OUT, 'today-light.png') })

  await page.locator('[data-view="week"]').click()
  await page.screenshot({ path: join(OUT, 'week-light.png') })

  await page.locator('[data-task-id]', { hasText: 'Q4 planning follow-ups' }).first().click()
  await expect(page.getByTestId('task-detail')).toBeVisible()
  await page.screenshot({ path: join(OUT, 'detail-light.png') })
  await page.keyboard.press('Escape')

  await page.evaluate(() =>
    (globalThis as unknown as { api: Api }).api.settings.set({ theme: 'dark' }),
  )
  await page.locator('[data-view="today"]').click()
  await page.waitForTimeout(200)
  await page.screenshot({ path: join(OUT, 'today-dark.png') })
  await page.locator('[data-task-id]').first().click({ button: 'right' })
  await page.waitForTimeout(200)
  await page.screenshot({ path: join(OUT, 'context-menu-dark.png') })
  await page.keyboard.press('Escape')
})
