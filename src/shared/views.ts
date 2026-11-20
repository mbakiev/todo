// View filter and sort logic. Pure functions of (tasks, today, settings); unit-tested.
// Components must not re-implement any of these rules.

import { STATUSES, TIMELINE_MAX_LOOKBACK_DAYS } from './constants'
import {
  addDays,
  endOfWeek,
  formatElapsed,
  formatShortDate,
  localDateOfTimestamp,
  maxDate,
  minDate,
  startOfWeek,
} from './dates'
import { effectiveStartedAt } from './lifecycle'
import { compareByPosition } from './ordering'
import type { BoardScope, BoardSort, LocalDate, Priority, Settings, Status, Task } from './types'

/** Only the settings fields views depend on, so callers can pass a partial object in tests. */
export type ViewSettings = Pick<Settings, 'weekStartsOn'>

// ---------------------------------------------------------------------------
// Predicates
// ---------------------------------------------------------------------------

/** `startDate ?? dueDate`. */
export function anchor(task: Pick<Task, 'startDate' | 'dueDate'>): LocalDate | null {
  return task.startDate ?? task.dueDate
}

export function isOpen(task: Pick<Task, 'status'>): boolean {
  return task.status !== 'done'
}

export function hasAnyDate(task: Pick<Task, 'startDate' | 'dueDate'>): boolean {
  return task.startDate !== null || task.dueDate !== null
}

/** Open and `dueDate < today`. */
export function isOverdue(task: Pick<Task, 'status' | 'dueDate'>, today: LocalDate): boolean {
  return isOpen(task) && task.dueDate !== null && task.dueDate < today
}

/** Open and due exactly today. */
export function isDueToday(task: Pick<Task, 'status' | 'dueDate'>, today: LocalDate): boolean {
  return isOpen(task) && task.dueDate === today
}

/** Local calendar date the task was completed on, or null. */
export function completedOn(task: Pick<Task, 'completedAt'>): LocalDate | null {
  return task.completedAt === null ? null : localDateOfTimestamp(task.completedAt)
}

/**
 * Local calendar date the task actually started on (via `effectiveStartedAt`, so legacy rows
 * without `startedAt` still get one). Null only for not_started tasks.
 */
export function startedOn(
  task: Pick<Task, 'status' | 'startedAt' | 'completedAt' | 'createdAt' | 'updatedAt'>,
): LocalDate | null {
  const ms = effectiveStartedAt(task)
  return ms === null ? null : localDateOfTimestamp(ms)
}

/**
 * The PLAN as an inclusive `[start, end]` span; a single-date task is a one-day span. Null
 * when undated. Still used for drag math on planned bars; views lay out by `displaySpan`.
 */
export function taskSpan(
  task: Pick<Task, 'startDate' | 'dueDate'>,
): { start: LocalDate; end: LocalDate } | null {
  const start = task.startDate ?? task.dueDate
  const end = task.dueDate ?? task.startDate
  if (start === null || end === null) return null
  return { start, end }
}

/**
 * What the Timeline and Calendar draw for a task (inclusive `YYYY-MM-DD` dates):
 * - `planned`: a not_started task's plan (`taskSpan`; null when undated). `ongoing: false`.
 * - `actual`, `ongoing: true`: in_progress / blocked from `startedOn` to
 *   `max(today, dueDate ?? today)`. Never null, so every started task appears.
 * - `actual`, `ongoing: false`: done from `startedOn` to the completion date.
 */
export interface DisplaySpan {
  start: LocalDate
  end: LocalDate
  source: 'planned' | 'actual'
  /** Still open and started: the span's end is (at least) today and moves with it. */
  ongoing: boolean
}

/** See `DisplaySpan`. `end >= start` always holds (clock / time-zone changes are clamped). */
export function displaySpan(task: Task, today: LocalDate): DisplaySpan | null {
  if (task.status === 'not_started') {
    const span = taskSpan(task)
    return span === null ? null : { ...span, source: 'planned', ongoing: false }
  }
  // Non-null for every started status (effectiveStartedAt falls back for legacy rows).
  const start = startedOn(task) ?? today
  if (task.status === 'done') {
    const end = localDateOfTimestamp(task.completedAt ?? task.updatedAt)
    return { start, end: maxDate(start, end), source: 'actual', ongoing: false }
  }
  const end = maxDate(today, task.dueDate ?? today)
  return { start, end: maxDate(start, end), source: 'actual', ongoing: true }
}

// ---------------------------------------------------------------------------
// Board views
// ---------------------------------------------------------------------------

/** Today board: open tasks anchored on/before today (or undated) + done today. */
export function isInTodayBoard(task: Task, today: LocalDate): boolean {
  if (isOpen(task)) {
    const a = anchor(task)
    return a === null || a <= today
  }
  return completedOn(task) === today
}

/** Week board: open tasks anchored on/before end of week (or undated) + done this week. */
export function isInWeekBoard(task: Task, today: LocalDate, settings: ViewSettings): boolean {
  const weekEnd = endOfWeek(today, settings.weekStartsOn)
  if (isOpen(task)) {
    const a = anchor(task)
    return a === null || a <= weekEnd
  }
  const done = completedOn(task)
  if (done === null) return false
  const weekStart = startOfWeek(today, settings.weekStartsOn)
  return done >= weekStart && done <= weekEnd
}

export function filterTodayBoard(tasks: readonly Task[], today: LocalDate): Task[] {
  return tasks.filter((t) => isInTodayBoard(t, today))
}

export function filterWeekBoard(
  tasks: readonly Task[],
  today: LocalDate,
  settings: ViewSettings,
): Task[] {
  return tasks.filter((t) => isInWeekBoard(t, today, settings))
}

export function filterEverythingBoard(tasks: readonly Task[]): Task[] {
  return tasks.slice()
}

export function filterBoard(
  scope: BoardScope,
  tasks: readonly Task[],
  today: LocalDate,
  settings: ViewSettings,
): Task[] {
  switch (scope) {
    case 'today':
      return filterTodayBoard(tasks, today)
    case 'week':
      return filterWeekBoard(tasks, today, settings)
    case 'everything':
      return filterEverythingBoard(tasks)
  }
}

// ---------------------------------------------------------------------------
// Sorting
// ---------------------------------------------------------------------------

function compareNullableDateAsc(a: LocalDate | null, b: LocalDate | null): number {
  if (a === b) return 0
  if (a === null) return 1 // nulls last
  if (b === null) return -1
  return a < b ? -1 : 1
}

function newestFirst(a: Task, b: Task): number {
  if (a.createdAt !== b.createdAt) return b.createdAt - a.createdAt
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
}

/** Priority desc → due date asc (nulls last) → newest first. */
export function compareByPriority(a: Task, b: Task): number {
  if (a.priority !== b.priority) return b.priority - a.priority
  return compareNullableDateAsc(a.dueDate, b.dueDate) || newestFirst(a, b)
}

/** Due date asc (nulls last) → priority desc → newest first. */
export function compareByDue(a: Task, b: Task): number {
  return (
    compareNullableDateAsc(a.dueDate, b.dueDate) || b.priority - a.priority || newestFirst(a, b)
  )
}

/** Most recently completed first; tasks without completedAt last. */
export function compareByCompletedDesc(a: Task, b: Task): number {
  const ac = a.completedAt ?? -Infinity
  const bc = b.completedAt ?? -Infinity
  if (ac !== bc) return bc - ac
  return newestFirst(a, b)
}

export function sortTasks(tasks: readonly Task[], sort: BoardSort): Task[] {
  const cmp =
    sort === 'priority' ? compareByPriority : sort === 'due' ? compareByDue : compareByPosition
  return tasks.slice().sort(cmp)
}

export type BoardColumns = Record<Status, Task[]>

/**
 * Groups tasks into the four status columns and sorts each.
 * Done column: in the Everything board, or whenever sort is not `manual`, it is sorted by
 * `completedAt` desc (most recent first). In Manual mode on Today/Week it uses position so
 * drag-reordering works there too.
 */
export function buildBoardColumns(
  tasks: readonly Task[],
  sort: BoardSort,
  scope: BoardScope = 'today',
): BoardColumns {
  const cols: BoardColumns = { not_started: [], in_progress: [], blocked: [], done: [] }
  for (const t of tasks) cols[t.status].push(t)
  for (const status of STATUSES) {
    if (status === 'done' && (scope === 'everything' || sort !== 'manual')) {
      cols.done.sort(compareByCompletedDesc)
    } else {
      cols[status] = sortTasks(cols[status], sort)
    }
  }
  return cols
}

/** Convenience: filter + group + sort for a board scope. */
export function boardColumns(
  scope: BoardScope,
  tasks: readonly Task[],
  today: LocalDate,
  settings: ViewSettings,
  sort: BoardSort,
): BoardColumns {
  return buildBoardColumns(filterBoard(scope, tasks, today, settings), sort, scope)
}

// ---------------------------------------------------------------------------
// Timeline & calendar
// ---------------------------------------------------------------------------

export interface DatedViewOptions {
  showCompleted?: boolean
}

/** Sort by anchor asc, then due asc, then priority desc, then newest first. */
export function compareByAnchor(a: Task, b: Task): number {
  return (
    compareNullableDateAsc(anchor(a), anchor(b)) ||
    compareNullableDateAsc(a.dueDate, b.dueDate) ||
    b.priority - a.priority ||
    newestFirst(a, b)
  )
}

/**
 * Tie-breakers after the display-span start (`compareByDisplayStart`): due asc (nulls last),
 * priority desc, newest first. Exported for callers that cache the span starts.
 */
export function compareDueThenPriority(a: Task, b: Task): number {
  return (
    compareNullableDateAsc(a.dueDate, b.dueDate) || b.priority - a.priority || newestFirst(a, b)
  )
}

/**
 * Timeline / calendar order: display-span start asc (tasks without a span last), then due
 * asc, then priority desc, then newest first.
 */
export function compareByDisplayStart(today: LocalDate): (a: Task, b: Task) => number {
  return (a, b) =>
    compareNullableDateAsc(
      displaySpan(a, today)?.start ?? null,
      displaySpan(b, today)?.start ?? null,
    ) || compareDueThenPriority(a, b)
}

/** Sorts in place by `compareByDisplayStart`, computing each span once. */
function sortByDisplayStart(tasks: Task[], today: LocalDate): Task[] {
  const starts = new Map(tasks.map((t) => [t, displaySpan(t, today)?.start ?? null]))
  return tasks.sort(
    (a, b) =>
      compareNullableDateAsc(starts.get(a) ?? null, starts.get(b) ?? null) ||
      compareDueThenPriority(a, b),
  )
}

/**
 * Timeline set: tasks with a display span (every started task, plus not_started tasks with a
 * plan); open only unless `showCompleted`. Done tasks whose span ends before
 * `timelineRange(...).start` are left out (history older than the look-back is not drawn as
 * left-edge stubs); open tasks never are. Sorted by `compareByDisplayStart`.
 */
export function filterTimeline(
  tasks: readonly Task[],
  today: LocalDate,
  options: DatedViewOptions = {},
): Task[] {
  const candidates = tasks.filter(
    (t) => (options.showCompleted === true || isOpen(t)) && displaySpan(t, today) !== null,
  )
  const { start } = timelineRange(candidates, today)
  return sortByDisplayStart(
    candidates.filter((t) => {
      if (isOpen(t)) return true
      const span = displaySpan(t, today)
      return span !== null && span.end >= start
    }),
    today,
  )
}

/**
 * Calendar set: tasks with a display span; done included unless `showCompleted === false`.
 * Sorted by `compareByDisplayStart`.
 */
export function filterCalendar(
  tasks: readonly Task[],
  today: LocalDate,
  options: DatedViewOptions = {},
): Task[] {
  return sortByDisplayStart(
    tasks.filter(
      (t) => (options.showCompleted !== false || isOpen(t)) && displaySpan(t, today) !== null,
    ),
    today,
  )
}

/** Tasks whose display span intersects `[from, to]` (inclusive). */
export function tasksInRange(
  tasks: readonly Task[],
  today: LocalDate,
  from: LocalDate,
  to: LocalDate,
): Task[] {
  return tasks.filter((t) => {
    const span = displaySpan(t, today)
    return span !== null && span.start <= to && span.end >= from
  })
}

/**
 * Timeline date range over display spans.
 * - start: `today − 7`, reaching further back to the earliest ACTUAL span start (where started
 *   or, with Completed on, finished work really began), but never before
 *   `today − TIMELINE_MAX_LOOKBACK_DAYS`. Planned (not_started) spans do not pull it back, so
 *   an old overdue plan still clamps to the left edge instead of stretching the chart.
 * - end: the latest display-span end, but at least 6 weeks after today.
 */
export function timelineRange(
  tasks: readonly Task[],
  today: LocalDate,
): { start: LocalDate; end: LocalDate } {
  const floor = addDays(today, -TIMELINE_MAX_LOOKBACK_DAYS)
  let start = addDays(today, -7)
  let end = addDays(today, 42)
  for (const t of tasks) {
    const span = displaySpan(t, today)
    if (!span) continue
    end = maxDate(end, span.end)
    if (span.source === 'actual') start = minDate(start, span.start)
  }
  return { start: maxDate(start, floor), end }
}

// ---------------------------------------------------------------------------
// Progress wording (Timeline tooltip, Calendar title / aria text)
// ---------------------------------------------------------------------------

/**
 * Human lines describing a started task's record, first line first, for the Timeline tooltip
 * and the Calendar `title` / aria text (join with " · " for a single line). Dates use
 * `formatShortDate` (no year in the current year); durations use `formatElapsed`.
 * - in_progress: "Started Nov 3 · in progress 16 days" [+ due line]
 * - blocked:     "Blocked · started Nov 3 · 16 days" [+ due line]
 *   due line:    "Due Nov 25" / "Due today" / "Overdue · was due Nov 14" (none when undated)
 * - done:        "Nov 3 – Nov 12 · took 9 days"; same day: "Nov 12 · took 3 h 20 min";
 *                started and completed at the same instant: "Completed Nov 12"
 * - not_started: [] — the caller keeps its existing plan wording.
 * `now` (epoch ms) is the instant elapsed time is measured to for open tasks.
 */
export function describeProgress(task: Task, today: LocalDate, now: number = Date.now()): string[] {
  const startedMs = effectiveStartedAt(task)
  if (startedMs === null) return []
  const started = localDateOfTimestamp(startedMs)
  const fmt = (d: LocalDate): string => formatShortDate(d, today)
  if (task.status === 'done') {
    const completedMs = Math.max(task.completedAt ?? task.updatedAt, startedMs)
    const completed = localDateOfTimestamp(completedMs)
    if (completedMs === startedMs) return [`Completed ${fmt(completed)}`]
    const took = formatElapsed(completedMs - startedMs)
    return started === completed
      ? [`${fmt(completed)} · took ${took}`]
      : [`${fmt(started)} – ${fmt(completed)} · took ${took}`]
  }
  const elapsed = formatElapsed(now - startedMs)
  const lines = [
    task.status === 'blocked'
      ? `Blocked · started ${fmt(started)} · ${elapsed}`
      : `Started ${fmt(started)} · in progress ${elapsed}`,
  ]
  if (task.dueDate !== null) {
    if (task.dueDate < today) lines.push(`Overdue · was due ${fmt(task.dueDate)}`)
    else if (task.dueDate === today) lines.push('Due today')
    else lines.push(`Due ${fmt(task.dueDate)}`)
  }
  return lines
}

// ---------------------------------------------------------------------------
// Shared filter bar
// ---------------------------------------------------------------------------

export interface TaskFilter {
  /** Case-insensitive substring match on title + description. */
  text: string
  /** Task matches if it has ANY of these tags. Empty = no tag filter. */
  tagIds: readonly string[]
  /** Empty = no priority filter. */
  priorities: readonly Priority[]
}

export const EMPTY_FILTER: TaskFilter = { text: '', tagIds: [], priorities: [] }

export function isFilterActive(filter: TaskFilter): boolean {
  return filter.text.trim() !== '' || filter.tagIds.length > 0 || filter.priorities.length > 0
}

export function matchesFilter(task: Task, filter: TaskFilter): boolean {
  const q = filter.text.trim().toLowerCase()
  if (q !== '') {
    const hay = `${task.title}\n${task.description}`.toLowerCase()
    // Every whitespace-separated term must appear.
    for (const term of q.split(/\s+/)) {
      if (!hay.includes(term)) return false
    }
  }
  if (filter.tagIds.length > 0 && !task.tagIds.some((id) => filter.tagIds.includes(id))) {
    return false
  }
  if (filter.priorities.length > 0 && !filter.priorities.includes(task.priority)) return false
  return true
}

export function applyFilter(tasks: readonly Task[], filter: TaskFilter): Task[] {
  if (!isFilterActive(filter)) return tasks.slice()
  return tasks.filter((t) => matchesFilter(t, filter))
}

// ---------------------------------------------------------------------------
// Description helpers
// ---------------------------------------------------------------------------

const TASK_ITEM_RE = /^\s*(?:[-*+]|\d+[.)])\s+\[([ xX])\]/gm

/** Markdown task-list progress (`- [x]` items), or null when the description has none. */
export function checklistProgress(markdown: string): { done: number; total: number } | null {
  let done = 0
  let total = 0
  for (const m of markdown.matchAll(TASK_ITEM_RE)) {
    total++
    if (m[1] !== ' ') done++
  }
  return total === 0 ? null : { done, total }
}

export function hasDescription(task: Pick<Task, 'description'>): boolean {
  return task.description.trim() !== ''
}

// ---------------------------------------------------------------------------
// Display order and badges
// ---------------------------------------------------------------------------

/**
 * Tag display order everywhere a task's tags are shown (cards, list, detail panel, quick
 * add, Copy as Markdown): alphabetical by name, case-insensitive; ties by id, so the order
 * never depends on load or insertion order.
 */
export function compareTagsByName(
  a: { name: string; id?: string },
  b: { name: string; id?: string },
): number {
  const byName = a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })
  if (byName !== 0) return byName
  const ai = a.id ?? ''
  const bi = b.id ?? ''
  return ai < bi ? -1 : ai > bi ? 1 : 0
}

/** A task's tags resolved by id (unknown ids skipped), in display order. */
export function tagsInDisplayOrder<T extends { id: string; name: string }>(
  tagIds: readonly string[],
  byId: Readonly<Record<string, T>>,
): T[] {
  return tagIds
    .map((id) => byId[id])
    .filter((t): t is T => t !== undefined)
    .sort(compareTagsByName)
}

export type DateBadgeInfo = { kind: 'due'; date: LocalDate } | { kind: 'start'; date: LocalDate }

/**
 * The single date a compact task row shows: the due date when there is one (coloured when
 * overdue / due today), otherwise a muted "Starts <date>" for a start-only task.
 */
export function dateBadge(task: Pick<Task, 'startDate' | 'dueDate'>): DateBadgeInfo | null {
  if (task.dueDate) return { kind: 'due', date: task.dueDate }
  if (task.startDate) return { kind: 'start', date: task.startDate }
  return null
}
