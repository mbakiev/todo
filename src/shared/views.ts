// View filter and sort logic. Pure functions of (tasks, today, settings); unit-tested.
// Components must not re-implement any of these rules.

import { STATUSES } from './constants'
import { addDays, endOfWeek, localDateOfTimestamp, maxDate, startOfWeek } from './dates'
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

/** Inclusive `[start, end]` span; a single-date task is a one-day span. Null when undated. */
export function taskSpan(
  task: Pick<Task, 'startDate' | 'dueDate'>,
): { start: LocalDate; end: LocalDate } | null {
  const start = task.startDate ?? task.dueDate
  const end = task.dueDate ?? task.startDate
  if (start === null || end === null) return null
  return { start, end }
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
 * Timeline set: tasks with at least one date; open only unless `showCompleted`.
 * Sorted by anchor date.
 */
export function filterTimeline(tasks: readonly Task[], options: DatedViewOptions = {}): Task[] {
  return tasks
    .filter((t) => hasAnyDate(t) && (options.showCompleted === true || isOpen(t)))
    .sort(compareByAnchor)
}

/** Calendar set: tasks with at least one date; done included unless `showCompleted === false`. */
export function filterCalendar(tasks: readonly Task[], options: DatedViewOptions = {}): Task[] {
  return tasks
    .filter((t) => hasAnyDate(t) && (options.showCompleted !== false || isOpen(t)))
    .sort(compareByAnchor)
}

/** Tasks whose span intersects `[from, to]` (inclusive). */
export function tasksInRange(tasks: readonly Task[], from: LocalDate, to: LocalDate): Task[] {
  return tasks.filter((t) => {
    const span = taskSpan(t)
    return span !== null && span.start <= to && span.end >= from
  })
}

/**
 * Timeline date range: starts one week before today; ends at the latest task date, but at
 * least 6 weeks after today.
 */
export function timelineRange(
  tasks: readonly Task[],
  today: LocalDate,
): { start: LocalDate; end: LocalDate } {
  const start = addDays(today, -7)
  let end = addDays(today, 42)
  for (const t of tasks) {
    const span = taskSpan(t)
    if (span) end = maxDate(end, span.end)
  }
  return { start, end }
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
