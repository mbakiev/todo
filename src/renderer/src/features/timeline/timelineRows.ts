// Row model for the Timeline: sort order and optional grouping. Pure.

import { PRIORITIES, PRIORITY_LABELS, STATUSES, STATUS_LABELS } from '@shared/constants'
import type { Priority, Status, Task } from '@shared/types'
import { anchor } from '@shared/views'

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

/** Anchor date asc → priority desc → due asc → oldest first → id. */
export function compareTimelineTasks(a: Task, b: Task): number {
  return (
    cmpNullable(anchor(a), anchor(b)) ||
    b.priority - a.priority ||
    cmpNullable(a.dueDate, b.dueDate) ||
    a.createdAt - b.createdAt ||
    (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
  )
}

/** Sorted rows; with grouping, a header row precedes each non-empty group. */
export function buildTimelineRows(
  tasks: readonly Task[],
  groupBy: GroupBy,
  collapsed: ReadonlySet<string> = new Set(),
): TimelineRow[] {
  const sorted = tasks.slice().sort(compareTimelineTasks)
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
