// Cross-feature flows: features built separately (board, list, timeline, calendar, detail
// panel, quick add, settings) working together in one window.
import { expect, test, type ElectronApplication, type Locator, type Page } from '@playwright/test'
import { addDays, formatRelativeDate, startOfMonth, todayLocal } from '../src/shared/dates'
import type { Api, CreateTaskInput } from '../src/shared/ipc'
import type { Task } from '../src/shared/types'
import { pickUpWithKeyboard, resizeMainWindow, windowByEntry } from './launch'
import { launchShell, MOD, openQuickAdd, type ShellApp } from './shellHelpers'

let shell: ShellApp | undefined

test.afterEach(async () => {
  await shell?.close()
  shell = undefined
})

type W = { api: Api }
const VIEWS = ['today', 'week', 'everything', 'list', 'timeline', 'calendar'] as const
type View = (typeof VIEWS)[number]

async function start(seed = false): Promise<{ app: ElectronApplication; page: Page }> {
  shell = await launchShell({ seed })
  await resizeMainWindow(shell.app, 1400, 900)
  return { app: shell.app, page: shell.page }
}

const listTasks = (page: Page): Promise<Task[]> =>
  page.evaluate(() => (globalThis as unknown as W).api.tasks.list())

const createTask = (page: Page, input: CreateTaskInput): Promise<Task> =>
  page.evaluate((i) => (globalThis as unknown as W).api.tasks.create(i), input)

async function show(page: Page, view: View): Promise<void> {
  await page.locator(`[data-view="${view}"]`).click()
  await expect(page.locator(`[data-view="${view}"]`)).toHaveAttribute('aria-current', 'page')
}

/** The elements that represent tasks in the active view (cards, rows, bars, chips). */
function items(page: Page, view: View): Locator {
  switch (view) {
    case 'today':
    case 'week':
    case 'everything':
      return page.locator(`[data-testid="board-${view}"] [data-task-id]`)
    case 'list':
      return page.locator('[data-testid="list-view"] [role="row"][data-task-id]')
    case 'timeline':
      return page.locator('[data-testid="timeline-bar"]')
    case 'calendar':
      return page.locator('[data-testid="calendar-view"] [data-task-id]')
  }
}

const item = (page: Page, view: View, title: string): Locator =>
  view === 'timeline'
    ? page.locator(`[data-testid="timeline-bar"][aria-label="${title}"]`)
    : items(page, view).filter({ hasText: title }).first()

async function itemIds(page: Page, view: View): Promise<string[]> {
  const attr = view === 'timeline' ? 'data-bar-id' : 'data-task-id'
  return items(page, view).evaluateAll(
    (els, a) => [...new Set(els.map((e) => e.getAttribute(a) ?? ''))],
    attr,
  )
}

const panel = (page: Page) => page.getByTestId('task-detail')
const panelTitle = (page: Page) => panel(page).getByRole('textbox', { name: 'Title' })

async function openFromView(page: Page, view: View, title: string): Promise<void> {
  const el = item(page, view, title)
  if (view === 'list') await el.locator('[data-col="title"]').click()
  else await el.click()
  await expect(panelTitle(page)).toHaveValue(title)
}

const today = todayLocal()

test('calendar: clicking an empty day shows that due date in the dialog, once', async () => {
  const { app, page } = await start()
  await show(page, 'calendar')
  const date = `${startOfMonth(today).slice(0, 8)}25`
  await page.locator(`[data-date="${date}"]`).click({ position: { x: 10, y: 10 } })
  const dialog = page.getByTestId('new-task-dialog')
  const due = dialog.getByRole('button', { name: /^Due date:/ })
  await expect(due).toHaveAccessibleName(`Due date: ${formatRelativeDate(date, today)}`)

  // A second "new task" trigger (shortcut or menu) must not reset the prefill.
  await dialog.getByRole('textbox', { name: 'Task title' }).fill('Dentist')
  await page.keyboard.press(`${MOD}+n`)
  await app.evaluate(({ Menu }) => Menu.getApplicationMenu()?.getMenuItemById('new-task')?.click())
  await expect(due).toHaveAccessibleName(`Due date: ${formatRelativeDate(date, today)}`)
  await expect(dialog.getByRole('textbox', { name: 'Task title' })).toHaveValue('Dentist')
  await expect(page.getByTestId('new-task-dialog')).toHaveCount(1)

  await dialog.getByRole('textbox', { name: 'Task title' }).press('Enter')
  await expect(dialog).toBeHidden()
  await expect(
    page.locator(`[data-testid="calendar-view"] [data-task-id]`, { hasText: 'Dentist' }),
  ).toBeVisible()
  expect((await listTasks(page)).find((t) => t.title === 'Dentist')?.dueDate).toBe(date)
})

test('Cmd/Ctrl+N opens the new-task dialog exactly once', async () => {
  const { page } = await start()
  await page.evaluate(() => {
    const g = globalThis as unknown as { __dialogOpens: number; MutationObserver: never }
    g.__dialogOpens = 0
    const doc = (
      globalThis as unknown as { document: { body: unknown; querySelector(s: string): unknown } }
    ).document
    const MO = (
      globalThis as unknown as {
        MutationObserver: new (cb: () => void) => { observe(n: unknown, o: object): void }
      }
    ).MutationObserver
    let open = false
    new MO(() => {
      const now = doc.querySelector('[data-testid="new-task-dialog"]') !== null
      if (now && !open) g.__dialogOpens++
      open = now
    }).observe(doc.body, { childList: true, subtree: true })
  })
  await page.keyboard.press(`${MOD}+n`)
  await expect(page.getByTestId('new-task-dialog')).toBeVisible()
  await page.waitForTimeout(300)
  expect(
    await page.evaluate(() => (globalThis as unknown as { __dialogOpens: number }).__dialogOpens),
  ).toBe(1)
})

test('quick-add popup tasks appear live in the open main window, in every view', async () => {
  const { app, page } = await start()
  for (const view of ['today', 'list', 'timeline', 'calendar'] as const) {
    await show(page, view)
    const qa = await openQuickAdd(app)
    const title = `Live in ${view}`
    await qa.getByRole('textbox', { name: 'Task title' }).fill(`${title} !high @today`)
    await qa.getByRole('textbox', { name: 'Task title' }).press('Enter')
    await expect(item(page, view, title)).toBeVisible()
  }
  // An undated task: boards and list, but not the date-based views.
  const qa = await openQuickAdd(app)
  await qa.getByRole('textbox', { name: 'Task title' }).fill('Someday maybe')
  await qa.getByRole('textbox', { name: 'Task title' }).press('Enter')
  await show(page, 'everything')
  await expect(item(page, 'everything', 'Someday maybe')).toBeVisible()
  await show(page, 'timeline')
  await expect(item(page, 'timeline', 'Live in today')).toBeVisible()
  await expect(item(page, 'timeline', 'Someday maybe')).toHaveCount(0)
})

test('detail panel from every view: live edits underneath, Delete + Undo', async () => {
  const { page } = await start()
  // One task per view, due today (visible on boards, timeline and calendar).
  for (const view of VIEWS)
    await createTask(page, { title: `Open me in ${view}`, dueDate: today, priority: 3 })
  // Calendar: enough tasks on one day to overflow into "+N more".
  for (let i = 0; i < 8; i++) await createTask(page, { title: `Filler ${i}`, dueDate: today })

  for (const view of VIEWS) {
    await show(page, view)
    const title = `Open me in ${view}`
    if (view === 'calendar') {
      await page.locator(`[data-more="${today}"]`).click()
      const pop = page.getByTestId('calendar-more-popover')
      await pop.locator('[data-task-id]', { hasText: title }).click()
      await expect(pop).toHaveCount(0)
      await expect(panelTitle(page)).toHaveValue(title)
    } else {
      await openFromView(page, view, title)
    }
    // The same task reads as selected underneath.
    const selectedAttr = view === 'list' ? 'aria-selected' : 'data-selected'
    if (view !== 'calendar')
      await expect(item(page, view, title)).toHaveAttribute(selectedAttr, 'true')

    // Edit in the panel → the view underneath follows (after the autosave debounce).
    await panelTitle(page).fill(`${title} (edited)`)
    if (view === 'calendar') {
      // It lives in the overflow: reopen the popover (Esc then closes only the popover).
      await page.locator(`[data-more="${today}"]`).click()
      const pop = page.getByTestId('calendar-more-popover')
      await expect(pop.locator('[data-task-id]', { hasText: `${title} (edited)` })).toBeVisible()
      await expect(pop.locator(`[data-selected]`)).toHaveText(`${title} (edited)`)
      await page.keyboard.press('Escape')
      await expect(pop).toHaveCount(0)
      await expect(panel(page)).toBeVisible()
    } else {
      await expect(item(page, view, `${title} (edited)`)).toBeAttached()
    }
    // Discrete fields save immediately.
    await panel(page)
      .getByRole('button', { name: /^Priority:/ })
      .click()
    await page.getByRole('menuitem', { name: /Critical$/ }).click()
    await expect
      .poll(
        async () => (await listTasks(page)).find((t) => t.title === `${title} (edited)`)?.priority,
      )
      .toBe(4)

    // Delete + Undo.
    await panel(page).getByRole('button', { name: 'Delete task' }).click()
    await expect(panel(page)).toHaveCount(0)
    await expect
      .poll(async () => (await listTasks(page)).some((t) => t.title === `${title} (edited)`))
      .toBe(false)
    if (view !== 'calendar') await expect(item(page, view, `${title} (edited)`)).toHaveCount(0)
    await page.getByRole('button', { name: 'Undo' }).click()
    await expect
      .poll(async () => (await listTasks(page)).some((t) => t.title === `${title} (edited)`))
      .toBe(true)
    if (view !== 'calendar') await expect(item(page, view, `${title} (edited)`)).toBeAttached()
  }
})

test('Esc: a drag or an overlay consumes it before the detail panel', async () => {
  const { page } = await start(true)
  await show(page, 'today')
  const [first, second] = await page
    .locator('[data-testid="board-today"] [data-testid="column-not_started"] [data-task-id]')
    .all()
  if (!first || !second) throw new Error('need two cards')
  const firstTitle = (await first.getAttribute('aria-label')) ?? ''
  await first.click()
  await expect(panelTitle(page)).toHaveValue(firstTitle)

  // Board keyboard drag: Space picks up, Esc cancels — the panel stays.
  const id = await second.getAttribute('data-task-id')
  const statusBefore = await second.getAttribute('data-status')
  await pickUpWithKeyboard(page, second)
  await page.keyboard.press('ArrowRight')
  await expect(page.locator('.board-drag-overlay')).toBeVisible() // really dragging
  await page.keyboard.press('Escape')
  await page.waitForTimeout(250)
  await expect(panel(page)).toBeVisible()
  await expect(page.locator(`[data-task-id="${id}"]`).first()).toHaveAttribute(
    'data-status',
    statusBefore ?? '',
  )

  // Popover, menu and dialog each close alone.
  await page.getByRole('button', { name: 'Filter by tag' }).click()
  await expect(page.getByPlaceholder('Filter by tag…')).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.getByPlaceholder('Filter by tag…')).toHaveCount(0)
  await expect(panel(page)).toBeVisible()

  await page.getByRole('button', { name: 'Filter by priority' }).click()
  await expect(page.getByRole('menu')).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('menu')).toHaveCount(0)
  await expect(panel(page)).toBeVisible()

  await page.getByRole('button', { name: 'New task' }).click()
  await expect(page.getByTestId('new-task-dialog')).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.getByTestId('new-task-dialog')).toHaveCount(0)
  await expect(panel(page)).toBeVisible()

  // Timeline drag: Esc cancels the drag, the panel stays.
  await show(page, 'timeline')
  const offsite = (await listTasks(page)).find((t) => t.title === 'Plan team offsite logistics')
  if (!offsite) throw new Error('seed task missing')
  const bar = page.locator(`[data-testid="timeline-bar"][data-bar-id="${offsite.id}"]`)
  await bar.scrollIntoViewIfNeeded()
  const box = await bar.boundingBox()
  if (!box) throw new Error('bar not visible')
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await page.mouse.down()
  for (let i = 1; i <= 8; i++)
    await page.mouse.move(box.x + box.width / 2 + i * 10, box.y + box.height / 2)
  await expect(page.getByTestId('timeline-drag-label')).toBeVisible()
  await page.keyboard.press('Escape')
  await page.waitForTimeout(50)
  await page.mouse.up()
  await expect(panel(page)).toBeVisible()
  await expect(bar).toHaveAttribute('data-start', offsite.startDate ?? '')
  // Releasing the button after the cancel is not a click: the panel keeps the first task.
  await page.waitForTimeout(300)
  await expect(panelTitle(page)).toHaveValue(firstTitle)

  // Nothing else open: Esc closes the panel.
  await page.mouse.move(700, 600)
  await page.keyboard.press('Escape')
  await expect(panel(page)).toHaveCount(0)
})

test('sidebar tag and toolbar priority filters apply in every view; counts stay right', async () => {
  const { page } = await start(true)
  const counts = async (): Promise<string[]> =>
    page.locator('nav[aria-label="Views"] [data-view] .tabular-nums').allInnerTexts()
  const before = await counts()
  const tasks = await listTasks(page)
  const tags = await page.evaluate(() => (globalThis as unknown as W).api.tags.list())
  const work = tags.find((t) => t.name === 'work')
  if (!work) throw new Error('seed tag missing')

  await page.getByRole('region', { name: 'Tags' }).getByRole('button', { name: 'work' }).click()
  await page.getByRole('button', { name: 'Filter by priority' }).click()
  await page.getByRole('menuitemcheckbox', { name: /High$/ }).click()
  await page.getByRole('menuitemcheckbox', { name: /Medium$/ }).click()
  await page.keyboard.press('Escape')

  const allowed = new Set(
    tasks
      .filter((t) => t.tagIds.includes(work.id) && (t.priority === 3 || t.priority === 2))
      .map((t) => t.id),
  )
  for (const view of VIEWS) {
    await show(page, view)
    await page.waitForTimeout(150)
    const shown = await itemIds(page, view)
    expect(shown.length, `${view} shows something`).toBeGreaterThan(0)
    for (const id of shown) expect(allowed.has(id), `${view} shows only matching tasks`).toBe(true)
  }
  // Sidebar counts are the views' open-task totals, independent of the active filter.
  expect(await counts()).toEqual(before)
  await page.getByRole('button', { name: 'Clear filters' }).click()
  await show(page, 'list')
  await expect(page.getByRole('table', { name: 'Tasks' })).toHaveAttribute(
    'aria-rowcount',
    String(tasks.length),
  )
})

test('settings apply live: theme (incl. quick add), week start, tag recolour/rename', async () => {
  const { app, page } = await start(true)
  const qa = await windowByEntry(app, 'quick-add')
  const isDark = (p: Page) =>
    p.evaluate(() =>
      (
        globalThis as unknown as {
          document: { documentElement: { classList: { contains(c: string): boolean } } }
        }
      ).document.documentElement.classList.contains('dark'),
    )
  await page.evaluate(() => (globalThis as unknown as W).api.settings.set({ theme: 'dark' }))
  await expect.poll(() => isDark(page)).toBe(true)
  await expect.poll(() => isDark(qa)).toBe(true)
  await page.evaluate(() => (globalThis as unknown as W).api.settings.set({ theme: 'light' }))
  await expect.poll(() => isDark(qa)).toBe(false)

  await show(page, 'calendar')
  const firstHeader = page.getByTestId('calendar-view').locator('[data-weekday]').first()
  await expect(firstHeader).toHaveText(/mon/i)
  await page.evaluate(() => (globalThis as unknown as W).api.settings.set({ weekStartsOn: 0 }))
  await expect(firstHeader).toHaveText(/sun/i)

  // Week board: the two week starts disagree about exactly one stretch of days, and which
  // one depends on today. Monday to Saturday: a Sunday-start week ends this Saturday and a
  // Monday-start week ends the day after, so the coming Sunday is only in the Monday-start
  // week. On a Sunday it is the other way round: the Sunday-start week has just begun (it
  // runs to Saturday) while the Monday-start week ends today, so tomorrow is only in the
  // Sunday-start week.
  const weekday = new Date().getDay()
  const onSunday = weekday === 0
  const edge = onSunday ? addDays(today, 1) : addDays(today, 7 - weekday)
  const edgeItem = item(page, 'week', 'On the week edge')
  await createTask(page, { title: 'On the week edge', startDate: edge })
  await show(page, 'week')
  // Still weekStartsOn: 0 (Sunday) from above.
  if (onSunday) await expect(edgeItem).toBeVisible()
  else await expect(edgeItem).toHaveCount(0)
  await page.evaluate(() => (globalThis as unknown as W).api.settings.set({ weekStartsOn: 1 }))
  if (onSunday) await expect(edgeItem).toHaveCount(0)
  else await expect(edgeItem).toBeVisible()

  // Tags: recolour and rename reach cards live.
  const tags = await page.evaluate(() => (globalThis as unknown as W).api.tags.list())
  const work = tags.find((t) => t.name === 'work')
  if (!work) throw new Error('seed tag missing')
  await page.evaluate(
    (id) => (globalThis as unknown as W).api.tags.update(id, { name: 'job', color: 'violet' }),
    work.id,
  )
  await show(page, 'everything')
  const chip = page
    .locator('[data-testid="board-everything"] [class*="bg-tag-"]', { hasText: /^job$/ })
    .first()
  await expect(chip).toBeVisible()
  await expect(chip).toHaveClass(/bg-tag-violet/)
})

test('date rollover: boards, overdue colouring and today markers follow local midnight', async () => {
  const { page } = await start()
  await createTask(page, { title: 'Due today task', dueDate: today })
  // Install a fake clock just before midnight and reload so the renderer runs on it.
  const [y, m, d] = today.split('-').map(Number) as [number, number, number]
  await page.clock.install({ time: new Date(y, m - 1, d, 23, 59, 0) })
  await page.reload()
  await page.waitForSelector('[data-slot="view"]')
  await show(page, 'today')
  const card = item(page, 'today', 'Due today task')
  await expect(card).toContainText('Today')
  await show(page, 'calendar')
  await expect(page.locator('[data-testid="calendar-view"] [aria-current="date"]')).toHaveAttribute(
    'data-date',
    today,
  )

  await page.clock.fastForward('02:00') // past midnight + the 30 s check interval
  const tomorrow = addDays(today, 1)
  await expect(page.locator('[data-testid="calendar-view"] [aria-current="date"]')).toHaveAttribute(
    'data-date',
    tomorrow,
  )
  await show(page, 'timeline')
  await expect(page.getByTestId('timeline-today-line')).toHaveAttribute('data-date', tomorrow)
  await expect(item(page, 'timeline', 'Due today task')).toHaveAttribute('data-overdue', 'true')
  await show(page, 'today')
  await expect(card).toContainText('Yesterday')
})
