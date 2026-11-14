// Board (Kanban) e2e: drag between columns, manual reorder, inline add with tokens, sort
// persistence. Also captures board screenshots into e2e/screenshots/ (gitignored).
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test, type Locator, type Page } from '@playwright/test'
import type { Api } from '../src/shared/ipc'
import { launchApp, resizeMainWindow, type LaunchedApp } from './launch'

const OUT = join(__dirname, 'screenshots')
let launched: LaunchedApp

test.afterEach(async () => {
  await launched?.close()
})

const column = (page: Page, status: string): Locator =>
  page.locator(`[data-testid="board-today"] [data-testid="column-${status}"]`)
const cards = (page: Page, status: string): Locator =>
  column(page, status).locator('[data-task-id]')

async function ids(list: Locator): Promise<string[]> {
  return list.evaluateAll((els) => els.map((e) => e.getAttribute('data-task-id') ?? ''))
}

/** Pointer drag with intermediate moves so dnd-kit's activation distance and collisions run. */
async function drag(
  page: Page,
  source: Locator,
  target: Locator,
  where: 'top' | 'center' | 'bottom' = 'center',
  hold?: () => Promise<unknown>,
): Promise<void> {
  const s = await source.boundingBox()
  const t = await target.boundingBox()
  if (!s || !t) throw new Error('drag: element not visible')
  const sx = s.x + s.width / 2
  const sy = s.y + s.height / 2
  const ty =
    where === 'top' ? t.y + 4 : where === 'bottom' ? t.y + t.height - 4 : t.y + t.height / 2
  await page.mouse.move(sx, sy)
  await page.mouse.down()
  await page.mouse.move(sx + 8, sy + 8, { steps: 4 })
  await page.mouse.move(t.x + t.width / 2, ty, { steps: 20 })
  await page.waitForTimeout(150)
  await page.mouse.move(t.x + t.width / 2, ty + 1, { steps: 2 })
  if (hold) await hold()
  await page.mouse.up()
  await page.waitForTimeout(250)
}

async function setSize(l: LaunchedApp): Promise<void> {
  await resizeMainWindow(l.app, 1400, 860)
}

async function ready(page: Page): Promise<void> {
  await expect(page.locator('[data-testid="board-today"] [data-task-id]').first()).toBeVisible()
}

test('drag a card from Not Started to In Progress persists after reload', async () => {
  launched = await launchApp({ seed: true })
  const { page } = launched
  await setSize(launched)
  await ready(page)

  const card = cards(page, 'not_started').first()
  const id = await card.getAttribute('data-task-id')
  await drag(page, card, column(page, 'in_progress'))

  await expect(column(page, 'in_progress').locator(`[data-task-id="${id}"]`)).toBeVisible()
  await expect(column(page, 'not_started').locator(`[data-task-id="${id}"]`)).toHaveCount(0)

  await page.reload()
  await ready(page)
  await expect(column(page, 'in_progress').locator(`[data-task-id="${id}"]`)).toBeVisible()
  const task = await page.evaluate(
    async (taskId) =>
      (await (globalThis as unknown as { api: Api }).api.tasks.list()).find((t) => t.id === taskId),
    id,
  )
  expect(task?.status).toBe('in_progress')
})

test('drag into an empty column works', async () => {
  launched = await launchApp({ seed: true })
  const { page } = launched
  await setSize(launched)
  await ready(page)
  // Empty the Blocked column first, via the API.
  await page.evaluate(async () => {
    const api = (globalThis as unknown as { api: Api }).api
    for (const t of await api.tasks.list()) {
      if (t.status === 'blocked') await api.tasks.update(t.id, { status: 'not_started' })
    }
  })
  await expect(cards(page, 'blocked')).toHaveCount(0)
  const card = cards(page, 'in_progress').first()
  const id = await card.getAttribute('data-task-id')
  await drag(page, card, column(page, 'blocked'))
  await expect(column(page, 'blocked').locator(`[data-task-id="${id}"]`)).toBeVisible()
})

test('reorders within a column in Manual sort', async () => {
  launched = await launchApp({ seed: true })
  const { page } = launched
  await setSize(launched)
  await ready(page)

  await page.getByRole('radio', { name: 'Manual' }).click()
  await expect(page.getByTestId('board-today')).toHaveAttribute('data-sort', 'manual')

  const before = await ids(cards(page, 'not_started'))
  expect(before.length).toBeGreaterThanOrEqual(3)
  // Drag the first card below the third.
  await drag(page, cards(page, 'not_started').nth(0), cards(page, 'not_started').nth(2), 'bottom')
  const expected = [before[1], before[2], before[0], ...before.slice(3)]
  await expect.poll(() => ids(cards(page, 'not_started'))).toEqual(expected)

  await page.reload()
  await ready(page)
  await expect.poll(() => ids(cards(page, 'not_started'))).toEqual(expected)

  // Cross-column drop lands at the dropped position: above In Progress's first card.
  const moving = expected[0] as string
  const target = await ids(cards(page, 'in_progress'))
  await drag(page, cards(page, 'not_started').first(), cards(page, 'in_progress').first(), 'top')
  await expect.poll(() => ids(cards(page, 'in_progress'))).toEqual([moving, ...target])
})

/** Drags `source` and drops it at a viewport point (not necessarily over a droppable). */
async function dragToPoint(page: Page, source: Locator, x: number, y: number): Promise<void> {
  const s = await source.boundingBox()
  if (!s) throw new Error('drag: source not visible')
  const sx = s.x + s.width / 2
  const sy = s.y + s.height / 2
  await page.mouse.move(sx, sy)
  await page.mouse.down()
  await page.mouse.move(sx + 8, sy + 8, { steps: 4 })
  await page.mouse.move(x, y, { steps: 20 })
  await page.waitForTimeout(150)
  await page.mouse.move(x, y + 1, { steps: 2 })
  await page.mouse.up()
  await page.waitForTimeout(250)
}

/** The x of the middle of the gutter between two columns, nudged towards the right one. */
async function gutterX(page: Page, left: string, right: string, nudge: number): Promise<number> {
  const l = await page.locator(`[data-testid="board-today"] [data-column="${left}"]`).boundingBox()
  const r = await page.locator(`[data-testid="board-today"] [data-column="${right}"]`).boundingBox()
  if (!l || !r) throw new Error('columns not visible')
  const gap = r.x - (l.x + l.width)
  expect(gap).toBeGreaterThan(4)
  return l.x + l.width + gap / 2 + nudge
}

test('a drop in the gutter between columns lands in the nearest column (and slot in Manual)', async () => {
  launched = await launchApp({ seed: true })
  const { page } = launched
  await setSize(launched)
  await ready(page)

  // Sorted board: the card moves into the column nearest to the drop point.
  const card = cards(page, 'not_started').first()
  const id = (await card.getAttribute('data-task-id')) as string
  const target = await column(page, 'in_progress').boundingBox()
  if (!target) throw new Error('column not visible')
  const x = await gutterX(page, 'in_progress', 'blocked', -2) // a hair closer to In Progress
  await dragToPoint(page, card, x, target.y + 40)
  await expect(column(page, 'in_progress').locator(`[data-task-id="${id}"]`)).toBeVisible()

  // Manual: the nearest slot in the nearest column.
  await page.getByRole('radio', { name: 'Manual' }).click()
  await expect(page.getByTestId('board-today')).toHaveAttribute('data-sort', 'manual')
  const inProgress = await ids(cards(page, 'in_progress'))
  expect(inProgress.length).toBeGreaterThanOrEqual(2)
  const second = await cards(page, 'in_progress').nth(1).boundingBox()
  if (!second) throw new Error('card not visible')
  const moving = (await cards(page, 'not_started').first().getAttribute('data-task-id')) as string
  const xLeft = await gutterX(page, 'not_started', 'in_progress', 2) // closer to In Progress
  await dragToPoint(page, cards(page, 'not_started').first(), xLeft, second.y + 4)
  await expect
    .poll(() => ids(cards(page, 'in_progress')))
    .toEqual([inProgress[0], moving, ...inProgress.slice(1)])
})

test("the first card's selection ring is not clipped by the column's scroll area", async () => {
  launched = await launchApp({ seed: true })
  const { page } = launched
  await setSize(launched)
  await ready(page)

  // The ring is a 2px box-shadow outside the card; the scroll container clips at its
  // padding edge, so the first card must sit at least that far below the container's top.
  const RING = 2
  for (const status of ['not_started', 'in_progress', 'blocked', 'done']) {
    const first = cards(page, status).first()
    if ((await first.count()) === 0) continue
    const gap = await first.evaluate((el) => {
      const scroller = el.closest('[data-testid^="column-"]')
      if (!scroller) throw new Error('card is not inside a column scroll area')
      return el.getBoundingClientRect().top - scroller.getBoundingClientRect().top
    })
    expect(gap, `headroom above the first ${status} card`).toBeGreaterThanOrEqual(RING)
  }

  await cards(page, 'not_started').first().click()
  await page.waitForTimeout(200)
  mkdirSync(OUT, { recursive: true })
  await column(page, 'not_started').screenshot({ path: join(OUT, 'board-first-card-ring.png') })
})

test('"+ Add task" keeps the same height when it opens (no column jump)', async () => {
  launched = await launchApp({ seed: true })
  const { page } = launched
  await setSize(launched)
  await ready(page)
  const button = page.getByRole('button', { name: 'Add task' })
  const closed = await button.boundingBox()
  const firstCard = await cards(page, 'not_started').first().boundingBox()
  await button.click()
  const input = page.getByRole('textbox', { name: 'New task title' })
  await expect(input).toBeFocused()
  // The input's frame (border included) occupies exactly the button's height.
  const frame = await input.evaluate((el) => {
    const r = (
      el.parentElement as unknown as { getBoundingClientRect(): { height: number } }
    ).getBoundingClientRect()
    return r.height
  })
  expect(frame).toBe(closed?.height)
  const firstCardOpen = await cards(page, 'not_started').first().boundingBox()
  expect(firstCardOpen?.y).toBe(firstCard?.y)
})

test('inline add parses tokens; input stays open for the next task', async () => {
  launched = await launchApp({ seed: true })
  const { page } = launched
  await setSize(launched)
  await ready(page)

  await page.getByRole('button', { name: 'Add task' }).click()
  const input = page.getByRole('textbox', { name: 'New task title' })
  await expect(input).toBeFocused()
  await input.fill('Inline added task #boardtag !high')
  await input.press('Enter')

  const card = column(page, 'not_started').locator('[data-task-id]', {
    hasText: 'Inline added task',
  })
  await expect(card).toBeVisible()
  await expect(card).toContainText('boardtag')
  await expect(card).not.toContainText('!high')
  await expect(card.getByLabel('High priority')).toBeVisible()
  // Still open and empty for the next one.
  await expect(input).toBeFocused()
  await expect(input).toHaveValue('')

  await input.fill('Second inline task')
  await input.press('Enter')
  await expect(
    column(page, 'not_started').locator('[data-task-id]', { hasText: 'Second inline task' }),
  ).toBeVisible()
  await input.press('Escape')
  await expect(input).toHaveCount(0)

  // The created card is real (not a temp id) and clicking it opens the detail panel.
  await expect(card).not.toHaveAttribute('data-task-id', /^tmp-/)
  await card.click()
  await expect(page.getByTestId('task-detail')).toBeVisible()
  await expect(card).toHaveAttribute('data-selected', 'true')
})

test('keyboard: Space picks up, arrows move, Space drops', async () => {
  launched = await launchApp({ seed: true })
  const { page } = launched
  await setSize(launched)
  await ready(page)

  const card = cards(page, 'not_started').first()
  const id = await card.getAttribute('data-task-id')
  await card.focus()
  await page.keyboard.press('Space')
  await page.waitForTimeout(150)
  await page.keyboard.press('ArrowRight')
  await page.waitForTimeout(250)
  await page.keyboard.press('Space')
  await expect(column(page, 'in_progress').locator(`[data-task-id="${id}"]`)).toBeVisible()
})

test('sort selection persists per board', async () => {
  launched = await launchApp({ seed: true })
  const { page } = launched
  await setSize(launched)
  await ready(page)

  await expect(page.getByRole('radio', { name: 'Priority' })).toHaveAttribute('data-state', 'on')
  await page.getByRole('radio', { name: 'Due' }).click()
  await expect(page.getByTestId('board-today')).toHaveAttribute('data-sort', 'due')

  await page.reload()
  await ready(page)
  await expect(page.getByRole('radio', { name: 'Due' })).toHaveAttribute('data-state', 'on')
  const settings = await page.evaluate(() =>
    (globalThis as unknown as { api: Api }).api.settings.get(),
  )
  expect(settings.boardSort).toMatchObject({ today: 'due', week: 'priority' })

  // Other boards keep their own value.
  await page.locator('[data-view="week"]').click()
  await expect(page.getByTestId('board-week')).toHaveAttribute('data-sort', 'priority')
})

test('board screenshots (light + dark)', async () => {
  mkdirSync(OUT, { recursive: true })
  launched = await launchApp({ seed: true })
  const { page } = launched
  await setSize(launched)
  await ready(page)

  await page.screenshot({ path: join(OUT, 'board-today-light.png') })

  // Mid-drag: overlay + drop target highlight.
  await drag(page, cards(page, 'not_started').nth(1), column(page, 'blocked'), 'center', () =>
    page.screenshot({ path: join(OUT, 'board-drag-light.png') }),
  )

  // Manual sort: the drop slot opens at the hovered position in the target column.
  await page.getByRole('radio', { name: 'Manual' }).click()
  await drag(
    page,
    cards(page, 'not_started').nth(2),
    cards(page, 'in_progress').nth(1),
    'top',
    () => page.screenshot({ path: join(OUT, 'board-drag-manual-light.png') }),
  )
  await page.getByRole('radio', { name: 'Priority' }).click()

  await page.getByRole('button', { name: 'Add task' }).click()
  await page.getByRole('textbox', { name: 'New task title' }).fill('Follow up with #work !high')
  await page.screenshot({ path: join(OUT, 'board-inline-add-light.png') })
  await page.keyboard.press('Escape')

  await page.locator('[data-task-id]', { hasText: 'Q4 planning follow-ups' }).first().click()
  await expect(page.getByTestId('task-detail')).toBeVisible()
  await page.waitForTimeout(300)
  await page.screenshot({ path: join(OUT, 'board-detail-light.png') })
  await page.keyboard.press('Escape')

  await page.locator('[data-view="everything"]').click()
  await page.screenshot({ path: join(OUT, 'board-everything-light.png') })

  await page.evaluate(() =>
    (globalThis as unknown as { api: Api }).api.settings.set({ theme: 'dark' }),
  )
  await page.locator('[data-view="today"]').click()
  await page.waitForTimeout(200)
  await page.screenshot({ path: join(OUT, 'board-today-dark.png') })
  await drag(page, cards(page, 'in_progress').first(), column(page, 'done'), 'center', () =>
    page.screenshot({ path: join(OUT, 'board-drag-dark.png') }),
  )
  await page.locator('[data-task-id]', { hasText: 'Q4 planning follow-ups' }).first().click()
  await page.waitForTimeout(300)
  await page.screenshot({ path: join(OUT, 'board-detail-dark.png') })
  await page.keyboard.press('Escape')

  await page.getByRole('searchbox', { name: 'Search tasks' }).fill('zzzz-no-match')
  await expect(page.getByRole('button', { name: 'Clear filters' }).last()).toBeVisible()
  await page.screenshot({ path: join(OUT, 'board-filtered-empty-dark.png') })
})
