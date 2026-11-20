// Timeline (Gantt) view: rendering, clamping, zoom, drag-to-move, resize, click, completed,
// and the record: started / blocked / done tasks drawn from when they actually ran.
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

/** `date` shifted by `days` (whole calendar days). */
function shiftDate(date: string, days: number): string {
  const [y, m, d] = date.split('-').map(Number)
  const t = new Date(y ?? 0, (m ?? 1) - 1, d ?? 1, 12)
  t.setDate(t.getDate() + days)
  const p = (n: number): string => String(n).padStart(2, '0')
  return `${t.getFullYear()}-${p(t.getMonth() + 1)}-${p(t.getDate())}`
}

/** Local calendar date of an epoch-ms timestamp (how the app turns startedAt into a day). */
function localDateOfMs(ms: number | null): string {
  if (ms === null) throw new Error('no timestamp')
  const t = new Date(ms)
  const p = (n: number): string => String(n).padStart(2, '0')
  return `${t.getFullYear()}-${p(t.getMonth() + 1)}-${p(t.getDate())}`
}

type WithApi = { api: Api }

async function updateTask(
  page: Page,
  id: string,
  patch: Parameters<Api['tasks']['update']>[1],
): Promise<Task> {
  return page.evaluate(
    ([taskId, p]) => (globalThis as unknown as WithApi).api.tasks.update(taskId, p),
    [id, patch] as const,
  )
}

async function createTask(page: Page, input: Parameters<Api['tasks']['create']>[0]): Promise<Task> {
  return page.evaluate((i) => (globalThis as unknown as WithApi).api.tasks.create(i), input)
}

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

function scrollerOf(page: Page): Locator {
  return page
    .getByTestId('timeline-left-pane')
    .locator('xpath=ancestor::div[contains(@class,"overflow-auto")][1]')
}

/** The first drawn day. It reaches back past today − 7 to where started work began. */
async function rangeStart(page: Page): Promise<string> {
  const start = await page.getByTestId('timeline-view').getAttribute('data-range-start')
  if (!start) throw new Error('no range start')
  return start
}

/** Seeded app with the timeline open; `ancient` (default on) adds a long-overdue task. */
async function setup(
  options: { ancient?: boolean } = {},
): Promise<{ page: Page; ancient: Task | null }> {
  launched = await launchApp({ seed: true })
  const { page, app } = launched
  await resizeMainWindow(app, 1400, 860)
  const ancient =
    options.ancient === false
      ? null
      : await createTask(page, {
          title: 'Archive old invoices',
          priority: 3,
          dueDate: localDate(-40),
        })
  await openTimeline(page)
  return { page, ancient }
}

async function setupWithAncient(): Promise<{ page: Page; ancient: Task }> {
  const { page, ancient } = await setup()
  if (!ancient) throw new Error('no ancient task')
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
  const { page, ancient } = await setupWithAncient()
  const bars = page.getByTestId('timeline-bar')
  expect(await bars.count()).toBeGreaterThan(15)

  const clamped = bar(page, ancient.id)
  await expect(clamped).toHaveAttribute('data-clamped', 'before')
  await expect(clamped).toHaveAttribute('data-overdue', 'true')
  await expect(clamped).toHaveAttribute('data-end', localDate(-40))
  await expect(clamped).toHaveAttribute('data-source', 'planned')
  await expect(clamped).not.toHaveAttribute('data-ongoing', /.+/)
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

  // Undated not-started tasks are not on the timeline; dated ones are listed in the left pane,
  // and so is every started task, dated or not.
  await expect(page.getByTestId('timeline-left-pane')).not.toContainText('Order new running shoes')
  await expect(page.getByTestId('timeline-left-pane')).toContainText('Plan team offsite logistics')
  await expect(page.getByTestId('timeline-left-pane')).toContainText(
    'Draft blog post on the migration',
  )
})

test('a pre-range stub follows the visible edge and drags into range', async () => {
  const { page, ancient } = await setupWithAncient()
  const scroller = scrollerOf(page)
  // The seed's started work pulls the range start back past today − 7.
  const start = await rangeStart(page)
  expect(start <= localDate(-7)).toBe(true)
  await scroller.evaluate((el) => (el.scrollLeft = 400)) // 10 days at Day zoom
  const pane = await page.getByTestId('timeline-left-pane').boundingBox()
  const b = bar(page, ancient.id)
  const box = await b.boundingBox()
  if (!box || !pane) throw new Error('not visible')
  expect(Math.abs(box.x - (pane.x + pane.width))).toBeLessThan(3)

  // The stub sits on (range start + 10 days); drop it 2 days later. The stub is
  // inside the grid's left auto-scroll zone (48px), so leave it in one move: lingering there
  // scrolls the chart left by a timing-dependent amount (a day too early on slower machines).
  const from = { x: box.x + box.width / 2, y: box.y + box.height / 2 }
  await page.mouse.move(from.x, from.y)
  await page.mouse.down()
  await page.mouse.move(from.x + 60, from.y)
  await page.mouse.move(from.x + 2 * 40, from.y)
  await page.mouse.up()
  await expect(b).toHaveAttribute('data-end', shiftDate(start, 12))
  await expect(b).not.toHaveAttribute('data-clamped', /.+/)
})

test('a long bar keeps its label in view when its start is scrolled off (every zoom)', async () => {
  const { page } = await setup()
  const long = await createTask(page, {
    title: 'Quarter-long migration',
    startDate: localDate(-3),
    dueDate: localDate(200),
  })
  const scroller = scrollerOf(page)
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

test('"Completed" toggle adds done tasks, drawn on the days they actually ran', async () => {
  const { page } = await setup()
  const done = await taskByTitle(page, 'Email landlord about the heating')
  await expect(bar(page, done.id)).toHaveCount(0)
  await page.getByRole('button', { name: 'Show completed' }).click()
  await expect(bar(page, done.id)).toBeVisible()
  // Started and completed today (the seed's same-instant finish).
  await expect(bar(page, done.id)).toHaveAttribute('data-status', 'done')
  await expect(bar(page, done.id)).toHaveAttribute('data-source', 'actual')
  await expect(bar(page, done.id)).toHaveAttribute('data-start', localDateOfMs(done.startedAt))
  await expect(bar(page, done.id)).toHaveAttribute('data-end', localDateOfMs(done.completedAt))
  await page.getByRole('button', { name: 'Show completed' }).click()
  await expect(bar(page, done.id)).toHaveCount(0)
})

test('an undated task appears once started, from today, and stays (hatched) when blocked', async () => {
  const { page } = await setup()
  const t = await createTask(page, { title: 'Undated, then started' })
  await expect(page.getByTestId('timeline-left-pane')).not.toContainText('Undated, then started')
  await expect(bar(page, t.id)).toHaveCount(0)

  await updateTask(page, t.id, { status: 'in_progress' })
  const b = bar(page, t.id)
  await expect(b).toHaveAttribute('data-status', 'in_progress')
  await expect(b).toHaveAttribute('data-source', 'actual')
  await expect(b).toHaveAttribute('data-ongoing', 'true')
  await expect(b).toHaveAttribute('data-open-ended', 'true')
  await expect(b).toHaveAttribute('data-start', localDate(0))
  await expect(b).toHaveAttribute('data-end', localDate(0))
  await expect(b.getByTestId('timeline-bar-hatch')).toHaveCount(0)
  await expect(page.getByTestId('timeline-left-pane')).toContainText('Undated, then started')

  await updateTask(page, t.id, { status: 'blocked' })
  await expect(b).toHaveAttribute('data-status', 'blocked')
  await expect(b).toHaveAttribute('data-source', 'actual')
  await expect(b).toHaveAttribute('data-ongoing', 'true')
  await expect(b).toHaveAttribute('data-start', localDate(0))
  await expect(b.getByTestId('timeline-bar-hatch')).toHaveCount(1)
  // The tooltip leads with the record.
  await b.hover()
  await expect(page.locator('[data-slot="tooltip-content"]')).toContainText('Blocked · started')
})

test('with Completed on, a task created and then finished shows a bar on today', async () => {
  const { page } = await setup()
  await page.getByRole('button', { name: 'Show completed' }).click()
  // Planned for later; finishing it draws it where it actually happened.
  const t = await createTask(page, { title: 'Done in one go', dueDate: localDate(10) })
  const b = bar(page, t.id)
  await expect(b).toHaveAttribute('data-source', 'planned')
  await expect(b).toHaveAttribute('data-start', localDate(10))
  await updateTask(page, t.id, { status: 'done' })
  await expect(b).toHaveAttribute('data-status', 'done')
  await expect(b).toHaveAttribute('data-source', 'actual')
  await expect(b).not.toHaveAttribute('data-ongoing', /.+/)
  await expect(b).toHaveAttribute('data-start', localDate(0))
  await expect(b).toHaveAttribute('data-end', localDate(0))
  // History does not drag.
  await expect(b.locator('[data-handle]')).toHaveCount(0)
  await b.hover()
  await expect(page.locator('[data-slot="tooltip-content"]')).toContainText('Completed')
})

test('seeded history: started work reaches back to its real start; done work shows when it ran', async () => {
  const { page } = await setup()
  // Blocked, no planned dates, started ~10 days ago: hatched, still going today.
  const vpn = await taskByTitle(page, 'Ask IT about VPN access for contractors')
  const vpnStart = localDateOfMs(vpn.startedAt)
  expect(vpnStart < localDate(-7)).toBe(true)
  expect((await rangeStart(page)) <= vpnStart).toBe(true)
  const vb = bar(page, vpn.id)
  await expect(vb).toHaveAttribute('data-status', 'blocked')
  await expect(vb).toHaveAttribute('data-source', 'actual')
  await expect(vb).toHaveAttribute('data-start', vpnStart)
  await expect(vb).toHaveAttribute('data-end', localDate(0))
  await expect(vb).toHaveAttribute('data-open-ended', 'true')
  await expect(vb).not.toHaveAttribute('data-clamped', /.+/)
  await expect(vb.getByTestId('timeline-bar-hatch')).toHaveCount(1)

  // In progress with no plan: from its start to today.
  const draft = await taskByTitle(page, 'Draft blog post on the migration')
  await expect(bar(page, draft.id)).toHaveAttribute('data-start', localDateOfMs(draft.startedAt))
  await expect(bar(page, draft.id)).toHaveAttribute('data-end', localDate(0))

  // In progress with a planned start earlier and a due date ahead: elapsed part + remainder.
  const billing = await taskByTitle(page, 'Migrate billing service to the new queue')
  const bb = bar(page, billing.id)
  await expect(bb).toHaveAttribute('data-start', localDateOfMs(billing.startedAt))
  await expect(bb).toHaveAttribute('data-end', localDate(6))
  await expect(bb).not.toHaveAttribute('data-open-ended', /.+/)
  await expect(bb.getByTestId('timeline-bar-elapsed')).toHaveCount(1)
  await expect(bb.getByTestId('timeline-bar-remainder')).toHaveCount(1)

  // Done, multi-day (~9 days, finished 24 days ago), only with Completed on.
  const laptop = await taskByTitle(page, 'Set up new laptop')
  await expect(bar(page, laptop.id)).toHaveCount(0)
  await page.getByRole('button', { name: 'Show completed' }).click()
  const lb = bar(page, laptop.id)
  await expect(lb).toHaveAttribute('data-status', 'done')
  await expect(lb).toHaveAttribute('data-source', 'actual')
  await expect(lb).toHaveAttribute('data-start', localDateOfMs(laptop.startedAt))
  await expect(lb).toHaveAttribute('data-end', localDateOfMs(laptop.completedAt))
  expect(localDateOfMs(laptop.startedAt) < localDateOfMs(laptop.completedAt)).toBe(true)
  // The range now reaches back to where that history began.
  expect((await rangeStart(page)) <= localDateOfMs(laptop.startedAt)).toBe(true)
})

test('a started bar: the body does not drag, the end handle sets the due date', async () => {
  const { page } = await setup()
  const t = await taskByTitle(page, 'Migrate billing service to the new queue')
  const started = localDateOfMs(t.startedAt)
  const b = bar(page, t.id)
  await expect(b).toHaveAttribute('data-start', started)
  await expect(b).toHaveAttribute('data-end', localDate(6))
  await expect(b.locator('[data-handle="start"]')).toHaveCount(0)
  await expect(b.locator('[data-handle="end"]')).toHaveCount(1)

  // End handle: two days later = a new due date.
  let box = await b.boundingBox()
  if (!box) throw new Error('bar not visible')
  await drag(page, { x: box.x + box.width - 2, y: box.y + box.height / 2 }, 2 * 40)
  await expect(page.getByTestId('timeline-drag-label')).toContainText('Due')
  await page.mouse.up()
  await expect(b).toHaveAttribute('data-end', localDate(8))
  await expect(b).toHaveAttribute('data-start', started)
  const saved = await taskByTitle(page, 'Migrate billing service to the new queue')
  expect([saved.startDate, saved.dueDate]).toEqual([localDate(-4), localDate(8)])
  await expect(page.getByTestId('task-detail')).toHaveCount(0)

  // Body: no drag preview, nothing changes.
  box = await b.boundingBox()
  if (!box) throw new Error('bar not visible')
  await drag(page, { x: box.x + 40, y: box.y + box.height / 2 }, 3 * 40)
  await expect(page.getByTestId('timeline-drag-label')).toHaveCount(0)
  await page.mouse.up()
  await expect(b).toHaveAttribute('data-start', started)
  await expect(b).toHaveAttribute('data-end', localDate(8))
  const after = await taskByTitle(page, 'Migrate billing service to the new queue')
  expect([after.startDate, after.dueDate]).toEqual([localDate(-4), localDate(8)])

  // A click still opens the detail panel.
  await b.click({ position: { x: 40, y: box.height / 2 } })
  await expect(page.getByTestId('task-detail')).toBeVisible()
})

test('"Today" with Completed on scrolls old history rows above the fold', async () => {
  const { page } = await setup({ ancient: false })
  const scroller = scrollerOf(page)
  // Only open work: the first row already qualifies.
  expect(await scroller.evaluate((el) => el.scrollTop)).toBe(0)

  await page.getByRole('button', { name: 'Show completed' }).click()
  await page.getByRole('button', { name: 'Scroll to today' }).click()
  await expect.poll(() => scroller.evaluate((el) => el.scrollTop)).toBeGreaterThan(0)

  const header = await page.getByTestId('timeline-header').boundingBox()
  if (!header) throw new Error('no header')
  const headerBottom = header.y + header.height
  // Finished 40 days ago (first row): scrolled up under the header.
  const flu = await taskByTitle(page, 'Flu shot')
  await expect
    .poll(async () => {
      const r = await page.locator(`[data-row-id="${flu.id}"]`).boundingBox()
      return r ? r.y + r.height : -Infinity
    })
    .toBeLessThanOrEqual(headerBottom + 1)
  // Open work started 12 days ago is in view near the top.
  const kitchen = await taskByTitle(page, 'Kitchen renovation quotes')
  const k = await page.locator(`[data-row-id="${kitchen.id}"]`).boundingBox()
  if (!k) throw new Error('row not rendered')
  expect(k.y).toBeGreaterThanOrEqual(headerBottom - 1)
  expect(k.y).toBeLessThan(headerBottom + 8 * 32)

  // The same positioning on first render (Completed stays on).
  await page.locator('[data-view="list"]').click()
  await openTimeline(page)
  await expect.poll(() => scrollerOf(page).evaluate((el) => el.scrollTop)).toBeGreaterThan(0)
})

/** Days from the visible left edge of the grid to today (fractional; stays put when anchored). */
async function todayFromLeftEdge(page: Page): Promise<number> {
  const [start, scrollLeft, zoom] = await Promise.all([
    rangeStart(page),
    scrollerOf(page).evaluate((el) => el.scrollLeft),
    page.getByTestId('timeline-view').getAttribute('data-current-zoom'),
  ])
  const dw = zoom === 'day' ? 40 : zoom === 'week' ? 18 : 6
  const [y, m, d] = start.split('-').map(Number)
  const [ty, tm, td] = localDate(0).split('-').map(Number)
  const days = Math.round(
    (Date.UTC(ty ?? 0, (tm ?? 1) - 1, td ?? 1) - Date.UTC(y ?? 0, (m ?? 1) - 1, d ?? 1)) /
      86_400_000,
  )
  return days - scrollLeft / dw
}

async function todayLineX(page: Page): Promise<number> {
  const box = await page.getByTestId('timeline-today-line').boundingBox()
  if (!box) throw new Error('no today line')
  return box.x
}

test('the visible dates stay put when the range start moves with the data', async () => {
  const { page } = await setup({ ancient: false })
  const x0 = await todayLineX(page)
  const start0 = await rangeStart(page)

  // Completed on: finished history pulls the range start back by weeks.
  await page.getByRole('button', { name: 'Show completed' }).click()
  await expect.poll(() => rangeStart(page)).not.toBe(start0)
  expect((await rangeStart(page)) < start0).toBe(true)
  expect(Math.abs((await todayLineX(page)) - x0)).toBeLessThanOrEqual(1)

  // A zoom change after the shift still keeps the left-edge date.
  const lead = await todayFromLeftEdge(page)
  await page.locator('[data-zoom="week"]').click()
  await expect(page.getByTestId('timeline-view')).toHaveAttribute('data-current-zoom', 'week')
  expect(Math.abs((await todayFromLeftEdge(page)) - lead)).toBeLessThan(0.1)
  await page.locator('[data-zoom="day"]').click()
  await expect(page.getByTestId('timeline-view')).toHaveAttribute('data-current-zoom', 'day')
  expect(Math.abs((await todayLineX(page)) - x0)).toBeLessThanOrEqual(1)

  // Completed off again: back to the open-work start, same place on screen.
  await page.getByRole('button', { name: 'Show completed' }).click()
  await expect.poll(() => rangeStart(page)).toBe(start0)
  expect(Math.abs((await todayLineX(page)) - x0)).toBeLessThanOrEqual(1)

  // The earliest started open task is finished (Completed off): the start moves forward.
  const kitchen = await taskByTitle(page, 'Kitchen renovation quotes')
  expect(localDateOfMs(kitchen.startedAt)).toBe(start0)
  await updateTask(page, kitchen.id, { status: 'done' })
  await expect(bar(page, kitchen.id)).toHaveCount(0)
  await expect.poll(() => rangeStart(page)).not.toBe(start0)
  expect((await rangeStart(page)) > start0).toBe(true)
  expect(Math.abs((await todayLineX(page)) - x0)).toBeLessThanOrEqual(1)
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
