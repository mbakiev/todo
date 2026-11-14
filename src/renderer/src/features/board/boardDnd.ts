// Pure helpers for board drag-and-drop: droppable ids, container bookkeeping while a drag
// is in flight, and turning a drop into a `tasksStore.move` input. No React, no stores.

import { STATUSES } from '@shared/constants'
import type { MoveTaskInput } from '@shared/ipc'
import { compareByPosition } from '@shared/ordering'
import type { BoardScope, BoardSort, Status, Task } from '@shared/types'

/** Column ids in display order, keyed by status. */
export type ColumnItems = Record<Status, string[]>

const COLUMN_PREFIX = 'column:'

/** Droppable id of a whole column (distinct from task ids, which are UUIDs / `tmp-…`). */
export function columnDroppableId(status: Status): string {
  return `${COLUMN_PREFIX}${status}`
}

/** The status a column droppable id refers to, or null if `id` is not a column id. */
export function statusOfColumnId(id: string): Status | null {
  if (!id.startsWith(COLUMN_PREFIX)) return null
  const s = id.slice(COLUMN_PREFIX.length)
  return (STATUSES as readonly string[]).includes(s) ? (s as Status) : null
}

/** Which column an id (task or column droppable) belongs to in `items`. */
export function findContainer(items: ColumnItems, id: string): Status | null {
  const col = statusOfColumnId(id)
  if (col) return col
  for (const s of STATUSES) if (items[s].includes(id)) return s
  return null
}

/**
 * Whether a column honours manual order on this board. The Everything board always sorts
 * Done by completion time, so drops into it land in their sorted place.
 */
export function isColumnManual(sort: BoardSort, scope: BoardScope, status: Status): boolean {
  if (sort !== 'manual') return false
  return !(status === 'done' && scope === 'everything')
}

/**
 * Moves `activeId` from column `from` into column `to` during a drag.
 * `overId` is the hovered card (or the column itself → append at the end); `below` says
 * the pointer is past the hovered card's midpoint, so insert after it.
 */
export function moveToContainer(
  items: ColumnItems,
  activeId: string,
  from: Status,
  to: Status,
  overId: string,
  below: boolean,
): ColumnItems {
  if (from === to) return items
  const source = items[from].filter((id) => id !== activeId)
  const target = items[to].filter((id) => id !== activeId)
  const overIndex = target.indexOf(overId)
  const index = overIndex === -1 ? target.length : overIndex + (below ? 1 : 0)
  target.splice(index, 0, activeId)
  return { ...items, [from]: source, [to]: target }
}

/** Moves `activeId` to the slot of `overId` within one column (like dnd-kit's arrayMove). */
export function reorderWithin(ids: readonly string[], activeId: string, overId: string): string[] {
  const from = ids.indexOf(activeId)
  const to = ids.indexOf(overId)
  if (from === -1 || to === -1 || from === to) return ids.slice()
  const next = ids.slice()
  next.splice(from, 1)
  next.splice(to, 0, activeId)
  return next
}

/**
 * The neighbours `activeId` sits between in `ordered` (a column in display order that
 * contains it). Ids rejected by `isValid` (optimistic temp tasks, tasks that vanished
 * mid-drag) are skipped, so the server only ever sees real neighbours in that column.
 */
export function neighboursOf(
  ordered: readonly string[],
  activeId: string,
  isValid: (id: string) => boolean = () => true,
): Pick<MoveTaskInput, 'beforeId' | 'afterId'> {
  const i = ordered.indexOf(activeId)
  if (i === -1) return { beforeId: null, afterId: null }
  let beforeId: string | null = null
  for (let j = i - 1; j >= 0; j--) {
    const id = ordered[j] as string
    if (isValid(id)) {
      beforeId = id
      break
    }
  }
  let afterId: string | null = null
  for (let j = i + 1; j < ordered.length; j++) {
    const id = ordered[j] as string
    if (isValid(id)) {
      afterId = id
      break
    }
  }
  return { beforeId, afterId }
}

/**
 * Neighbours that put a task at the top of a status's manual order (used when a drop does
 * not pick a position: Priority / Due sort, or the Everything board's Done column).
 * Considers every task in that status, not only the visible ones.
 */
export function topOfStatus(
  tasks: readonly Task[],
  status: Status,
  excludeId: string,
  isValid: (id: string) => boolean = () => true,
): Pick<MoveTaskInput, 'beforeId' | 'afterId'> {
  const first = tasks
    .filter((t) => t.status === status && t.id !== excludeId && isValid(t.id))
    .sort(compareByPosition)[0]
  return { beforeId: null, afterId: first?.id ?? null }
}

export interface DropContext {
  activeId: string
  /** Column the card was in when the drag started. */
  originStatus: Status
  /** Column ids in display order when the drag started. */
  originItems: ColumnItems
  /** Column ids in display order at drop time (after cross-column moves during the drag). */
  items: ColumnItems
  /** Resolved drop column, or null when dropped outside the board. */
  overStatus: Status | null
  /** Hovered droppable id at drop time (a task id or a column id). */
  overId: string | null
  sort: BoardSort
  scope: BoardScope
  /** All tasks (unfiltered), for top-of-column placement. */
  tasks: readonly Task[]
  /** Valid neighbour ids: real (non-temp) tasks that are still in `status` in the store. */
  isValid(id: string, status: Status): boolean
}

/**
 * Turns a drop into a `move` input, or null when nothing changes (dropped outside, same
 * slot, or same column in a sorted mode).
 */
export function planDrop(ctx: DropContext): MoveTaskInput | null {
  const { activeId, originStatus, overStatus, sort, scope } = ctx
  if (overStatus === null) return null
  const status = overStatus
  const valid = (id: string): boolean => ctx.isValid(id, status)

  if (!isColumnManual(sort, scope, status)) {
    if (status === originStatus) return null
    return { status, ...topOfStatus(ctx.tasks, status, activeId, valid) }
  }

  // Manual: the card lands where it was dropped.
  let ordered = ctx.items[status].includes(activeId)
    ? ctx.items[status]
    : [...ctx.items[status], activeId] // dragged straight onto a column that never received it
  if (ctx.overId !== null && ctx.overId !== activeId && ordered.includes(ctx.overId)) {
    ordered = reorderWithin(ordered, activeId, ctx.overId)
  }
  const next = neighboursOf(ordered, activeId, valid)
  if (status === originStatus) {
    const prev = neighboursOf(ctx.originItems[originStatus], activeId, valid)
    if (prev.beforeId === next.beforeId && prev.afterId === next.afterId) return null
    return next
  }
  return { status, ...next }
}

/** Default page size of the Done column (spec §6: newest 50, "Show more" adds 50). */
export const DONE_PAGE_SIZE = 50
