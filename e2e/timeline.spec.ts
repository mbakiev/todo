// Timeline (Gantt) view: rendering, clamping, zoom, drag-to-move, resize, click, completed.
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test, type Locator, type Page } from '@playwright/test'
import type { Api } from '../src/shared/ipc'
import type { Task } from '../src/shared/types'
import { launchApp, resizeMainWindow, type LaunchedApp } from './launch'

const SHOTS = join(__dirname, 'screenshots')
let launched: LaunchedApp

test.afterEach(async () => {
  await launched?.close()
})

function localDate(offsetDays: number): string {
  const d = new Date()
  d.setHours(12, 0, 0, 0)
  d.setDate(d.getDate() + offsetDays)
  const p = (n: number): string => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

type WithApi = { api: Api }

async function taskByTitle(page: Page, title: string): Promise<Task> {
  const tasks = await page.evaluate(() => (globalThis as unknown as WithApi).api.tasks.list())
  const t = tasks.find((x) => x.title === title)
  if (!t) throw new Error(`no task ${title}`)
  return t
}

async function openTimeline(page: Page): Promise<void> {
  await page.locator('[data-view="timeline"]').click()
  await expect(page.getByTestId('timeline-view')).toBeVisible()
}

function bar(page: Page, id: string): Locator {
  return page.locator(`[data-testid="timeline-bar"][data-bar-id="${id}"]`)
}

async function setup(): Promise<{ page: Page; ancient: Task }> {
  launched = await launchApp({ seed: true })
  const { page, app } = launched
  await resizeMainWindow(app, 1400, 860)
  const ancient = await page.evaluate(
    (due) =>
      (globalThis as unknown as WithApi).api.tasks.create({
        title: 'Archive old invoices',
        priority: 3,
        dueDate: due,
      }),
    localDate(-40),
  )
  await openTimeline(page)
  return { page, ancient }
}

/** Drags from `from` by `dx` px in small steps (so the drag threshold and preview kick in). */
async function drag(page: Page, from: { x: number; y: number }, dx: number): Promise<void> {
  await page.mouse.move(from.x, from.y)
  await page.mouse.down()
  const steps = 8
  for (let i = 1; i <= steps; i++) await page.mouse.move(from.x + (dx * i) / steps, from.y)
}

test('renders seeded bars and clamps a long-overdue task to the left edge', async () => {
  const { page, ancient } = await setup()
  const bars = page.getByTestId('timeline-bar')
  expect(await bars.count()).toBeGreaterThan(15)

  const clamped = bar(page, ancient.id)
  await expect(clamped).toHaveAttribute('data-clamped', 'before')
  await expect(clamped).toHaveAttribute('data-overdue', 'true')
  await expect(clamped).toHaveAttribute('data-end', localDate(-40))
  // The real due date is shown next to the clamped stub.
  const row = page.locator(`[data-row-id="${ancient.id}"]`)
  await expect(row).toContainText('due')

  // A short-overdue task inside the range is red-outlined but not clamped.
  const expense = await taskByTitle(page, 'Submit expense report')
  await expect(bar(page, expense.id)).toHaveAttribute('data-overdue', 'true')
  await expect(bar(page, expense.id)).not.toHaveAttribute('data-clamped', /.+/)

  // Overdue reads the same in the left pane as in the calendar: red title + alert icon.
  const label = page.getByTestId('timeline-left-pane').locator(`[data-task-id="${expense.id}"]`)
  await expect(label.getByRole('img', { name: 'Overdue' })).toBeVisible()
  await expect(label.getByText('Submit expense report')).toHaveClass(/text-overdue/)
  const onTime = await taskByTitle(page, 'Plan team offsite logistics')
  await expect(
    page
      .getByTestId('timeline-left-pane')
      .locator(`[data-task-id="${onTime.id}"]`)
      .getByRole('img', { name: 'Overdue' }),
  ).toHaveCount(0)

  // Undated tasks are not on the timeline; dated ones are listed in the left pane.
  await expect(page.getByTestId('timeline-left-pane')).not.toContainText('Order new running shoes')
  await expect(page.getByTestId('timeline-left-pane')).toContainText('Plan team offsite logistics')
})

test('a pre-range stub follows the visible edge and drags into range', async () => {
  const { page, ancient } = await setup()
  const scroller = page
    .getByTestId('timeline-left-pane')
    .locator('xpath=ancestor::div[contains(@class,"overflow-auto")][1]')
  await scroller.evaluate((el) => (el.scrollLeft = 400)) // 10 days at Day zoom
  const pane = await page.getByTestId('timeline-left-pane').boundingBox()
  const b = bar(page, ancient.id)
  const box = await b.boundingBox()
  if (!box || !pane) throw new Error('not visible')
  expect(Math.abs(box.x - (pane.x + pane.width))).toBeLessThan(3)

  // The stub sits on (range start + 10 days) = today + 3; drop it 2 days later.
  await drag(page, { x: box.x + box.width / 2, y: box.y + box.height / 2 }, 2 * 40)
  await page.mouse.up()
  await expect(b).toHaveAttribute('data-end', localDate(5))
  await expect(b).not.toHaveAttribute('data-clamped', /.+/)
})

test('a long bar keeps its label in view when its start is scrolled off (every zoom)', async () => {
  const { page } = await setup()
  const long = await page.evaluate(
    ([start, due]) =>
      (globalThis as unknown as WithApi).api.tasks.create({
        title: 'Quarter-long migration',
        startDate: start,
        dueDate: due,
      }),
    [localDate(-3), localDate(200)] as const,
  )
  const scroller = page
    .getByTestId('timeline-left-pane')
    .locator('xpath=ancestor::div[contains(@class,"overflow-auto")][1]')
  const pane = await page.getByTestId('timeline-left-pane').boundingBox()
  if (!pane) throw new Error('no left pane')
  const visibleLeft = pane.x + pane.width
  const label = bar(page, long.id).getByTestId('timeline-bar-label')
  for (const zoom of ['day', 'week', 'month'] as const) {
    await page.locator(`[data-zoom="${zoom}"]`).click()
    await expect(page.getByTestId('timeline-view')).toHaveAttribute('data-current-zoom', zoom)
    const b = await bar(page, long.id).boundingBox()
    if (!b) throw new Error('bar not rendered')
    // Scroll so the bar starts well left of the visible grid but still covers it.
    const target = b.x - visibleLeft + (await scroller.evaluate((el) => el.scrollLeft)) + 150
    await scroller.evaluate((el, left) => (el.scrollLeft = left), target)
    await expect
      .poll(async () => (await bar(page, long.id).boundingBox())?.x ?? 0)
      .toBeLessThan(visibleLeft - 100)
    const l = await label.boundingBox()
    if (!l) throw new Error('label not rendered')
    expect(Math.abs(l.x - visibleLeft)).toBeLessThan(2)
    await expect(label).toHaveText('Quarter-long migration')
  }
  // The resize handle and drag body still answer where they were.
  const b = await bar(page, long.id).boundingBox()
  if (!b) throw new Error('bar not rendered')
  const endHandle = bar(page, long.id).locator('[data-handle="end"]')
  await expect(endHandle).toHaveCount(1)
  const atLabel = await page.evaluate(
    ([x, y]) => {
      const d = (
        globalThis as unknown as {
          document: {
            elementFromPoint(x: number, y: number): { closest(s: string): unknown } | null
          }
        }
      ).document
      return d.elementFromPoint(x, y)?.closest('[data-testid="timeline-bar"]') !== null
    },
    [visibleLeft + 20, b.y + b.height / 2] as const,
  )
  expect(atLabel).toBe(true)
})

test('a start-only task: the tooltip says "Starts <date>"', async () => {
  const { page } = await setup()
  const t = await page.evaluate(
    (start) =>
      (globalThis as unknown as WithApi).api.tasks.create({
        title: 'Kick off the audit',
        startDate: start,
      }),
    localDate(3),
  )
  await bar(page, t.id).hover()
  const tip = page.locator('[data-slot="tooltip-content"]')
  await expect(tip).toContainText('Kick off the audit')
  await expect(tip).toContainText(/Starts \w{3} \d+/)
  await expect(tip).not.toContainText('day')
})

test('switches zoom levels', async () => {
  const { page } = await setup()
  const view = page.getByTestId('timeline-view')
  const ticks = page.getByTestId('timeline-header-ticks')

  await expect(view).toHaveAttribute('data-current-zoom', 'day')
  const offsite = await taskByTitle(page, 'Plan team offsite logistics')
  const dayWidth = (await bar(page, offsite.id).boundingBox())?.width ?? 0

  await page.locator('[data-zoom="week"]').click()
  await expect(view).toHaveAttribute('data-current-zoom', 'week')
  await expect(ticks).toContainText('–')
  const weekWidth = (await bar(page, offsite.id).boundingBox())?.width ?? 0
  expect(weekWidth).toBeLessThan(dayWidth)

  await page.locator('[data-zoom="month"]').click()
  await expect(view).toHaveAttribute('data-current-zoom', 'month')
  const monthName = new Date().toLocaleString('en-US', { month: 'short' })
  await expect(ticks).toContainText(monthName)
  const monthWidth = (await bar(page, offsite.id).boundingBox())?.width ?? 0
  expect(monthWidth).toBeLessThan(weekWidth)

  await page.locator('[data-zoom="day"]').click()
  await expect(view).toHaveAttribute('data-current-zoom', 'day')
})

test('drags a bar to move it; dates persist after reload', async () => {
  const { page } = await setup()
  const offsite = await taskByTitle(page, 'Plan team offsite logistics')
  const b = bar(page, offsite.id)
  await expect(b).toHaveAttribute('data-start', localDate(8))
  const box = await b.boundingBox()
  if (!box) throw new Error('bar not visible')

  await drag(page, { x: box.x + box.width / 2, y: box.y + box.height / 2 }, 3 * 40)
  await expect(page.getByTestId('timeline-drag-label')).toBeVisible()
  await page.mouse.up()

  await expect(b).toHaveAttribute('data-start', localDate(11))
  await expect(b).toHaveAttribute('data-end', localDate(18))
  // The drag did not count as a click.
  await expect(page.getByTestId('task-detail')).toHaveCount(0)

  await page.reload()
  await page.waitForSelector('[data-slot="view"]')
  await openTimeline(page)
  await expect(bar(page, offsite.id)).toHaveAttribute('data-start', localDate(11))
  const saved = await taskByTitle(page, 'Plan team offsite logistics')
  expect([saved.startDate, saved.dueDate]).toEqual([localDate(11), localDate(18)])
})

test('Esc cancels a drag', async () => {
  const { page } = await setup()
  const t = await taskByTitle(page, 'Quarterly security training')
  const box = await bar(page, t.id).boundingBox()
  if (!box) throw new Error('bar not visible')
  await drag(page, { x: box.x + box.width / 2, y: box.y + box.height / 2 }, 2 * 40)
  await page.keyboard.press('Escape')
  await page.mouse.up()
  await expect(bar(page, t.id)).toHaveAttribute('data-end', localDate(12))
  expect((await taskByTitle(page, 'Quarterly security training')).dueDate).toBe(localDate(12))
})

test('resizes an edge to change the due date; a single-date bar becomes a range', async () => {
  const { page } = await setup()
  const runbook = await taskByTitle(page, 'Update the on-call runbook')
  const b = bar(page, runbook.id)
  let box = await b.boundingBox()
  if (!box) throw new Error('bar not visible')
  await drag(page, { x: box.x + box.width - 2, y: box.y + box.height / 2 }, 2 * 40)
  await page.mouse.up()
  await expect(b).toHaveAttribute('data-end', localDate(5))
  await expect(b).toHaveAttribute('data-start', localDate(1))
  const saved = await taskByTitle(page, 'Update the on-call runbook')
  expect([saved.startDate, saved.dueDate]).toEqual([localDate(1), localDate(5)])

  // Single-date (due only) task: dragging its right edge keeps the due date as the start.
  const dentist = await taskByTitle(page, 'Book dentist appointment')
  box = await bar(page, dentist.id).boundingBox()
  if (!box) throw new Error('bar not visible')
  await drag(page, { x: box.x + box.width - 2, y: box.y + box.height / 2 }, 2 * 40)
  await page.mouse.up()
  await expect(bar(page, dentist.id)).toHaveAttribute('data-end', localDate(3))
  const d = await taskByTitle(page, 'Book dentist appointment')
  expect([d.startDate, d.dueDate]).toEqual([localDate(1), localDate(3)])
})

test('clicking a bar opens the detail panel and highlights the row', async () => {
  const { page } = await setup()
  const t = await taskByTitle(page, 'Quarterly security training')
  await bar(page, t.id).click()
  await expect(page.getByTestId('task-detail')).toBeVisible()
  await expect(page.locator(`[data-task-id="${t.id}"]`)).toHaveAttribute('data-selected', 'true')
})

test('"Completed" toggle adds dated done tasks', async () => {
  const { page } = await setup()
  const done = await taskByTitle(page, 'Email landlord about the heating')
  await expect(bar(page, done.id)).toHaveCount(0)
  await page.getByRole('button', { name: 'Show completed' }).click()
  await expect(bar(page, done.id)).toBeVisible()
  await page.getByRole('button', { name: 'Show completed' }).click()
  await expect(bar(page, done.id)).toHaveCount(0)
})

test('screenshots (light + dark, each zoom)', async () => {
  mkdirSync(SHOTS, { recursive: true })
  const { page } = await setup()
  await page.waitForTimeout(150)
  for (const theme of ['light', 'dark'] as const) {
    await page.evaluate(
      (th) => (globalThis as unknown as WithApi).api.settings.set({ theme: th }),
      theme,
    )
    for (const zoom of ['day', 'week', 'month'] as const) {
      await page.locator(`[data-zoom="${zoom}"]`).click()
      await page.getByRole('button', { name: 'Scroll to today' }).click()
      await page.waitForTimeout(450)
      await page.screenshot({ path: join(SHOTS, `timeline-${zoom}-${theme}.png`) })
    }
  }
  // Grouped + completed + a selected task with the detail panel open.
  await page.locator('[data-zoom="day"]').click()
  await page.getByRole('button', { name: 'Group by' }).click()
  await page.getByRole('menuitemradio', { name: 'Status' }).click()
  await page.getByRole('button', { name: 'Show completed' }).click()
  const t = await taskByTitle(page, 'Migrate billing service to the new queue')
  await bar(page, t.id).click()
  await page.waitForTimeout(400)
  await page.screenshot({ path: join(SHOTS, 'timeline-grouped-dark.png') })
  await page.evaluate(() => (globalThis as unknown as WithApi).api.settings.set({ theme: 'light' }))
  await page.waitForTimeout(200)
  await page.screenshot({ path: join(SHOTS, 'timeline-grouped-light.png') })
  // Drag preview.
  await page.keyboard.press('Escape')
  const offsite = await taskByTitle(page, 'Plan team offsite logistics')
  const box = await bar(page, offsite.id).boundingBox()
  if (box) {
    await drag(page, { x: box.x + 30, y: box.y + box.height / 2 }, -2 * 40)
    await page.screenshot({ path: join(SHOTS, 'timeline-dragging-light.png') })
    await page.keyboard.press('Escape')
    await page.mouse.up()
  }
})
