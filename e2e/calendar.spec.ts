// Calendar view e2e: navigation, drag to reschedule, click-to-create, "+N more", started /
// done tasks drawn from their record (display span), screenshots.
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test, type Locator, type Page } from '@playwright/test'
import { addDays, addMonths, startOfMonth, todayLocal } from '../src/shared/dates'
import type { Api, CreateTaskInput, UpdateTaskPatch } from '../src/shared/ipc'
import type { Task } from '../src/shared/types'
import { launchApp, resizeMainWindow, type LaunchedApp } from './launch'

const OUT = join(__dirname, 'screenshots')
let launched: LaunchedApp

test.afterEach(async () => {
  await launched?.close()
})

/** Day `n` of the current month as YYYY-MM-DD. */
const day = (n: number): string =>
  `${startOfMonth(todayLocal()).slice(0, 8)}${String(n).padStart(2, '0')}`

async function openCalendar(seed = true): Promise<Page> {
  launched = await launchApp({ seed })
  const { page, app } = launched
  await resizeMainWindow(app, 1400, 860)
  await page.locator('[data-view="calendar"]').click()
  await expect(page.getByTestId('calendar-view')).toBeVisible()
  return page
}

const listTasks = (page: Page): Promise<Task[]> =>
  page.evaluate(() => (globalThis as unknown as { api: Api }).api.tasks.list())

const createTasks = (page: Page, inputs: CreateTaskInput[]): Promise<unknown> =>
  page.evaluate(async (list) => {
    const api = (globalThis as unknown as { api: Api }).api
    for (const input of list) await api.tasks.create(input)
  }, inputs)

const createTask = (page: Page, input: CreateTaskInput): Promise<Task> =>
  page.evaluate((i) => (globalThis as unknown as { api: Api }).api.tasks.create(i), input)

const updateTask = (page: Page, id: string, patch: UpdateTaskPatch): Promise<Task> =>
  page.evaluate(
    ([taskId, p]) => (globalThis as unknown as { api: Api }).api.tasks.update(taskId, p),
    [id, patch] as const,
  )

const cell = (page: Page, date: string) => page.locator(`[data-date="${date}"]`)

/** Grid items (not popover rows) for a task id. */
const gridItem = (page: Page, id: string) =>
  page.getByTestId('calendar-grid').locator(`[data-task-id="${id}"]`)

/** True when the element's left edge sits inside the given day's column. */
async function startsInColumn(page: Page, el: Locator, date: string): Promise<boolean> {
  const box = await el.boundingBox()
  const col = await cell(page, date).boundingBox()
  return !!box && !!col && box.x >= col.x && box.x < col.x + col.width
}

/** A date in the current month a few days away from today (so its cell is in the grid). */
const nearbyDay = (): string => {
  const today = todayLocal()
  return Number(today.slice(8)) <= 20 ? addDays(today, 3) : addDays(today, -3)
}

async function drag(page: Page, from: { x: number; y: number }, to: { x: number; y: number }) {
  await page.mouse.move(from.x, from.y)
  await page.mouse.down()
  await page.mouse.move(from.x + 8, from.y + 4, { steps: 3 })
  await page.mouse.move(to.x, to.y, { steps: 12 })
  await page.mouse.up()
}

test('navigates months', async () => {
  const page = await openCalendar(false)
  const label = page.getByTestId('calendar-month-label')
  const fmt = (d: string): string =>
    new Intl.DateTimeFormat('en-US', { month: 'long', year: 'numeric' }).format(
      new Date(Number(d.slice(0, 4)), Number(d.slice(5, 7)) - 1, 1),
    )
  const thisMonth = startOfMonth(todayLocal())
  await expect(label).toHaveText(fmt(thisMonth))
  await expect(cell(page, todayLocal())).toHaveAttribute('data-in-month', 'true')

  await page.getByRole('button', { name: 'Next month' }).click()
  await expect(label).toHaveText(fmt(addMonths(thisMonth, 1)))
  await expect(cell(page, addMonths(thisMonth, 1))).toHaveAttribute('data-in-month', 'true')
  await page.getByRole('button', { name: 'Previous month' }).click()
  await page.getByRole('button', { name: 'Previous month' }).click()
  await expect(label).toHaveText(fmt(addMonths(thisMonth, -1)))
  await page.getByRole('button', { name: 'Go to today' }).click()
  await expect(label).toHaveText(fmt(thisMonth))
})

test('drags tasks to another day; dates persist after reload', async () => {
  const page = await openCalendar(false)
  await createTasks(page, [
    { title: 'Single chip', dueDate: day(15) },
    { title: 'Ranged bar', startDate: day(9), dueDate: day(11) },
  ])
  const chip = page.locator('[data-task-id]', { hasText: 'Single chip' })
  await expect(chip).toBeVisible()

  // Single-date task: move its due date 15 → 17.
  const chipBox = await chip.boundingBox()
  const target = await cell(page, day(17)).boundingBox()
  if (!chipBox || !target) throw new Error('missing boxes')
  await drag(
    page,
    { x: chipBox.x + 20, y: chipBox.y + chipBox.height / 2 },
    { x: target.x + target.width / 2, y: target.y + target.height - 12 },
  )
  await expect
    .poll(async () => (await listTasks(page)).find((t) => t.title === 'Single chip')?.dueDate)
    .toBe(day(17))
  // No drop-target highlight left behind.
  await expect(cell(page, day(17))).not.toHaveClass(/bg-selection/)

  // Ranged task grabbed on its middle day (10th) and dropped on the 18th: shifts by 8 days.
  const bar = page.locator('[data-task-id]', { hasText: 'Ranged bar' }).first()
  const barBox = await bar.boundingBox()
  const grab = await cell(page, day(10)).boundingBox()
  const drop = await cell(page, day(18)).boundingBox()
  if (!barBox || !grab || !drop) throw new Error('missing boxes')
  await drag(
    page,
    { x: grab.x + grab.width / 2, y: barBox.y + barBox.height / 2 },
    { x: drop.x + drop.width / 2, y: drop.y + drop.height - 12 },
  )
  await expect
    .poll(async () => {
      const t = (await listTasks(page)).find((x) => x.title === 'Ranged bar')
      return [t?.startDate, t?.dueDate]
    })
    .toEqual([day(17), day(19)])

  await page.reload()
  await page.locator('[data-view="calendar"]').click()
  const tasks = await listTasks(page)
  expect(tasks.find((t) => t.title === 'Single chip')?.dueDate).toBe(day(17))
  expect(tasks.find((t) => t.title === 'Ranged bar')).toMatchObject({
    startDate: day(17),
    dueDate: day(19),
  })
  // Rendered in the new place: the chip sits inside the 17th's column.
  const moved = await page.locator('[data-task-id]', { hasText: 'Single chip' }).boundingBox()
  const col17 = await cell(page, day(17)).boundingBox()
  expect(moved && col17 && moved.x >= col17.x && moved.x < col17.x + col17.width).toBe(true)
})

test('clicking an empty day opens the new-task dialog with that due date', async () => {
  const page = await openCalendar(false)
  await cell(page, day(25)).click({ position: { x: 10, y: 10 } })
  const input = page.getByRole('textbox', { name: 'Task title' })
  await expect(input).toBeVisible()
  await input.fill('Created from calendar')
  await input.press('Enter')
  await expect
    .poll(
      async () => (await listTasks(page)).find((t) => t.title === 'Created from calendar')?.dueDate,
    )
    .toBe(day(25))
  await expect(page.locator('[data-task-id]', { hasText: 'Created from calendar' })).toBeVisible()
})

test('"+N more" opens a popover listing the day\'s tasks; click opens detail', async () => {
  const page = await openCalendar(false)
  await createTasks(
    page,
    Array.from({ length: 9 }, (_, i) => ({ title: `Busy task ${i + 1}`, dueDate: day(20) })),
  )
  const more = page.locator(`[data-more="${day(20)}"]`)
  await expect(more).toBeVisible()
  await expect(more).toHaveText(/^\+\d+ more$/)
  await more.click()
  const pop = page.getByTestId('calendar-more-popover')
  await expect(pop).toBeVisible()
  await expect(pop.locator('[data-task-id]')).toHaveCount(9)
  await pop.locator('[data-task-id]', { hasText: 'Busy task 3' }).click()
  await expect(pop).toHaveCount(0)
  await expect(page.getByTestId('task-detail')).toBeVisible()

  // Shrinking the window shows fewer lanes → more hidden.
  const before = Number((await more.innerText()).match(/\d+/)?.[0])
  await resizeMainWindow(launched.app, 1400, 600)
  await expect
    .poll(async () => Number((await more.innerText()).match(/\d+/)?.[0]))
    .toBeGreaterThan(before)
})

test('done tasks show on the day they were completed; the toggle hides and shows them', async () => {
  const page = await openCalendar(false)
  const today = todayLocal()
  const planned = nearbyDay()
  // Planned for another day, completed now: drawn on today (the record), not on the plan.
  const done = await createTask(page, { title: 'Finished thing', dueDate: planned, status: 'done' })
  const item = gridItem(page, done.id)
  await expect(item).toBeVisible()
  await expect(item).toHaveAttribute('data-status', 'done')
  await expect(item).toHaveAttribute('data-source', 'actual')
  await expect(item).toHaveAttribute('data-ongoing', 'false')
  await expect(item).toHaveAttribute('data-kind', 'chip')
  expect(await startsInColumn(page, item, today)).toBe(true)
  expect(await startsInColumn(page, item, planned)).toBe(false)
  await expect(item).toHaveAttribute('title', /^Finished thing — Completed /)

  await page.getByRole('button', { name: 'Show completed' }).click()
  await expect(item).toHaveCount(0)
  await page.getByRole('button', { name: 'Show completed' }).click()
  await expect(item).toBeVisible()
  expect(await startsInColumn(page, item, today)).toBe(true)
})

test('an undated task set to In Progress appears on today; blocked shows the marker', async () => {
  const page = await openCalendar(false)
  const today = todayLocal()
  const task = await createTask(page, { title: 'Undated work' })
  // Undated and not started: not on the calendar at all.
  await expect(page.locator(`[data-task-id="${task.id}"]`)).toHaveCount(0)

  await updateTask(page, task.id, { status: 'in_progress' })
  const item = gridItem(page, task.id)
  await expect(item).toBeVisible()
  await expect(item).toHaveAttribute('data-status', 'in_progress')
  await expect(item).toHaveAttribute('data-source', 'actual')
  await expect(item).toHaveAttribute('data-ongoing', 'true')
  await expect(item).toHaveAttribute('data-kind', 'chip')
  await expect(item).toHaveAttribute('aria-label', 'Undated work')
  await expect(item).toHaveAttribute('title', /^Undated work — Started .* · in progress /)
  expect(await startsInColumn(page, item, today)).toBe(true)
  await expect(item.locator('[data-blocked-marker]')).toHaveCount(0)

  await updateTask(page, task.id, { status: 'blocked' })
  await expect(item).toHaveAttribute('data-status', 'blocked')
  await expect(item.locator('[data-blocked-marker]')).toBeVisible()
  await expect(item).toHaveAttribute('title', /^Undated work — Blocked · started /)
  expect(await startsInColumn(page, item, today)).toBe(true)

  // Back to Not Started: undated again, so it leaves the calendar.
  await updateTask(page, task.id, { status: 'not_started' })
  await expect(page.locator(`[data-task-id="${task.id}"]`)).toHaveCount(0)
})

test('only not-started items drag; an in-progress item stays put', async () => {
  const page = await openCalendar(false)
  const today = todayLocal()
  const target = nearbyDay()
  const planned = await createTask(page, { title: 'Planned chip', dueDate: today })
  const running = await createTask(page, { title: 'Running chip', status: 'in_progress' })
  const plannedItem = gridItem(page, planned.id)
  const runningItem = gridItem(page, running.id)
  await expect(plannedItem).toBeVisible()
  await expect(runningItem).toBeVisible()
  // dnd-kit's drag affordance only on the draggable one.
  await expect(plannedItem).toHaveAttribute('aria-roledescription', 'draggable')
  await expect(runningItem).not.toHaveAttribute('aria-roledescription')

  const drop = await cell(page, target).boundingBox()
  if (!drop) throw new Error('missing drop cell')
  const to = { x: drop.x + drop.width / 2, y: drop.y + drop.height - 12 }

  // The in-progress item: nothing moves, nothing is written.
  const runBox = await runningItem.boundingBox()
  if (!runBox) throw new Error('missing running box')
  await drag(page, { x: runBox.x + 20, y: runBox.y + runBox.height / 2 }, to)
  await expect(cell(page, target)).not.toHaveClass(/bg-selection/)
  await page.waitForTimeout(300)
  expect((await listTasks(page)).find((t) => t.id === running.id)).toMatchObject({
    status: 'in_progress',
    startDate: null,
    dueDate: null,
  })
  expect(await startsInColumn(page, runningItem, today)).toBe(true)
  await page.keyboard.press('Escape')

  // A click on the in-progress item still opens the detail panel. (Checked before the real
  // drag below: dnd-kit swallows every click for 50 ms after a drop, which an immediate
  // Playwright click would hit.)
  await runningItem.click()
  await expect(page.getByTestId('task-detail')).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.getByTestId('task-detail')).toHaveCount(0)

  // The planned item moves its due date.
  const planBox = await plannedItem.boundingBox()
  if (!planBox) throw new Error('missing planned box')
  await drag(page, { x: planBox.x + 20, y: planBox.y + planBox.height / 2 }, to)
  await expect
    .poll(async () => (await listTasks(page)).find((t) => t.id === planned.id)?.dueDate)
    .toBe(target)
  await expect.poll(() => startsInColumn(page, plannedItem, target)).toBe(true)
})

test('seeded started and done tasks are drawn from their record', async () => {
  const page = await openCalendar(true)
  const today = todayLocal()
  const tasks = await listTasks(page)
  const byTitle = (title: string): Task => {
    const t = tasks.find((x) => x.title === title)
    if (!t) throw new Error(`seed task missing: ${title}`)
    return t
  }
  // Undated, in progress since ~3 days ago; blocked since ~10 days ago (both ongoing to today).
  for (const title of [
    'Draft blog post on the migration',
    'Ask IT about VPN access for contractors',
  ]) {
    const t = byTitle(title)
    expect(t.startDate).toBeNull()
    expect(t.dueDate).toBeNull()
    // A busy seeded day may push it behind "+N more"; either way it is on today.
    const items = gridItem(page, t.id)
    if ((await items.count()) > 0) {
      const last = items.last()
      await expect(last).toHaveAttribute('data-source', 'actual')
      await expect(last).toHaveAttribute('data-ongoing', 'true')
      await expect(last).toHaveAttribute('data-kind', 'bar')
      if (t.status === 'blocked') await expect(last.locator('[data-blocked-marker]')).toBeVisible()
    } else {
      await page.locator(`[data-more="${today}"]`).click()
      const pop = page.getByTestId('calendar-more-popover')
      const row = pop.locator(`[data-task-id="${t.id}"]`)
      await expect(row).toHaveAttribute('data-source', 'actual')
      await expect(row).toHaveAttribute('data-ongoing', 'true')
      if (t.status === 'blocked') await expect(row.locator('[data-blocked-marker]')).toBeVisible()
      await page.keyboard.press('Escape')
      await expect(pop).toHaveCount(0)
    }
  }

  // Blocked since Nov-ish with a due date ~60 days out: the hatch (elapsed part) stops at
  // today; the planned remainder after today is lighter and never hatched.
  const kitchen = byTitle('Kitchen renovation quotes')
  expect(kitchen.status).toBe('blocked')
  const todayRow = page.locator('[data-week]').filter({ has: cell(page, today) })
  const rowDates = await todayRow
    .locator('[data-date]')
    .evaluateAll((els) => els.map((e) => e.getAttribute('data-date') ?? ''))
  const pieces = todayRow.locator(`[data-task-id="${kitchen.id}"]`)
  const current = pieces.filter({ has: page.locator('[data-bar-hatch]') }).last()
  await expect(current).toHaveAttribute('data-ongoing', 'true')
  const elapsedCols = Number(await current.getAttribute('data-elapsed-cols'))
  expect(elapsedCols).toBeGreaterThan(0)
  const hatchBox = await current.locator('[data-bar-hatch]').boundingBox()
  const todayBox = await cell(page, today).boundingBox()
  if (!hatchBox || !todayBox) throw new Error('missing boxes')
  // Item insets are a few px; the hatch ends at today's column, not at the bar's end.
  expect(Math.abs(hatchBox.x + hatchBox.width - (todayBox.x + todayBox.width))).toBeLessThan(10)
  if (rowDates[rowDates.length - 1] !== today) {
    await expect(current.locator('[data-bar-remainder]')).toBeVisible()
  }

  // Next month: every week row entirely after today shows only remainder.
  await page.getByRole('button', { name: 'Next month' }).click()
  const futureRows = page.locator('[data-week]')
  const weekStarts = await futureRows.evaluateAll((els) =>
    els.map((e) => e.getAttribute('data-week') ?? ''),
  )
  let checked = 0
  for (const w of weekStarts.filter((x) => x > today)) {
    const future = page.locator(`[data-week="${w}"] [data-task-id="${kitchen.id}"]`)
    if ((await future.count()) === 0) continue
    for (const el of await future.all()) {
      await expect(el).toHaveAttribute('data-elapsed-cols', '0')
      await expect(el.locator('[data-bar-hatch]')).toHaveCount(0)
      await expect(el.locator('[data-bar-remainder]')).toBeVisible()
      await expect(el.locator('[data-blocked-marker]')).toBeVisible()
    }
    checked++
  }
  expect(checked).toBeGreaterThan(0)
})

test('screenshots (light + dark)', async () => {
  mkdirSync(OUT, { recursive: true })
  const page = await openCalendar(true)
  await createTasks(page, [
    { title: 'Release train', startDate: day(3), dueDate: day(12), priority: 3 },
    { title: 'Vendor review', startDate: day(16), dueDate: day(24), priority: 2 },
    ...Array.from({ length: 6 }, (_, i) => ({ title: `Standup prep ${i + 1}`, dueDate: day(19) })),
    { title: 'Ship v1', dueDate: day(6), status: 'done' as const },
  ])
  await page.waitForTimeout(300)
  await page.screenshot({ path: join(OUT, 'calendar-light.png') })
  await page.locator(`[data-more="${day(19)}"]`).click()
  await page.waitForTimeout(250)
  await page.screenshot({ path: join(OUT, 'calendar-more-light.png') })
  await page.keyboard.press('Escape')
  await page.evaluate(() =>
    (globalThis as unknown as { api: Api }).api.settings.set({ theme: 'dark', weekStartsOn: 0 }),
  )
  await page.waitForTimeout(300)
  await page.screenshot({ path: join(OUT, 'calendar-dark.png') })
  await page.locator('[data-task-id]', { hasText: 'Release train' }).first().click()
  await page.waitForTimeout(300)
  await page.screenshot({ path: join(OUT, 'calendar-detail-dark.png') })
})
