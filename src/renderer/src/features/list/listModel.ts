// Pure sort / filter / group logic for the List view. No React/DOM; unit-tested.
import { PRIORITIES, PRIORITY_LABELS, STATUSES, STATUS_LABELS } from '@shared/constants'
import type { Priority, Status, Tag, Task } from '@shared/types'
import { compareByCompletedDesc, compareByPriority, isOpen } from '@shared/views'

export const LIST_COLUMN_IDS = [
  'status',
  'title',
  'priority',
  'tags',
  'startDate',
  'dueDate',
  'createdAt',
  'completedAt',
] as const
export type ListColumnId = (typeof LIST_COLUMN_IDS)[number]

export interface ListSort {
  id: ListColumnId
  desc: boolean
}

export type ListGroupBy = 'none' | 'status' | 'priority'

/**
 * Default order (no column sort): open tasks first by priority desc → due asc (nulls last)
 * → newest; done tasks last, most recently completed first.
 */
export function compareListDefault(a: Task, b: Task): number {
  const ao = isOpen(a)
  const bo = isOpen(b)
  if (ao !== bo) return ao ? -1 : 1
  return ao ? compareByPriority(a, b) : compareByCompletedDesc(a, b)
}

const STATUS_RANK: Record<Status, number> = Object.fromEntries(
  STATUSES.map((s, i) => [s, i]),
) as Record<Status, number>

type Key = string | number | null

function sortKey(task: Task, id: ListColumnId, tagsById: Record<string, Tag>): Key {
  switch (id) {
    case 'status':
      return STATUS_RANK[task.status]
    case 'title':
      return task.title.toLocaleLowerCase()
    case 'priority':
      return task.priority
    case 'tags': {
      const names = task.tagIds
        .map((tid) => tagsById[tid]?.name.toLocaleLowerCase())
        .filter((n): n is string => n !== undefined)
        .sort()
      return names.length === 0 ? null : names.join('\u0000')
    }
    case 'startDate':
      return task.startDate
    case 'dueDate':
      return task.dueDate
    case 'createdAt':
      return task.createdAt
    case 'completedAt':
      return task.completedAt
  }
}

function compareKeys(a: Key, b: Key): number {
  if (typeof a === 'number' && typeof b === 'number') return a - b
  return String(a).localeCompare(String(b), undefined, { numeric: true })
}

/**
 * Sorts by a column (or the default order when `sort` is null). Empty values (no date, no
 * tags, not completed) always sort last, in both directions. Ties fall back to the default
 * order so the result is stable and meaningful.
 */
export function sortListTasks(
  tasks: readonly Task[],
  sort: ListSort | null,
  tagsById: Record<string, Tag> = {},
): Task[] {
  if (!sort) return tasks.slice().sort(compareListDefault)
  const dir = sort.desc ? -1 : 1
  const keyed = tasks.map((task) => ({ task, key: sortKey(task, sort.id, tagsById) }))
  keyed.sort((x, y) => {
    if (x.key === null || y.key === null) {
      if (x.key === y.key) return compareListDefault(x.task, y.task)
      return x.key === null ? 1 : -1
    }
    return dir * compareKeys(x.key, y.key) || compareListDefault(x.task, y.task)
  })
  return keyed.map((k) => k.task)
}

export function filterByStatus(tasks: readonly Task[], statuses: readonly Status[]): Task[] {
  if (statuses.length === STATUSES.length) return tasks.slice()
  return tasks.filter((t) => statuses.includes(t.status))
}

export interface ListGroupRow {
  type: 'group'
  key: string
  label: string
  count: number
  collapsed: boolean
  status?: Status
  priority?: Priority
}
export interface ListTaskRow {
  type: 'task'
  key: string
  task: Task
}
export type ListRow = ListGroupRow | ListTaskRow

/**
 * Flattens sorted tasks into display rows. With grouping, each non-empty group gets a header
 * row (status order / priority high → low) followed by its tasks unless collapsed. Order
 * inside a group is the incoming (sorted) order.
 */
export function buildListRows(
  sorted: readonly Task[],
  groupBy: ListGroupBy,
  collapsed: ReadonlySet<string> = new Set(),
): ListRow[] {
  const taskRow = (task: Task): ListTaskRow => ({ type: 'task', key: task.id, task })
  if (groupBy === 'none') return sorted.map(taskRow)

  const groups =
    groupBy === 'status'
      ? STATUSES.map((status) => ({
          key: `status:${status}`,
          label: STATUS_LABELS[status],
          status,
          tasks: sorted.filter((t) => t.status === status),
        }))
      : PRIORITIES.map((priority) => ({
          key: `priority:${priority}`,
          label: PRIORITY_LABELS[priority],
          priority,
          tasks: sorted.filter((t) => t.priority === priority),
        }))

  const rows: ListRow[] = []
  for (const { tasks, ...g } of groups) {
    if (tasks.length === 0) continue
    const isCollapsed = collapsed.has(g.key)
    rows.push({ type: 'group', ...g, count: tasks.length, collapsed: isCollapsed })
    if (!isCollapsed) rows.push(...tasks.map(taskRow))
  }
  return rows
}

/** Next / previous task id for keyboard navigation over the visible task rows. */
export function adjacentTaskId(
  rows: readonly ListRow[],
  currentId: string | null,
  step: 1 | -1,
): string | null {
  const ids = rows.filter((r): r is ListTaskRow => r.type === 'task').map((r) => r.task.id)
  if (ids.length === 0) return null
  const i = currentId === null ? -1 : ids.indexOf(currentId)
  if (i === -1) return step === 1 ? (ids[0] ?? null) : (ids[ids.length - 1] ?? null)
  return ids[Math.min(ids.length - 1, Math.max(0, i + step))] ?? null
}
