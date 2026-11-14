// List view e2e: sorting, grouping, inline edits, opening tasks, keyboard, virtualization.
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test, type Page } from '@playwright/test'
import type { Api } from '../src/shared/ipc'
import type { Task } from '../src/shared/types'
import { bulkCreateTasks, launchApp, resizeMainWindow, type LaunchedApp } from './launch'

const OUT = join(__dirname, 'screenshots')
let launched: LaunchedApp

test.afterEach(async () => {
  await launched?.close()
})

async function openList(options: { seed?: boolean } = { seed: true }): Promise<Page> {
  launched = await launchApp(options)
  const { page, app } = launched
  await resizeMainWindow(app, 1400, 860)
  await page.locator('[data-view="list"]').click()
  await expect(page.getByTestId('list-view')).toBeVisible()
  return page
}

const listTasks = (page: Page): Promise<Task[]> =>
  page.evaluate(() => (globalThis as unknown as { api: Api }).api.tasks.list())

const rows = (page: Page) => page.locator('[data-testid="list-view"] [role="row"][data-task-id]')

async function groupBy(page: Page, label: 'None' | 'Status' | 'Priority'): Promise<void> {
  await page.getByRole('button', { name: /^Group by:/ }).click()
  await page.getByRole('menuitemradio', { name: label }).click()
}

async function visibleTitles(page: Page, n: number): Promise<string[]> {
  const titles = await rows(page).locator('[data-col="title"]').allInnerTexts()
  return titles.slice(0, n)
}

test('sorts by a column header: asc → desc → default', async () => {
  const page = await openList()
  const header = page.locator('[data-sort-col="title"]')
  const defaultOrder = await visibleTitles(page, 5)

  await header.click()
  await expect(page.locator('[role="columnheader"][aria-sort="ascending"]')).toHaveCount(1)
  const asc = await visibleTitles(page, 8)
  expect(asc).toEqual(
    [...asc].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' })),
  )

  await header.click()
  await expect(page.locator('[role="columnheader"][aria-sort="descending"]')).toHaveCount(1)
  const desc = await visibleTitles(page, 8)
  expect(desc).toEqual(
    [...desc].sort((a, b) => b.localeCompare(a, undefined, { sensitivity: 'base' })),
  )

  await header.click()
  await expect(page.locator('[role="columnheader"][aria-sort="ascending"]')).toHaveCount(0)
  await expect.poll(() => visibleTitles(page, 5)).toEqual(defaultOrder)

  // Priority sorts numerically (desc puts Critical first).
  await page.locator('[data-sort-col="priority"]').click()
  await page.locator('[data-sort-col="priority"]').click()
  const tasks = await listTasks(page)
  const byTitle = new Map(tasks.map((t) => [t.title, t.priority]))
  const prios = (await visibleTitles(page, 10)).map((t) => byTitle.get(t) ?? 0)
  expect(prios).toEqual([...prios].sort((a, b) => b - a))
  expect(prios[0]).toBe(4)
})

test('groups by status with collapsible groups and status chips', async () => {
  const page = await openList()
  await groupBy(page, 'Status')
  const header = page.locator('[data-group="status:not_started"]')
  await expect(header).toBeVisible()
  await expect(page.locator('[data-group="status:in_progress"]')).toBeVisible()

  const tasks = await listTasks(page)
  const notStarted = tasks.filter((t) => t.status === 'not_started').length
  await expect(header).toContainText(String(notStarted))

  // Collapse "Not Started": its rows disappear, the header stays.
  const before = await rows(page).count()
  await header.getByRole('button').click()
  await expect(header.getByRole('button')).toHaveAttribute('aria-expanded', 'false')
  await expect.poll(() => rows(page).count()).toBeLessThan(before)
  // With the other groups collapsed, Done is in view.
  await page.locator('[data-group="status:in_progress"]').getByRole('button').click()
  await page.locator('[data-group="status:blocked"]').getByRole('button').click()
  await expect(page.locator('[data-group="status:done"]')).toBeVisible()

  // Status chip: hide Done.
  await page.locator('[data-status-chip="done"]').click()
  await expect(page.locator('[data-status-chip="done"]')).toHaveAttribute('aria-pressed', 'false')
  await expect(page.locator('[data-group="status:done"]')).toHaveCount(0)
  await expect(page.locator('[data-group="status:blocked"]')).toBeVisible()
})

test('changes status inline without opening the panel, and it persists', async () => {
  const page = await openList()
  const row = rows(page).filter({ hasText: 'Book dentist appointment' })
  await row.locator('[data-col="status"] button').click()
  await page.getByRole('menuitem', { name: 'In Progress' }).click()
  await expect(row.locator('[data-col="status"] button')).toHaveAttribute(
    'aria-label',
    'Status: In Progress',
  )
  await expect(page.getByTestId('task-detail')).toHaveCount(0)

  await row.locator('[data-col="priority"] button').click()
  await page.getByRole('menuitem', { name: 'Critical' }).click()
  await expect(page.getByTestId('task-detail')).toHaveCount(0)

  await page.reload()
  await page.locator('[data-view="list"]').click()
  const task = (await listTasks(page)).find((t) => t.title === 'Book dentist appointment')
  expect(task?.status).toBe('in_progress')
  expect(task?.priority).toBe(4)
  await expect(
    rows(page)
      .filter({ hasText: 'Book dentist appointment' })
      .locator('[data-col="status"] button'),
  ).toHaveAttribute('aria-label', 'Status: In Progress')
})

test('opens a task from a row; keyboard moves the selection', async () => {
  const page = await openList()
  const first = rows(page).nth(0)
  const firstTitle = await first.locator('[data-col="title"]').innerText()
  await first.locator('[data-col="title"]').click()
  await expect(page.getByTestId('task-detail')).toBeVisible()
  await expect(first).toHaveAttribute('aria-selected', 'true')

  // Down moves the selection (the open panel follows it).
  await page.keyboard.press('ArrowDown')
  await expect(rows(page).nth(1)).toHaveAttribute('aria-selected', 'true')
  await page.keyboard.press('ArrowUp')
  await expect(rows(page).nth(0)).toHaveAttribute('aria-selected', 'true')
  expect(firstTitle.length).toBeGreaterThan(0)

  // Close the panel, move the cursor, Enter opens the focused row.
  await page.keyboard.press('Escape')
  await expect(page.getByTestId('task-detail')).toHaveCount(0)
  await page.getByRole('table', { name: 'Tasks' }).focus()
  await page.keyboard.press('ArrowDown')
  await page.keyboard.press('Enter')
  await expect(page.getByTestId('task-detail')).toBeVisible()
  await expect(rows(page).nth(1)).toHaveAttribute('aria-selected', 'true')
})

test('shows empty states', async () => {
  const page = await openList({ seed: false })
  await expect(page.getByTestId('list-empty')).toContainText('No tasks yet')
  await page.evaluate(() =>
    (globalThis as unknown as { api: Api }).api.tasks.create({ title: 'Lonely task' }),
  )
  await expect(rows(page)).toHaveCount(1)
  await page.getByRole('searchbox', { name: 'Search tasks' }).fill('zzz-nothing')
  await expect(page.getByTestId('list-empty')).toContainText('No tasks match')
})

test('virtualizes 5,000 rows', async () => {
  // Inserted in one main-process transaction (creating them over IPC took ~30 s).
  const page = await openList({ seed: false })
  await bulkCreateTasks(
    launched,
    Array.from({ length: 5000 }, (_, i) => ({
      title: `Bulk task ${String(i).padStart(4, '0')}`,
      priority: (i % 4) + 1,
    })),
  )
  await page.locator('[data-view="list"]').click()
  await expect(page.getByRole('table', { name: 'Tasks' })).toHaveAttribute('aria-rowcount', '5000')
  const rendered = await rows(page).count()
  expect(rendered).toBeGreaterThan(10)
  expect(rendered).toBeLessThan(80)

  // Sort + scroll to the end: still only a window of rows in the DOM.
  const t0 = Date.now()
  await page.locator('[data-sort-col="title"]').click()
  await expect(rows(page).first().locator('[data-col="title"]')).toHaveText('Bulk task 0000')
  const sortMs = Date.now() - t0
  const table = page.getByRole('table', { name: 'Tasks' })
  await table.evaluate((el) => {
    el.scrollTop = el.scrollHeight
  })
  await expect(rows(page).filter({ hasText: 'Bulk task 4999' })).toBeVisible()
  expect(await rows(page).count()).toBeLessThan(80)
  expect(sortMs).toBeLessThan(3000)
})

test('screenshots (light + dark)', async () => {
  mkdirSync(OUT, { recursive: true })
  const page = await openList()
  await page.waitForTimeout(200)
  await page.screenshot({ path: join(OUT, 'list-light.png') })
  await groupBy(page, 'Status')
  await rows(page)
    .filter({ hasText: 'Q4 planning follow-ups' })
    .locator('[data-col="title"]')
    .click()
  await page.waitForTimeout(300)
  await page.screenshot({ path: join(OUT, 'list-grouped-light.png') })
  await page.keyboard.press('Escape')
  await page.evaluate(() =>
    (globalThis as unknown as { api: Api }).api.settings.set({ theme: 'dark' }),
  )
  await groupBy(page, 'None')
  await page.waitForTimeout(300)
  await page.screenshot({ path: join(OUT, 'list-dark.png') })
  await groupBy(page, 'Priority')
  await page.waitForTimeout(200)
  await page.screenshot({ path: join(OUT, 'list-grouped-dark.png') })
})
