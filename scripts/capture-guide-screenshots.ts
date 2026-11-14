// Regenerates every image in docs/screenshots/ for docs/USER_GUIDE.md.
//
//   npm run guide:screenshots
//
// Builds the app, launches it through Playwright `_electron` exactly like the e2e specs (temp
// userData dir + MARTIN_TODOS_E2E=1, so real data, real global shortcuts and login items are
// never touched), loads the guide's own demo dataset (below; every date is relative to today)
// and captures each shot. The folder is wiped first, so the result never depends on old files.
import { execFileSync } from 'node:child_process'
import { mkdirSync, readdirSync, rmSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test, type Locator, type Page } from '@playwright/test'
import { bulkCreateTasks, resizeMainWindow } from '../e2e/launch'
import { launchShell, MOD, openQuickAdd, tempUserData, type ShellApp } from '../e2e/shellHelpers'
import { addDays, startOfLocalDayMs, startOfWeek, todayLocal } from '../src/shared/dates'
import type * as Sqlite from 'node:sqlite'
import type { Api } from '../src/shared/ipc'
import type { LocalDate, Priority, Status, TagColor, Task } from '../src/shared/types'

const OUT = join(__dirname, '..', 'docs', 'screenshots')
const WIDTH = 1280
const HEIGHT = 800
/** A combination the fake shortcut registrar refuses, to show the "taken" warning. */
const TAKEN_SHORTCUT = 'Alt+Space'

// ---------------------------------------------------------------------------------------------
// Demo dataset: one person's working week of meeting follow-ups and small requests.
// ---------------------------------------------------------------------------------------------

const TAGS: Array<{ name: string; color: TagColor }> = [
  { name: 'meeting', color: 'violet' },
  { name: 'followup', color: 'amber' },
  { name: 'email', color: 'blue' },
  { name: 'ticket', color: 'orange' },
  { name: 'planning', color: 'teal' },
  { name: 'review', color: 'green' },
  { name: 'ops', color: 'slate' },
]

const RICH_TITLE = 'Design review follow-ups'
const RICH_DESCRIPTION = `Notes from the design review with Anna, Ben and Priya. The new settings layout is approved; the export flow needs one more pass before it goes to engineering.

| Owner | Follow-up | When |
| --- | --- | --- |
| Anna | Share the updated mockups | Thu |
| Ben | Check the export wording with support | Fri |
| Priya | Estimate the settings work | Next week |

- [x] Send the meeting notes
- [x] Book the follow-up review
- [ ] Collect feedback from support
- [ ] Update the project page

Slides and recording: [design review folder](https://example.com/design-review)`

interface DemoTask {
  title: string
  status?: Status
  priority?: Priority
  start?: LocalDate | null
  due?: LocalDate | null
  tags?: string[]
  description?: string
  /** Days before today the task was created. */
  createdDaysAgo: number
  /** Local date it was completed on (done tasks only). */
  completedOn?: LocalDate
}

/** Built fresh on every run, relative to today and the Monday-based week. */
function demoTasks(today: LocalDate): DemoTask[] {
  const d = (n: number): LocalDate => addDays(today, n)
  const week = startOfWeek(today, 1)
  const w = (n: number): LocalDate => addDays(week, n)
  const endOfWeek = w(6)
  const nextFriday = w(11)
  const busyDay = w(9) // next Wednesday: enough items for the calendar's "+N more"

  const open: DemoTask[] = [
    {
      title: RICH_TITLE,
      status: 'in_progress',
      priority: 3,
      start: d(-1),
      due: d(1),
      tags: ['meeting', 'planning'],
      description: RICH_DESCRIPTION,
      createdDaysAgo: 2,
    },
    {
      title: 'Reply to Anna about the Q1 roadmap draft',
      priority: 3,
      due: today,
      tags: ['email'],
      createdDaysAgo: 1,
    },
    {
      title: 'Review Priya’s pull request for the export fix',
      priority: 4,
      due: d(-1),
      tags: ['review'],
      createdDaysAgo: 3,
    },
    {
      title: 'File a ticket for the flaky login test',
      priority: 2,
      due: d(-2),
      tags: ['ticket'],
      createdDaysAgo: 4,
    },
    {
      title: 'Chase the invoice approval with Omar',
      priority: 3,
      due: d(-12),
      tags: ['followup'],
      createdDaysAgo: 20,
    },
    {
      title: 'Ask Ben about the vendor contract renewal',
      priority: 2,
      tags: ['followup'],
      createdDaysAgo: 1,
    },
    {
      title: 'Book a room for the planning session',
      priority: 1,
      tags: ['planning'],
      createdDaysAgo: 2,
    },
    {
      title: 'Send Sofia the updated headcount numbers',
      status: 'in_progress',
      priority: 2,
      due: today,
      tags: ['email'],
      createdDaysAgo: 3,
    },
    {
      title: 'Update the onboarding doc with the new VPN steps',
      status: 'in_progress',
      priority: 1,
      start: d(-3),
      due: d(2),
      tags: ['ops'],
      description: '- [x] Draft the steps\n- [ ] Add screenshots\n- [ ] Ask Tom to review',
      createdDaysAgo: 5,
    },
    {
      title: 'Get budget sign-off from Lena',
      status: 'blocked',
      priority: 3,
      start: d(-2),
      due: d(3),
      tags: ['planning'],
      description: 'Waiting for finance to confirm the Q1 numbers.',
      createdDaysAgo: 6,
    },
    {
      title: 'Staging dashboard access (waiting on Tom)',
      status: 'blocked',
      priority: 2,
      tags: ['ops'],
      createdDaysAgo: 4,
    },
    // Later this week: on This Week, not on Today.
    {
      title: 'Ask Jonas whether the release notes need a legal review',
      priority: 2,
      due: d(1),
      tags: ['followup'],
      createdDaysAgo: 1,
    },
    {
      title: 'Read the hiring committee packet',
      priority: 2,
      due: endOfWeek,
      tags: ['review'],
      createdDaysAgo: 2,
    },
    // Further out.
    {
      title: 'Submit the Q1 budget proposal',
      priority: 3,
      due: nextFriday,
      tags: ['planning'],
      createdDaysAgo: 5,
    },
    {
      title: 'Draft the Q1 hiring plan',
      priority: 3,
      start: w(7),
      due: w(11),
      tags: ['planning'],
      createdDaysAgo: 4,
    },
    {
      title: 'Send the sprint summary to the team',
      priority: 2,
      due: busyDay,
      tags: ['email'],
      createdDaysAgo: 2,
    },
    {
      title: 'Reply to the security questionnaire',
      priority: 3,
      due: busyDay,
      tags: ['email'],
      createdDaysAgo: 3,
    },
    {
      title: 'Ask Priya to demo the new export',
      priority: 2,
      due: busyDay,
      tags: ['followup'],
      createdDaysAgo: 1,
    },
    {
      title: 'File a ticket for the billing page typo',
      priority: 1,
      due: busyDay,
      tags: ['ticket'],
      createdDaysAgo: 2,
    },
    {
      title: 'Review the incident write-up',
      priority: 2,
      due: busyDay,
      tags: ['review'],
      createdDaysAgo: 2,
    },
    {
      // Start date only: cards show a muted "Starts <day>" badge.
      title: 'Start the Q1 OKR draft',
      priority: 2,
      start: endOfWeek,
      tags: ['planning'],
      createdDaysAgo: 1,
    },
    {
      title: 'Plan the team offsite agenda',
      priority: 2,
      start: w(14),
      due: w(16),
      tags: ['planning', 'meeting'],
      createdDaysAgo: 6,
    },
    {
      title: 'Renew the conference booking',
      priority: 1,
      due: d(20),
      tags: ['ops'],
      createdDaysAgo: 8,
    },
  ]

  const doneThisWeek: DemoTask[] = [
    { title: 'Send the agenda for the Monday sync', due: today, tags: ['meeting'], ago: 0 },
    { title: 'Reply to Jonas about the offsite dates', tags: ['email'], ago: 0 },
    { title: 'File a ticket for the broken CSV import', tags: ['ticket'], ago: 0 },
    { title: 'Share the slides from the all-hands', tags: ['meeting'], ago: 1 },
    { title: 'Ask Lena for the travel policy link', tags: ['followup'], ago: 2 },
    { title: 'Review the onboarding checklist with Ben', tags: ['review'], ago: 3 },
    { title: 'Order a replacement laptop charger', tags: ['ops'], ago: 4 },
  ].map(({ ago, ...t }) => ({
    ...t,
    status: 'done' as const,
    priority: 2 as const,
    completedOn: d(-ago),
    createdDaysAgo: ago + 2,
  }))

  // Older history, so Everything's Done column pages ("Show more").
  const verbs = [
    'Reply to {n} about the {x} report',
    'File a ticket for the {x} bug {n} found',
    'Ask {n} about the {x} numbers',
    'Send {n} the notes from the {x} sync',
    'Review {n}’s {x} proposal',
    'Book time with {n} for the {x} review',
  ]
  const names = ['Anna', 'Ben', 'Priya', 'Tom', 'Lena', 'Omar', 'Sofia', 'Jonas']
  const topics = ['billing', 'search', 'reporting', 'onboarding', 'pricing', 'support', 'mobile']
  const tagFor = ['email', 'ticket', 'followup', 'meeting', 'review', 'planning']
  const history: DemoTask[] = Array.from({ length: 60 }, (_, i) => {
    const v = i % verbs.length
    const ago = 6 + Math.floor(i * 1.2)
    return {
      title: (verbs[v] ?? '')
        .replace('{n}', names[i % names.length] ?? '')
        .replace('{x}', topics[(i * 3) % topics.length] ?? ''),
      status: 'done',
      priority: ((i % 3) + 1) as Priority,
      tags: [tagFor[v] ?? 'email'],
      completedOn: d(-ago),
      createdDaysAgo: ago + 1 + (i % 4),
    }
  })

  return [...open, ...doneThisWeek, ...history]
}

// ---------------------------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------------------------

/**
 * The guide shows the app as users get it: drop the " · development" suffix from the Settings
 * footer (this script runs an unpackaged build). Only the screenshots' page is touched — a
 * watcher in the renderer blanks that text node whenever the dialog renders it.
 */
const HIDE_DEV_SUFFIX = `(() => {
  const strip = () => {
    const about = document.querySelector('[data-testid="about"]')
    if (!about) return
    const walker = document.createTreeWalker(about, NodeFilter.SHOW_TEXT)
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      if (n.data === ' · development') n.data = ''
    }
  }
  new MutationObserver(strip).observe(document.body, { childList: true, subtree: true })
  strip()
})()`

/** Drops focus in the page (runs in the renderer, so no DOM types needed here). */
function blurActive(): void {
  const doc = (globalThis as unknown as { document: { activeElement: { blur?(): void } | null } })
    .document
  doc.activeElement?.blur?.()
}

/** Mouse to an inert spot (empty sidebar below the tags), focus dropped, animations finished. */
async function settle(page: Page, ms = 450): Promise<void> {
  await page.mouse.move(100, 640)
  await page.evaluate(blurActive)
  await page.waitForTimeout(ms)
}

async function full(page: Page, name: string): Promise<void> {
  await page.screenshot({ path: join(OUT, name) })
}

/** Screenshot of the union of the elements' boxes plus padding, kept inside the window. */
async function crop(page: Page, targets: Locator[], name: string, pad = 12): Promise<void> {
  const boxes = []
  for (const t of targets) {
    const b = await t.boundingBox()
    if (!b) throw new Error(`crop ${name}: element not visible`)
    boxes.push(b)
  }
  const [vw, vh] = await page.evaluate(() => {
    const w = globalThis as unknown as { innerWidth: number; innerHeight: number }
    return [w.innerWidth, w.innerHeight]
  })
  const x0 = Math.max(0, Math.min(...boxes.map((b) => b.x)) - pad)
  const y0 = Math.max(0, Math.min(...boxes.map((b) => b.y)) - pad)
  const x1 = Math.min(vw ?? WIDTH, Math.max(...boxes.map((b) => b.x + b.width)) + pad)
  const y1 = Math.min(vh ?? HEIGHT, Math.max(...boxes.map((b) => b.y + b.height)) + pad)
  await page.screenshot({
    path: join(OUT, name),
    clip: { x: x0, y: y0, width: x1 - x0, height: y1 - y0 },
  })
}

const card = (page: Page, title: string): Locator =>
  page.locator('[data-task-id]', { hasText: title }).first()

async function view(page: Page, id: string): Promise<void> {
  await page.locator(`nav[aria-label="Views"] [data-view="${id}"]`).click()
  await expect(page.locator(`[data-view="${id}"][aria-current="page"]`)).toBeVisible()
}

/** Loads the demo dataset into a fresh userData dir and returns it (app closed again). */
async function prepareUserData(): Promise<string> {
  const userData = tempUserData()
  const shell = await launchShell({ userData })
  const { page } = shell
  const today = await page.evaluate(() => {
    const n = new Date()
    return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, '0')}-${String(n.getDate()).padStart(2, '0')}`
  })
  if (today !== todayLocal()) throw new Error('renderer and script disagree about today')

  await page.evaluate((s) => (globalThis as unknown as { api: Api }).api.settings.set(s), {
    theme: 'light' as const,
    weekStartsOn: 1 as const,
    boardSort: { today: 'priority', week: 'priority', everything: 'priority' } as const,
    lastView: 'today' as const,
  })
  const tagIds: Record<string, string> = {}
  for (const tag of TAGS) {
    const created = await page.evaluate(
      (t) => (globalThis as unknown as { api: Api }).api.tags.create(t),
      tag,
    )
    tagIds[tag.name] = created.id
  }

  const tasks = demoTasks(today)
  if (new Set(tasks.map((t) => t.title)).size !== tasks.length) throw new Error('duplicate titles')
  await bulkCreateTasks(
    shell,
    tasks.map((t) => ({
      title: t.title,
      description: t.description ?? '',
      status: t.status ?? 'not_started',
      priority: t.priority ?? 2,
      startDate: t.start ?? null,
      dueDate: t.due ?? null,
      tagIds: (t.tags ?? []).map((n) => {
        const id = tagIds[n]
        if (!id) throw new Error(`unknown tag ${n}`)
        return id
      }),
    })),
  )
  const stored = await page.evaluate(() => (globalThis as unknown as { api: Api }).api.tasks.list())
  await shell.close({ keepUserData: true })

  // Back-date created/completed times (the API stamps "now"), straight in the closed DB.
  const now = Date.now()
  // Loaded at runtime: Playwright's TS loader cannot import `node:sqlite` statically.
  const { DatabaseSync } = process.getBuiltinModule('node:sqlite') as typeof Sqlite
  const db = new DatabaseSync(join(userData, 'data', 'todos.db'))
  const update = db.prepare(
    'UPDATE tasks SET created_at = ?, updated_at = ?, completed_at = ? WHERE id = ?',
  )
  const byTitle = new Map<string, Task>(stored.map((t) => [t.title, t]))
  tasks.forEach((t, i) => {
    const row = byTitle.get(t.title)
    if (!row) throw new Error(`task not stored: ${t.title}`)
    let completedAt: number | null = null
    if (t.completedOn) {
      const dayStart = startOfLocalDayMs(t.completedOn)
      // Today's completions: a little before now, but never before midnight.
      completedAt =
        t.completedOn === today
          ? Math.max(dayStart + 60_000, now - (i + 1) * 40 * 60_000)
          : dayStart + (10 + (i % 7)) * 3_600_000
    }
    const createdAt = Math.min(
      now - 60_000,
      startOfLocalDayMs(addDays(today, -t.createdDaysAgo)) + (9 + (i % 8)) * 3_600_000,
    )
    const created = Math.min(createdAt, completedAt ?? createdAt)
    update.run(created, Math.max(created, completedAt ?? created), completedAt, row.id)
  })
  db.close()
  return userData
}

// ---------------------------------------------------------------------------------------------
// Capture
// ---------------------------------------------------------------------------------------------

let shell: ShellApp | undefined

test.afterEach(async () => {
  await shell?.close()
})

test('user guide screenshots', async () => {
  rmSync(OUT, { recursive: true, force: true })
  mkdirSync(OUT, { recursive: true })

  const userData = await prepareUserData()
  shell = await launchShell({
    userData,
    env: { MARTIN_TODOS_FAKE_TAKEN_SHORTCUTS: TAKEN_SHORTCUT },
  })
  const { app, page } = shell
  await page.evaluate(HIDE_DEV_SUFFIX)
  await resizeMainWindow(app, WIDTH, HEIGHT)
  await page.waitForTimeout(300)
  await expect(page.locator('[data-testid="board-today"] [data-task-id]').first()).toBeVisible()

  // --- Today board, overview with the detail panel, single card, sort control
  await settle(page)
  await full(page, 'today-board.png')
  await crop(page, [card(page, RICH_TITLE)], 'board-card.png', 10)
  await crop(page, [page.locator('[data-slot="toolbar-controls"]')], 'board-sort-control.png', 8)

  await card(page, RICH_TITLE).click()
  const detail = page.getByTestId('task-detail')
  await expect(detail).toBeVisible()
  await settle(page, 600)
  await full(page, 'window-overview.png')
  await crop(page, [detail], 'detail-panel.png', 0)
  await page.getByRole('button', { name: 'Close' }).click()
  await expect(detail).toBeHidden()

  // --- Mid-drag: Not Started → In Progress (cancelled with Esc, nothing changes)
  {
    const source = card(page, 'Ask Ben about the vendor contract renewal')
    const target = page.locator('[data-testid="board-today"] [data-column="in_progress"]')
    const s = await source.boundingBox()
    const t = await target.boundingBox()
    if (!s || !t) throw new Error('drag: not visible')
    await page.mouse.move(s.x + s.width / 2, s.y + s.height / 2)
    await page.mouse.down()
    await page.mouse.move(s.x + s.width / 2 + 8, s.y + s.height / 2 + 8, { steps: 4 })
    await page.mouse.move(t.x + t.width / 2, t.y + 190, { steps: 20 })
    await page.waitForTimeout(150)
    await page.mouse.move(t.x + t.width / 2 + 1, t.y + 191, { steps: 2 })
    await page.waitForTimeout(300)
    await full(page, 'board-drag.png')
    await page.keyboard.press('Escape')
    await page.mouse.up()
    await page.waitForTimeout(400)
    await expect(
      page.locator('[data-column="not_started"]').getByText('Ask Ben about the vendor'),
    ).toBeVisible()
  }

  // --- Context menu with the Due date submenu open
  {
    const target = card(page, 'File a ticket for the flaky login test')
    await target.click({ button: 'right' })
    await page.getByRole('menuitem', { name: 'Due date' }).hover()
    await page.waitForTimeout(400)
    const menus = page.locator('[role="menu"]')
    await expect(menus).toHaveCount(2)
    await crop(page, [target, menus.nth(0), menus.nth(1)], 'context-menu.png', 10)
    await page.keyboard.press('Escape')
    await page.keyboard.press('Escape')
    await expect(menus).toHaveCount(0)
  }

  // --- In-app new-task dialog
  await settle(page, 200)
  await page.keyboard.press(`${MOD}+n`)
  const dialog = page.getByTestId('new-task-dialog')
  await expect(dialog).toBeVisible()
  await dialog
    .getByRole('textbox', { name: 'Task title' })
    .fill('Prepare the agenda for the retro #meeting @tomorrow')
  await page.mouse.move(100, 640)
  await page.waitForTimeout(400)
  await crop(page, [dialog], 'new-task-dialog.png', 16)
  await page.keyboard.press('Escape')
  await expect(dialog).toBeHidden()

  // --- Quick-add popup (its own window)
  {
    const qa = await openQuickAdd(app)
    await qa.waitForTimeout(400)
    await qa.screenshot({ path: join(OUT, 'quick-add-empty.png') })
    await qa
      .getByRole('textbox', { name: 'Task title' })
      .fill('Ask Omar about the vendor shortlist #followup #planning !high @fri')
    await qa.waitForTimeout(400)
    await qa.screenshot({ path: join(OUT, 'quick-add-tokens.png') })
    await qa.keyboard.press('Escape')
    await page.bringToFront()
  }

  // --- This Week, Everything
  await view(page, 'week')
  await settle(page)
  await full(page, 'week-board.png')

  // --- Filter bar: one tag + two priorities, on This Week
  await page.getByRole('button', { name: 'Filter by tag' }).click()
  await page.getByRole('option', { name: 'followup' }).click()
  await page.keyboard.press('Escape')
  await page.getByRole('button', { name: 'Filter by priority' }).click()
  await page.getByRole('menuitemcheckbox', { name: 'High' }).click()
  await page.getByRole('menuitemcheckbox', { name: 'Medium' }).click()
  await page.keyboard.press('Escape')
  await page.waitForTimeout(400) // focus returns to the trigger after the menu animates out
  await settle(page)
  await full(page, 'filter-bar.png')
  await page.getByRole('button', { name: 'Clear filters' }).click()

  await view(page, 'everything')
  await page
    .locator('[data-testid="board-everything"] [data-testid="column-done"]')
    .evaluate((el) => (el.scrollTop = el.scrollHeight))
  await expect(page.getByRole('button', { name: /^Show \d+ more/ })).toBeVisible()
  await settle(page)
  await full(page, 'everything-board.png')

  // --- List grouped by status
  await view(page, 'list')
  await page.getByRole('button', { name: /^Group by/ }).click()
  await page.getByRole('menuitemradio', { name: 'Status' }).click()
  // Focus returns to the Group button once the menu has animated out; drop it after that.
  await page.waitForTimeout(400)
  await settle(page)
  await full(page, 'list-grouped.png')

  // --- Timeline at Week zoom
  await view(page, 'timeline')
  await page.locator('[data-zoom="week"]').click()
  await page.getByRole('button', { name: 'Scroll to today' }).click()
  await settle(page, 700)
  await full(page, 'timeline-week.png')

  // --- Calendar month
  await view(page, 'calendar')
  await settle(page)
  await full(page, 'calendar-month.png')

  // --- Settings
  await page.keyboard.press(`${MOD}+,`)
  const settings = page.getByTestId('settings-dialog')
  await expect(settings).toBeVisible()

  await expect(settings.getByTestId('about')).not.toContainText('development')
  await settings.locator('[data-section="shortcuts"]').click()
  // Record a new Show / hide shortcut that "another app" already owns, the way a user would.
  await settings.getByRole('button', { name: 'Show / hide window shortcut' }).click()
  await page.keyboard.press('Alt+Space')
  await expect(settings.getByRole('alert')).toContainText('Already in use')
  // And catch the Quick add recorder while it listens, with ⌥⇧ held.
  await settings.getByRole('button', { name: 'Quick add shortcut' }).click()
  await page.keyboard.down('Alt')
  await page.keyboard.down('Shift')
  await page.waitForTimeout(300)
  await crop(page, [settings.getByTestId('shortcut-quickAdd')], 'shortcut-recorder.png', 4)
  await page.keyboard.up('Shift')
  await page.keyboard.up('Alt')
  await page.keyboard.press('Escape') // cancels the recording, not the dialog
  await expect(settings).toBeVisible()
  await page.evaluate(blurActive)
  await page.mouse.move(5, HEIGHT - 5)
  await page.waitForTimeout(300)
  await crop(page, [settings], 'settings-shortcuts.png', 0)
  await settings.getByRole('button', { name: 'Reset Show / hide window to default' }).click()

  await settings.locator('[data-section="tags"]').click()
  await page.mouse.move(5, HEIGHT - 5)
  await page.waitForTimeout(300)
  await crop(page, [settings], 'settings-tags.png', 0)

  await settings.locator('[data-section="data"]').click()
  await expect(settings.getByTestId('last-backup')).toContainText('Last backup', {
    timeout: 15_000,
  })
  await page.mouse.move(5, HEIGHT - 5)
  await page.waitForTimeout(300)
  await crop(page, [settings], 'settings-data.png', 0)
  await page.keyboard.press('Escape')
  await expect(settings).toBeHidden()

  // --- The one dark-theme shot
  await page.evaluate(() =>
    (globalThis as unknown as { api: Api }).api.settings.set({ theme: 'dark' }),
  )
  await view(page, 'today')
  await settle(page, 600)
  await full(page, 'today-board-dark.png')
  await page.evaluate(() =>
    (globalThis as unknown as { api: Api }).api.settings.set({ theme: 'light' }),
  )

  // Retina captures are 2x; halve anything wider than the window so the folder stays small.
  if (process.platform === 'darwin') {
    for (const f of readdirSync(OUT)) {
      const path = join(OUT, f)
      const width = Number(
        /pixelWidth: (\d+)/.exec(execFileSync('sips', ['-g', 'pixelWidth', path]).toString())?.[1],
      )
      if (width > WIDTH * 1.5) execFileSync('sips', ['--resampleWidth', String(width / 2), path])
    }
  }
  const total = readdirSync(OUT).reduce((n, f) => n + statSync(join(OUT, f)).size, 0)
  console.log(`docs/screenshots: ${readdirSync(OUT).length} files, ${(total / 1e6).toFixed(2)} MB`)
})
