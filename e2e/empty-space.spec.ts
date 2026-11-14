// Clicking empty space in the active view closes the detail panel (spec §7), on every view;
// gestures (drags, selections) and clicks outside the view never do. Before/after screenshots
// go to e2e/screenshots/ (gitignored).
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test, type Locator, type Page } from '@playwright/test'
import { addDays, diffDays, todayLocal } from '../src/shared/dates'
import type { Api, CreateTaskInput } from '../src/shared/ipc'
import type { Task, ViewId } from '../src/shared/types'
import { caretToEnd, launchApp, resizeMainWindow, type LaunchedApp } from './launch'
import { hook } from './shellHelpers'

const OUT = join(__dirname, 'screenshots')
let launched: LaunchedApp

test.afterEach(async () => {
  await launched?.close()
})

const ALPHA = 'Alpha empty-space task'
const BRAVO = 'Bravo empty-space task'
const CHARLIE = 'Charlie empty-space task'

const panel = (page: Page): Locator => page.getByTestId('task-detail')
const titleBox = (page: Page): Locator => panel(page).getByRole('textbox', { name: 'Title' })
const editor = (page: Page): Locator => panel(page).getByRole('textbox', { name: 'Description' })
const view = (page: Page): Locator => page.locator('[data-slot="view"]')
const task = (page: Page, title: string): Locator =>
  view(page).locator('[data-task-id]', { hasText: title }).first()

const dbTasks = (page: Page): Promise<Task[]> =>
  page.evaluate(() => (globalThis as unknown as { api: Api }).api.tasks.list())

async function dbTask(page: Page, id: string): Promise<Task | undefined> {
  return (await dbTasks(page)).find((t) => t.id === id)
}

/** Three open tasks dated around today, so they show on every view. */
async function setup(viewId: ViewId): Promise<Page> {
  launched = await launchApp()
  const { page, app } = launched
  await resizeMainWindow(app, 1400, 860)
  const today = todayLocal()
  const inputs: CreateTaskInput[] = [
    { title: ALPHA, dueDate: today },
    { title: BRAVO, startDate: today, dueDate: addDays(today, 2) },
    { title: CHARLIE, dueDate: today },
  ]
  await page.evaluate(async (list) => {
    const api = (globalThis as unknown as { api: Api }).api
    for (const input of list) await api.tasks.create(input)
  }, inputs)
  await page.locator(`[data-view="${viewId}"]`).click()
  await expect(task(page, CHARLIE)).toBeVisible()
  return page
}

/** Clicks a task near its left edge (a list row's middle is an inline control). */
async function clickTask(page: Page, title: string): Promise<void> {
  await task(page, title).click({ position: { x: 70, y: 8 } })
}

async function open(page: Page, title: string): Promise<void> {
  await clickTask(page, title)
  await expect(titleBox(page)).toHaveValue(title)
}

/** Closed, and no task in the view shows as selected. */
async function expectClosed(page: Page): Promise<void> {
  await expect(panel(page)).toBeHidden()
  await expect(
    view(page).locator('[data-task-id][data-selected], [data-task-id][aria-selected="true"]'),
  ).toHaveCount(0)
}

/** A point inside `el`, `dx`/`dy` from its top-left (negative: from the bottom-right). */
async function pointIn(el: Locator, dx: number, dy: number): Promise<{ x: number; y: number }> {
  const box = await el.boundingBox()
  if (!box) throw new Error('not visible')
  return {
    x: dx >= 0 ? box.x + dx : box.x + box.width + dx,
    y: dy >= 0 ? box.y + dy : box.y + box.height + dy,
  }
}

async function clickAt(page: Page, p: { x: number; y: number }): Promise<void> {
  await page.mouse.click(p.x, p.y)
}

/** Press, move in steps, release — a gesture, not a click. */
async function dragBetween(
  page: Page,
  from: { x: number; y: number },
  to: { x: number; y: number },
): Promise<void> {
  await page.mouse.move(from.x, from.y)
  await page.mouse.down()
  await page.mouse.move(from.x + 8, from.y + 6, { steps: 4 })
  await page.mouse.move(to.x, to.y, { steps: 16 })
  await page.waitForTimeout(120)
  await page.mouse.move(to.x, to.y + 1, { steps: 2 })
  await page.mouse.up()
  await page.waitForTimeout(250)
}

// --- empty-space points per view ---------------------------------------------------------

const boardColumn = (page: Page, status: string): Locator =>
  page.locator(`[data-testid="board-today"] [data-testid="column-${status}"]`)
/** Inside the (empty) Blocked column's body, clear of the toasts at the bottom. */
const boardEmpty = (page: Page) => pointIn(boardColumn(page, 'blocked'), 40, 200)
/** Below the last list row, inside the table. */
const listEmpty = (page: Page) => pointIn(page.getByRole('table', { name: 'Tasks' }), 300, -40)
/** Grid area below the timeline rows. */
const timelineEmpty = (page: Page) => pointIn(page.getByTestId('timeline-view'), 420, -60)

/** The grid day farthest from today (no task on it), and a point low in its cell. */
async function calendarEmptyDay(page: Page): Promise<{ date: string; x: number; y: number }> {
  const today = todayLocal()
  const dates = await page
    .getByTestId('calendar-grid')
    .locator('[data-date]')
    .evaluateAll((els) => els.map((e) => e.getAttribute('data-date') ?? ''))
  const date = dates.reduce((best, d) =>
    Math.abs(diffDays(today, d)) > Math.abs(diffDays(today, best)) ? d : best,
  )
  const p = await pointIn(page.locator(`[data-date="${date}"]`), 20, -8)
  return { date, ...p }
}

// --- tests -------------------------------------------------------------------------------

test('board: empty-space click closes; another card switches; screenshots', async () => {
  const page = await setup('today')
  mkdirSync(OUT, { recursive: true })
  await open(page, ALPHA)
  await page.screenshot({ path: join(OUT, 'empty-space-board-1-panel-open.png') })

  // Another task switches instead of closing.
  await clickTask(page, BRAVO)
  await expect(titleBox(page)).toHaveValue(BRAVO)

  await clickAt(page, await boardEmpty(page))
  await expectClosed(page)
  await page.screenshot({ path: join(OUT, 'empty-space-board-2-after-click.png') })

  // Board gutter / column header are empty space too.
  await open(page, ALPHA)
  await clickAt(page, await pointIn(boardColumn(page, 'in_progress').locator('..'), 30, 18))
  await expectClosed(page)
})

test('board: a card dropped on empty space, a selection drag, modifier / right clicks keep the panel', async () => {
  const page = await setup('today')
  await open(page, ALPHA)
  const charlieId = await task(page, CHARLIE).getAttribute('data-task-id')
  if (!charlieId) throw new Error('no id')

  // dnd-kit drag of another card, released on the empty In Progress column.
  const from = await pointIn(task(page, CHARLIE), 30, 12)
  await dragBetween(page, from, await pointIn(boardColumn(page, 'in_progress'), 60, -40))
  await expect.poll(async () => (await dbTask(page, charlieId))?.status).toBe('in_progress')
  await expect(titleBox(page)).toHaveValue(ALPHA)

  // Press and release on empty space, but a drag (text selection) in between.
  const a = await boardEmpty(page)
  await dragBetween(page, a, { x: a.x + 120, y: a.y - 200 })
  await expect(titleBox(page)).toHaveValue(ALPHA)
  // …even when the pointer comes back to where it was pressed before the release.
  await page.mouse.move(a.x, a.y)
  await page.mouse.down()
  await page.mouse.move(a.x + 80, a.y + 60, { steps: 8 })
  await page.mouse.move(a.x, a.y, { steps: 8 })
  await page.mouse.up()
  await page.waitForTimeout(150)
  await expect(titleBox(page)).toHaveValue(ALPHA)

  // Modifier clicks and a right click on empty space.
  const p = await boardEmpty(page)
  for (const key of ['Shift', 'Meta', 'Alt', 'Control']) {
    await page.keyboard.down(key)
    await page.mouse.click(p.x, p.y)
    await page.keyboard.up(key)
    await expect(page.getByRole('menu')).toHaveCount(0) // empty space has no context menu
    await expect(titleBox(page)).toHaveValue(ALPHA)
  }
  await page.mouse.click(p.x, p.y, { button: 'right' })
  await expect(titleBox(page)).toHaveValue(ALPHA)
})

test('board: unsaved title and description are saved when an empty-space click closes', async () => {
  const page = await setup('today')
  await open(page, ALPHA)
  const id = await task(page, ALPHA).getAttribute('data-task-id')
  if (!id) throw new Error('no id')

  await titleBox(page).click()
  await page.keyboard.press('End')
  await page.keyboard.type(' renamed')
  await clickAt(page, await boardEmpty(page)) // well inside the 500 ms debounce
  await expectClosed(page)
  await expect.poll(async () => (await dbTask(page, id))?.title).toBe(`${ALPHA} renamed`)

  await open(page, `${ALPHA} renamed`)
  await caretToEnd(editor(page))
  await page.keyboard.type('typed then clicked away')
  await clickAt(page, await boardEmpty(page))
  await expectClosed(page)
  await expect
    .poll(async () => (await dbTask(page, id))?.description)
    .toContain('typed then clicked away')
})

test('board: a failed save keeps the panel open on an empty-space click', async () => {
  const page = await setup('today')
  await open(page, ALPHA)
  await hook(launched.app, 'failTaskUpdates', true)
  await caretToEnd(editor(page))
  await page.keyboard.type(' not-saved-yet')
  await expect(panel(page).getByTestId('description-save-error')).toContainText('Not saved')

  await clickAt(page, await boardEmpty(page))
  await expect(page.getByText("Couldn't save your changes").first()).toBeVisible()
  await expect(titleBox(page)).toHaveValue(ALPHA)
  await expect(editor(page)).toContainText('not-saved-yet')

  await hook(launched.app, 'failTaskUpdates', false)
  await clickAt(page, await boardEmpty(page))
  await expectClosed(page)
  const saved = (await dbTasks(page)).find((t) => t.title === ALPHA)
  expect(saved?.description).toContain('not-saved-yet')
})

test('sidebar and toolbar clicks never close the panel; nothing happens with it closed', async () => {
  const page = await setup('today')
  await open(page, ALPHA)
  // Empty sidebar area (below the view list) and empty toolbar area.
  await clickAt(page, await pointIn(page.getByRole('navigation', { name: 'Views' }), 100, -120))
  await expect(titleBox(page)).toHaveValue(ALPHA)
  await clickAt(page, await pointIn(page.locator('main > header'), 260, 24))
  await expect(titleBox(page)).toHaveValue(ALPHA)
  // The panel's own empty area.
  await clickAt(page, await pointIn(panel(page), 200, -20))
  await expect(titleBox(page)).toHaveValue(ALPHA)

  // Panel closed: an empty-space click changes nothing.
  await page.keyboard.press('Escape')
  await page.keyboard.press('Escape')
  await expectClosed(page)
  await clickAt(page, await boardEmpty(page))
  await expectClosed(page)
  await expect(page.getByRole('dialog')).toHaveCount(0)
})

test('list: empty-space click closes; another row switches; a drag does not close', async () => {
  const page = await setup('list')
  await open(page, ALPHA)
  await clickTask(page, BRAVO)
  await expect(titleBox(page)).toHaveValue(BRAVO)

  const p = await listEmpty(page)
  await dragBetween(page, p, { x: p.x + 200, y: p.y - 30 })
  await expect(titleBox(page)).toHaveValue(BRAVO)

  // A sort header is not empty space.
  await page.locator('[data-sort-col="title"]').click()
  await expect(titleBox(page)).toHaveValue(BRAVO)

  await clickAt(page, await listEmpty(page))
  await expectClosed(page)
})

test('timeline: empty-space click closes; another row switches; drags (also Esc-cancelled) do not', async () => {
  const page = await setup('timeline')
  await open(page, ALPHA)
  await clickTask(page, BRAVO)
  await expect(titleBox(page)).toHaveValue(BRAVO)

  const bravoId = await task(page, BRAVO).getAttribute('data-task-id')
  if (!bravoId) throw new Error('no id')
  const bar = page.locator(`[data-row-id="${bravoId}"] [data-testid="timeline-bar"]`)
  const before = await dbTask(page, bravoId)

  // A bar dragged and released over the empty area below the rows.
  await dragBetween(page, await pointIn(bar, 20, 8), await timelineEmpty(page))
  await expect(titleBox(page)).toHaveValue(BRAVO)
  await expect.poll(async () => (await dbTask(page, bravoId))?.dueDate).not.toBe(before?.dueDate)

  // Esc-cancelled drag, released over empty space.
  const from = await pointIn(bar, 20, 8)
  await page.mouse.move(from.x, from.y)
  await page.mouse.down()
  await page.mouse.move(from.x + 60, from.y + 4, { steps: 6 })
  const to = await timelineEmpty(page)
  await page.mouse.move(to.x, to.y, { steps: 10 })
  await page.keyboard.press('Escape')
  await page.mouse.up()
  await page.waitForTimeout(200)
  await expect(titleBox(page)).toHaveValue(BRAVO)

  // Timeline has no single-click action on empty space: it just closes.
  await clickAt(page, await timelineEmpty(page))
  await expectClosed(page)
})

test('calendar: first empty-day click only closes; with the panel closed it opens the new-task dialog', async () => {
  const page = await setup('calendar')
  await open(page, ALPHA)
  await clickTask(page, CHARLIE)
  await expect(titleBox(page)).toHaveValue(CHARLIE)

  // A chip dragged onto an empty day keeps the panel (and moves the task).
  const charlieId = await task(page, CHARLIE).getAttribute('data-task-id')
  if (!charlieId) throw new Error('no id')
  const empty = await calendarEmptyDay(page)
  await dragBetween(page, await pointIn(task(page, CHARLIE), 10, 6), empty)
  await expect.poll(async () => (await dbTask(page, charlieId))?.dueDate).toBe(empty.date)
  await expect(titleBox(page)).toHaveValue(CHARLIE)

  // Another empty day: only closes the panel, no dialog.
  const target = await pointIn(
    page.locator(`[data-date="${addDays(empty.date, empty.date < todayLocal() ? 1 : -1)}"]`),
    20,
    -8,
  )
  await clickAt(page, target)
  await expectClosed(page)
  await page.waitForTimeout(200)
  await expect(page.getByRole('dialog')).toHaveCount(0)

  // Panel closed: the same click opens the new-task dialog as before.
  await clickAt(page, target)
  await expect(page.getByRole('dialog')).toBeVisible()
})
