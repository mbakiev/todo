// Row model for the Timeline: sort order and optional grouping. Pure.

import { PRIORITIES, PRIORITY_LABELS, STATUSES, STATUS_LABELS } from '@shared/constants'
import { addDays } from '@shared/dates'
import type { LocalDate, Priority, Status, Task } from '@shared/types'
import { displaySpan, isOpen } from '@shared/views'

export type GroupBy = 'none' | 'status' | 'priority'
export const GROUP_BY_LABELS: Record<GroupBy, string> = {
  none: 'No grouping',
  status: 'Status',
  priority: 'Priority',
}

export type TimelineRow =
  | {
      kind: 'group'
      key: string
      label: string
      count: number
      collapsed: boolean
      status?: Status
      priority?: Priority
    }
  | { kind: 'task'; task: Task }

function cmpNullable(a: string | null, b: string | null): number {
  if (a === b) return 0
  if (a === null) return 1
  if (b === null) return -1
  return a < b ? -1 : 1
}

/**
 * Display-span start asc (where the bar begins: the plan, or when work really started) →
 * priority desc → due asc → oldest first → id. Tasks without a span sort last.
 */
export function compareTimelineTasks(today: LocalDate): (a: Task, b: Task) => number {
  const starts = new Map<Task, LocalDate | null>()
  const startOf = (t: Task): LocalDate | null => {
    let s = starts.get(t)
    if (s === undefined) {
      s = displaySpan(t, today)?.start ?? null
      starts.set(t, s)
    }
    return s
  }
  return (a, b) =>
    cmpNullable(startOf(a), startOf(b)) ||
    b.priority - a.priority ||
    cmpNullable(a.dueDate, b.dueDate) ||
    a.createdAt - b.createdAt ||
    (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
}

/** Sorted rows; with grouping, a header row precedes each non-empty group. */
export function buildTimelineRows(
  tasks: readonly Task[],
  today: LocalDate,
  groupBy: GroupBy,
  collapsed: ReadonlySet<string> = new Set(),
): TimelineRow[] {
  const sorted = tasks.slice().sort(compareTimelineTasks(today))
  if (groupBy === 'none') return sorted.map((task) => ({ kind: 'task', task }))

  const groups: Array<{
    key: string
    label: string
    tasks: Task[]
    status?: Status
    priority?: Priority
  }> =
    groupBy === 'status'
      ? STATUSES.map((s) => ({
          key: `status:${s}`,
          label: STATUS_LABELS[s],
          status: s,
          tasks: sorted.filter((t) => t.status === s),
        }))
      : PRIORITIES.map((p) => ({
          key: `priority:${p}`,
          label: PRIORITY_LABELS[p],
          priority: p,
          tasks: sorted.filter((t) => t.priority === p),
        }))

  const rows: TimelineRow[] = []
  for (const g of groups) {
    if (g.tasks.length === 0) continue
    const isCollapsed = collapsed.has(g.key)
    rows.push({
      kind: 'group',
      key: g.key,
      label: g.label,
      count: g.tasks.length,
      collapsed: isCollapsed,
      ...(g.status !== undefined && { status: g.status }),
      ...(g.priority !== undefined && { priority: g.priority }),
    })
    if (!isCollapsed) for (const task of g.tasks) rows.push({ kind: 'task', task })
  }
  return rows
}

/**
 * The row to put at the top on first render and on "Today": the first task row that is open
 * (open work, overdue included, always stays in sight) or whose display span reaches
 * `today − 7` (the left edge after "Today"). Old history rows above it are skipped, so with
 * Completed on the first screen is not a column of bars far off to the left. A task that is
 * first in its group brings its group header along. 0 when no row qualifies.
 */
export function firstRecentRowIndex(rows: readonly TimelineRow[], today: LocalDate): number {
  const from = addDays(today, -7)
  const i = rows.findIndex((r) => {
    if (r.kind !== 'task') return false
    if (isOpen(r.task)) return true
    const span = displaySpan(r.task, today)
    return span !== null && span.end >= from
  })
  if (i <= 0) return 0
  return rows[i - 1]?.kind === 'group' ? i - 1 : i
}

/** Vertical offset (px) of `rows[index]` in the body, from fixed row heights. */
export function rowOffset(
  rows: readonly TimelineRow[],
  index: number,
  heights: { task: number; group: number },
): number {
  let y = 0
  for (let i = 0; i < index && i < rows.length; i++) {
    y += rows[i]?.kind === 'group' ? heights.group : heights.task
  }
  return y
}
