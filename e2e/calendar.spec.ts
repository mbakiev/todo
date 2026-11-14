// Calendar view e2e: navigation, drag to reschedule, click-to-create, "+N more", screenshots.
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test, type Page } from '@playwright/test'
import { addMonths, startOfMonth, todayLocal } from '../src/shared/dates'
import type { Api, CreateTaskInput } from '../src/shared/ipc'
import type { Task } from '../src/shared/types'
import { launchApp, type LaunchedApp } from './launch'

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
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.setSize(1400, 860))
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

const cell = (page: Page, date: string) => page.locator(`[data-date="${date}"]`)

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
  await launched.app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0]?.setSize(1400, 600),
  )
  await expect
    .poll(async () => Number((await more.innerText()).match(/\d+/)?.[0]))
    .toBeGreaterThan(before)
})

test('hides completed tasks with the toggle', async () => {
  const page = await openCalendar(false)
  await createTasks(page, [{ title: 'Finished thing', dueDate: day(12), status: 'done' }])
  await expect(page.locator('[data-task-id]', { hasText: 'Finished thing' })).toBeVisible()
  await page.getByRole('switch', { name: 'Show completed tasks' }).click()
  await expect(page.locator('[data-task-id]', { hasText: 'Finished thing' })).toHaveCount(0)
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
