// Shell toolbar responsiveness (decision 3a): at every width, with the detail panel open or
// closed, in every view, no toolbar control is clipped or overlaps another.
import { expect, test, type Page } from '@playwright/test'
import type { Api } from '../src/shared/ipc'
import { launchApp, resizeMainWindow, type LaunchedApp } from './launch'

const VIEWS = ['today', 'week', 'everything', 'list', 'timeline', 'calendar'] as const
let launched: LaunchedApp

test.afterEach(async () => {
  await launched?.close()
})

// Runs in the renderer; plain JS because the e2e tsconfig has no DOM lib.
const TOOLBAR_PROBLEMS = `(() => {
  const header = document.querySelector('main > header')
  const hr = header.getBoundingClientRect()
  const problems = []
  if (header.scrollWidth > header.clientWidth + 1) problems.push('header scrolls horizontally')
  const controls = [...header.querySelectorAll('button, input, [data-testid="calendar-month-label"]')]
    .filter((el) => {
      const r = el.getBoundingClientRect()
      return r.width > 2 && r.height > 2 && getComputedStyle(el).visibility !== 'hidden'
    })
    .filter((el, _i, all) => !all.some((o) => o !== el && el.contains(o)))
  const name = (el) => el.getAttribute('aria-label') || (el.textContent || '').trim() || el.tagName
  const rects = controls.map((el) => el.getBoundingClientRect())
  controls.forEach((el, i) => {
    const r = rects[i]
    if (r.left < hr.left - 0.5 || r.right > hr.right + 0.5 || r.top < hr.top - 0.5 || r.bottom > hr.bottom + 0.5)
      problems.push(name(el) + ' outside the toolbar (' + Math.round(r.left) + '-' + Math.round(r.right) + ' of ' + Math.round(hr.left) + '-' + Math.round(hr.right) + ')')
    for (let j = i + 1; j < controls.length; j++) {
      const b = rects[j]
      if (Math.min(r.right, b.right) - Math.max(r.left, b.left) > 0.5 && Math.min(r.bottom, b.bottom) - Math.max(r.top, b.top) > 0.5)
        problems.push(name(el) + ' overlaps ' + name(controls[j]))
    }
  })
  return problems
})()`

/** Problems with the toolbar layout: controls outside the header or overlapping each other. */
async function toolbarProblems(page: Page): Promise<string[]> {
  return (await page.evaluate(TOOLBAR_PROBLEMS)) as string[]
}

async function setPanel(page: Page, open: boolean): Promise<void> {
  if (open) {
    await page.evaluate(async () => {
      const api = (globalThis as unknown as { api: Api }).api
      const [first] = await api.tasks.list()
      if (first) await api.app.showMainWindow(first.id)
    })
    await expect(page.getByTestId('task-detail')).toBeVisible()
  } else if (await page.getByTestId('task-detail').isVisible()) {
    await page.getByTestId('task-detail').getByRole('button', { name: 'Close' }).click()
    await expect(page.getByTestId('task-detail')).toHaveCount(0)
  }
}

test('toolbar never clips or overlaps (every view, 760–1400 px, panel open and closed)', async () => {
  test.setTimeout(180_000)
  launched = await launchApp({ seed: true })
  const { page, app } = launched
  // Active tag + priority filters, so the widest filter labels ("Tags · 1") and Clear show up.
  await page.getByRole('region', { name: 'Tags' }).getByRole('button', { name: 'work' }).click()
  await page.getByRole('button', { name: 'Filter by priority' }).click()
  await page.getByRole('menuitemcheckbox', { name: /High$/ }).click()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('button', { name: 'Clear filters' })).toBeVisible()
  const all: string[] = []
  for (const view of VIEWS) {
    await page.locator(`[data-view="${view}"]`).click()
    for (const panel of [false, true]) {
      await setPanel(page, panel)
      for (let width = 760; width <= 1400; width += 40) {
        await resizeMainWindow(app, width, 800)
        await page.waitForTimeout(60)
        for (const p of await toolbarProblems(page))
          all.push(`${view} ${width}px panel=${panel}: ${p}`)
      }
    }
  }
  expect(all).toEqual([])
})

test('collapsed search expands on click and Cmd/Ctrl+F, keeps its text', async () => {
  launched = await launchApp({ seed: true })
  const { page, app } = launched
  await resizeMainWindow(app, 900, 800)
  await setPanel(page, true)
  const input = page.getByRole('searchbox', { name: 'Search tasks' })
  await expect(input).toBeHidden()
  await page.locator('main > header').getByRole('button', { name: 'Search tasks' }).click()
  await expect(input).toBeVisible()
  await expect(input).toBeFocused()
  await input.fill('plumber')
  await page.getByTestId('task-detail').getByRole('textbox', { name: 'Title' }).click()
  await expect(input).toBeHidden()
  await page.keyboard.press('ControlOrMeta+f')
  await expect(input).toBeVisible()
  await expect(input).toHaveValue('plumber')
})
