// Drag-and-drop state for one board. While a drag is in flight the board renders from a
// local copy of the column ids (so cards can hop between columns under the pointer); on
// drop it calls `tasksStore.move`, whose optimistic update lands in the same render as
// the local copy is discarded — no flicker, no jump.
import {
  KeyboardSensor,
  PointerSensor,
  pointerWithin,
  rectIntersection,
  useSensor,
  useSensors,
  type Announcements,
  type CollisionDetection,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
} from '@dnd-kit/core'
import { sortableKeyboardCoordinates } from '@dnd-kit/sortable'
import { useEffect, useMemo, useRef, useState } from 'react'
import { STATUSES, STATUS_LABELS } from '@shared/constants'
import type { BoardScope, BoardSort, Status, Task } from '@shared/types'
import { isTempId, onTempIdResolved, useTasksStore } from '@/stores/tasksStore'
import { useUiStore } from '@/stores/uiStore'
import {
  findContainer,
  isColumnManual,
  moveToContainer,
  nearestDropTarget,
  type DropCandidate,
  planDrop,
  statusOfColumnId,
  type ColumnItems,
} from './boardDnd'

interface DragState {
  activeId: string
  originStatus: Status
  originItems: ColumnItems
  items: ColumnItems
  overStatus: Status | null
}

function idsOf(columns: Record<Status, Task[]>): ColumnItems {
  return {
    not_started: columns.not_started.map((t) => t.id),
    in_progress: columns.in_progress.map((t) => t.id),
    blocked: columns.blocked.map((t) => t.id),
    done: columns.done.map((t) => t.id),
  }
}

function replaceId(items: ColumnItems, from: string, to: string): ColumnItems {
  const next = { ...items }
  for (const s of STATUSES) next[s] = items[s].map((id) => (id === from ? to : id))
  return next
}

function titleOf(id: string | number): string {
  return useTasksStore.getState().byId[String(id)]?.title ?? 'task'
}

const announcements: Announcements = {
  onDragStart: ({ active }) => `Picked up ${titleOf(active.id)}.`,
  onDragOver: ({ active, over }) => {
    const status = over ? (over.data.current?.status as Status | undefined) : undefined
    return status
      ? `${titleOf(active.id)} is over ${STATUS_LABELS[status]}.`
      : `${titleOf(active.id)} is no longer over a column.`
  },
  onDragEnd: ({ active, over }) => {
    const status = over ? (over.data.current?.status as Status | undefined) : undefined
    return status
      ? `${titleOf(active.id)} was dropped in ${STATUS_LABELS[status]}.`
      : `${titleOf(active.id)} was dropped.`
  },
  onDragCancel: ({ active }) => `Moving ${titleOf(active.id)} was cancelled.`,
}

export interface BoardDnd {
  /** Column contents to render: the live drag copy while dragging, else the view's columns. */
  columns: Record<Status, Task[]>
  activeTask: Task | null
  overStatus: Status | null
  originStatus: Status | null
  /** Attach to the board's scroll container: drops anywhere inside it resolve to a column. */
  setBoardElement: (el: HTMLElement | null) => void
  dndContextProps: {
    sensors: ReturnType<typeof useSensors>
    collisionDetection: CollisionDetection
    accessibility: { announcements: Announcements }
    onDragStart(e: DragStartEvent): void
    onDragOver(e: DragOverEvent): void
    onDragEnd(e: DragEndEvent): void
    onDragCancel(): void
  }
}

export function useBoardDnd(
  scope: BoardScope,
  sort: BoardSort,
  visible: Record<Status, Task[]>,
): BoardDnd {
  const [drag, setDrag] = useState<DragState | null>(null)
  const dragRef = useRef<DragState | null>(null)
  const update = (next: DragState | null): void => {
    dragRef.current = next
    setDrag(next)
  }
  const byId = useTasksStore((s) => s.byId)

  // Optimistic tasks get their real id once the server answers: keep the drag copy and
  // the selection pointing at the same card.
  useEffect(
    () =>
      onTempIdResolved((tempId, realId) => {
        const cur = dragRef.current
        if (cur) {
          const next: DragState = {
            ...cur,
            items: replaceId(cur.items, tempId, realId),
            originItems: replaceId(cur.originItems, tempId, realId),
          }
          dragRef.current = next
          setDrag(next)
        }
        const ui = useUiStore.getState()
        if (ui.selectedTaskId === tempId) ui.selectTask(realId, { force: true })
      }),
    [],
  )

  const sensors = useSensors(
    // A small distance so plain clicks still select the card.
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
      // Enter opens the card; Space picks it up / drops it.
      keyboardCodes: { start: ['Space'], cancel: ['Escape'], end: ['Space', 'Enter'] },
    }),
  )

  const [boardEl, setBoardEl] = useState<HTMLElement | null>(null)
  const collisionDetection: CollisionDetection = (args) => {
    const hits = pointerWithin(args)
    if (hits.length > 0) return prefersCards(hits)
    // Inside the board but over no droppable (a gutter between columns, the padding): the
    // nearest column (and nearest slot in Manual) rather than a cancelled drop.
    const p = args.pointerCoordinates
    const board = boardEl?.getBoundingClientRect()
    if (
      p &&
      board &&
      p.x >= board.left &&
      p.x <= board.right &&
      p.y >= board.top &&
      p.y <= board.bottom
    ) {
      // Column membership from the live drag copy: a card's own `data.status` is stale once
      // it has hopped columns (the dragged card's placeholder must count where it now is).
      const items = drag?.items
      const candidates: DropCandidate[] = []
      for (const c of args.droppableContainers) {
        const rect = args.droppableRects.get(c.id)
        const status = items ? findContainer(items, String(c.id)) : null
        if (rect && status) candidates.push({ id: String(c.id), status, rect })
      }
      const id = nearestDropTarget(p, candidates, (s) => isColumnManual(sort, scope, s))
      if (id !== null) return [{ id }]
    }
    return rectIntersection(args)
  }

  const resolveStatus = (id: string | null): Status | null => {
    const cur = dragRef.current
    if (id === null || !cur) return null
    return statusOfColumnId(id) ?? findContainer(cur.items, id)
  }

  const onDragStart = ({ active }: DragStartEvent): void => {
    const items = idsOf(visible)
    const id = String(active.id)
    const originStatus = findContainer(items, id)
    if (!originStatus) return
    update({ activeId: id, originStatus, originItems: items, items, overStatus: originStatus })
  }

  const onDragOver = ({ active, over }: DragOverEvent): void => {
    const cur = dragRef.current
    if (!cur) return
    const overId = over ? String(over.id) : null
    const overStatus = resolveStatus(overId)
    let items = cur.items
    if (overId !== null && overStatus !== null) {
      const from = findContainer(items, cur.activeId)
      if (isColumnManual(sort, scope, overStatus)) {
        if (from !== null && from !== overStatus) {
          const translated = active.rect.current.translated
          const below =
            over !== null &&
            translated !== null &&
            translated.top > over.rect.top + over.rect.height / 2
          items = moveToContainer(items, cur.activeId, from, overStatus, overId, below)
        }
      } else if (from !== cur.originStatus) {
        // Sorted target: no placeholder there, so put the card back where it came from.
        items = cur.originItems
      }
    }
    if (items !== cur.items || overStatus !== cur.overStatus) {
      update({ ...cur, items, overStatus })
    }
  }

  const onDragEnd = ({ over }: DragEndEvent): void => {
    const cur = dragRef.current
    if (!cur) return
    const overId = over ? String(over.id) : null
    const store = useTasksStore.getState()
    const plan = planDrop({
      activeId: cur.activeId,
      originStatus: cur.originStatus,
      originItems: cur.originItems,
      items: cur.items,
      overStatus: resolveStatus(overId),
      overId,
      sort,
      scope,
      tasks: Object.values(store.byId),
      isValid: (id, status) => !isTempId(id) && store.byId[id]?.status === status,
    })
    // `move` applies its optimistic update synchronously, so the store already holds the
    // new order when the drag copy is dropped below (one render, no snap-back).
    if (plan && store.byId[cur.activeId] && !isTempId(cur.activeId)) {
      void store.move(cur.activeId, plan)
    }
    update(null)
  }

  const columns = useMemo(() => {
    if (!drag) return visible
    const out = {} as Record<Status, Task[]>
    for (const s of STATUSES) {
      out[s] = drag.items[s].map((id) => byId[id]).filter((t): t is Task => t !== undefined)
    }
    return out
  }, [drag, visible, byId])

  return {
    columns,
    activeTask: drag ? (byId[drag.activeId] ?? null) : null,
    overStatus: drag?.overStatus ?? null,
    originStatus: drag?.originStatus ?? null,
    setBoardElement: setBoardEl,
    dndContextProps: {
      sensors,
      collisionDetection,
      accessibility: { announcements },
      onDragStart,
      onDragOver,
      onDragEnd,
      onDragCancel: () => update(null),
    },
  }
}

/** When the pointer is over both a card and its column, the card wins (finer position). */
function prefersCards<T extends { id: string | number }>(hits: T[]): T[] {
  const cards = hits.filter((h) => statusOfColumnId(String(h.id)) === null)
  return cards.length > 0 ? cards : hits
}
