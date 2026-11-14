// Detail panel + Markdown editor: editing, persistence, paste, autosave on task switch, copy.
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test, type Page } from '@playwright/test'
import type { Api } from '../src/shared/ipc'
import type { Task } from '../src/shared/types'
import { launchApp, resizeMainWindow, type LaunchedApp } from './launch'

const OUT = join(__dirname, 'screenshots')
let launched: LaunchedApp

test.afterEach(async () => {
  await launched?.close()
})

const panel = (page: Page) => page.getByTestId('task-detail')
const editor = (page: Page) => panel(page).getByRole('textbox', { name: 'Description' })
const titleBox = (page: Page) => panel(page).getByRole('textbox', { name: 'Title' })

async function openTask(page: Page, title: string): Promise<void> {
  await page.locator('[data-task-id]', { hasText: title }).first().click()
  await expect(titleBox(page)).toHaveValue(title)
}

/** Reads a task straight from the main process (the source of truth). */
async function dbTask(page: Page, title: string): Promise<Task> {
  const tasks = await page.evaluate(() => (globalThis as unknown as { api: Api }).api.tasks.list())
  const task = tasks.find((t) => t.title === title)
  if (!task) throw new Error(`No task titled ${title}`)
  return task
}

async function pastePlainText(page: Page, text: string): Promise<void> {
  // Runs in the renderer; the e2e tsconfig has no DOM lib, so reach the classes via globalThis.
  await editor(page).evaluate((el, value) => {
    const g = globalThis as unknown as {
      DataTransfer: new () => { setData(type: string, v: string): void }
      ClipboardEvent: new (type: string, init: object) => Event
    }
    const data = new g.DataTransfer()
    data.setData('text/plain', value)
    el.dispatchEvent(
      new g.ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }),
    )
  }, text)
}

async function closePanel(page: Page): Promise<void> {
  await page.keyboard.press('Escape') // first Esc leaves the editor / title
  await page.keyboard.press('Escape')
  await expect(panel(page)).toBeHidden()
}

test('edits title and rich description, and they persist', async () => {
  launched = await launchApp({ seed: true })
  const { page } = launched
  await openTask(page, 'Reply to Anna about the offsite agenda')

  await titleBox(page).fill('Reply to Anna: offsite agenda')
  await titleBox(page).press('Enter')

  await editor(page).click()
  await page.keyboard.type('# Agenda')
  await page.keyboard.press('Enter')
  await page.keyboard.type('[] Book venue')
  await page.keyboard.press('Enter')
  await page.keyboard.type('Order lunch')
  await page.keyboard.press('Enter')
  await page.keyboard.press('Enter') // leave the list
  await panel(page).getByRole('button', { name: 'Insert table' }).click()
  await page.keyboard.type('Who')

  await closePanel(page)
  await openTask(page, 'Reply to Anna: offsite agenda')
  await expect(editor(page).locator('h1')).toHaveText('Agenda')
  await expect(editor(page).locator('ul[data-type="taskList"] > li')).toHaveCount(2)
  await expect(editor(page).locator('table th').first()).toHaveText('Who')

  const saved = await dbTask(page, 'Reply to Anna: offsite agenda')
  expect(saved.description).toContain('# Agenda')
  expect(saved.description).toContain('- [ ] Book venue\n- [ ] Order lunch')
  expect(saved.description).toMatch(/\| Who +\|/)

  // A pasted Markdown table (plain text) becomes a real table.
  await editor(page).click()
  await page.keyboard.press('ControlOrMeta+End')
  await pastePlainText(page, '| Item | Owner |\n| --- | --- |\n| Venue | **Anna** |')
  await expect(editor(page).locator('table')).toHaveCount(2)
  await expect(editor(page).locator('table').nth(1).locator('strong')).toHaveText('Anna')
  await closePanel(page)
  await expect
    .poll(async () => (await dbTask(page, 'Reply to Anna: offsite agenda')).description)
    .toContain('| Venue | **Anna** |')
})

test('property changes persist across a reload', async () => {
  launched = await launchApp({ seed: true })
  const { page } = launched
  const title = 'Look into standing desk options'
  await openTask(page, title)

  await panel(page)
    .getByRole('button', { name: /^Status:/ })
    .click()
  await page.getByRole('menuitem', { name: 'In Progress' }).click()
  await panel(page)
    .getByRole('button', { name: /^Priority:/ })
    .click()
  await page.getByRole('menuitem', { name: 'Critical' }).click()
  await panel(page).getByRole('button', { name: 'No start date' }).click()
  await page.getByRole('button', { name: 'Today', exact: true }).click()
  await panel(page).getByRole('button', { name: 'No due date' }).click()
  await page.getByRole('button', { name: 'Tomorrow', exact: true }).click()
  await panel(page).getByRole('button', { name: '+ Tag' }).click()
  await page.getByPlaceholder('Search or create tag…').fill('desk-e2e')
  await page.getByRole('option', { name: /Create/ }).click()
  await page.keyboard.press('Escape')

  await expect.poll(async () => (await dbTask(page, title)).priority).toBe(4)
  await page.reload()
  await openTask(page, title)
  await expect(panel(page).getByRole('button', { name: 'Status: In Progress' })).toBeVisible()
  await expect(panel(page).getByRole('button', { name: 'Priority: Critical' })).toBeVisible()
  await expect(panel(page).getByTestId('detail-tags')).toContainText('desk-e2e')
  await expect(panel(page).getByTestId('detail-tags')).toContainText('home')
  const t = await dbTask(page, title)
  expect(t.startDate).not.toBeNull()
  expect(t.dueDate).not.toBeNull()
  expect((t.startDate ?? '') < (t.dueDate ?? '')).toBe(true)
})

test('typing then switching tasks saves the first task and leaves the second untouched', async () => {
  launched = await launchApp({ seed: true })
  const { page } = launched
  const a = 'Order new running shoes'
  const b = 'Pick up dry cleaning'
  const before = await dbTask(page, b)

  await openTask(page, a)
  await editor(page).click()
  await page.keyboard.type('Size 44, trail model')
  // Switch immediately (well inside the 500 ms debounce).
  await page.locator('[data-task-id]', { hasText: b }).first().click()
  await expect(titleBox(page)).toHaveValue(b)
  await expect(editor(page)).not.toContainText('Size 44')

  await expect.poll(async () => (await dbTask(page, a)).description).toBe('Size 44, trail model')
  await page.waitForTimeout(800)
  const after = await dbTask(page, b)
  expect(after.description).toBe(before.description)
  expect(after.updatedAt).toBe(before.updatedAt)
})

test('copy as Markdown puts title, metadata and description on the clipboard', async () => {
  launched = await launchApp({ seed: true })
  const { page, app } = launched
  await openTask(page, 'Q4 planning follow-ups')
  await panel(page).getByRole('button', { name: 'Copy as Markdown' }).click()
  await expect(page.getByText('Copied as Markdown')).toBeVisible()
  const text = await app.evaluate(({ clipboard }) => clipboard.readText())
  expect(text).toMatch(/^# Q4 planning follow-ups\n\n\*\*Status:\*\* .+ · \*\*Priority:\*\* /)
  expect(text).toContain('- [x] Share notes in #planning')
  expect(text).toContain('[the planning doc](https://example.com/planning)')
  expect(text).toMatch(/\| Owner +\| Item +\| Due +\|/)
})

test('screenshots: detail panel (light + dark)', async () => {
  mkdirSync(OUT, { recursive: true })
  launched = await launchApp({ seed: true })
  const { page, app } = launched
  await resizeMainWindow(app, 1400, 900)
  await openTask(page, 'Q4 planning follow-ups')
  await page.waitForTimeout(300)
  await page.screenshot({ path: join(OUT, 'detail-panel-light.png') })

  await editor(page).locator('table td').first().click()
  await page.waitForTimeout(150)
  await page.screenshot({ path: join(OUT, 'detail-panel-table-light.png') })

  await page.evaluate(() =>
    (globalThis as unknown as { api: Api }).api.settings.set({ theme: 'dark' }),
  )
  await page.waitForTimeout(300)
  await page.screenshot({ path: join(OUT, 'detail-panel-table-dark.png') })
  await page.keyboard.press('Escape')
  await openTask(page, 'File a ticket for the flaky CI job')
  await page.waitForTimeout(300)
  await page.screenshot({ path: join(OUT, 'detail-panel-dark.png') })
})
