// One status column: header with count, independently scrolling card list (a droppable +
// sortable context), empty state, and the Done column's "Show more" pager.
import { useDroppable } from '@dnd-kit/core'
import {
  SortableContext,
  verticalListSortingStrategy,
  type SortingStrategy,
} from '@dnd-kit/sortable'
import type { ReactNode } from 'react'
import { STATUS_LABELS } from '@shared/constants'
import type { Status, Task } from '@shared/types'
import { StatusIcon } from '@/components/task'
import { cn } from '@/lib/utils'
import { SortableCard } from './BoardCard'
import { columnDroppableId } from './boardDnd'

/** Sorted columns don't open a gap for the dragged card: it will take its sorted place. */
const noSorting: SortingStrategy = () => null

export interface BoardColumnProps {
  status: Status
  tasks: Task[]
  /** Total cards in the column (may exceed `tasks.length` when the Done column is paged). */
  total: number
  /** Whether dropping here picks a position (Manual sort). */
  manual: boolean
  /** Highlight as the drop target of the current drag. */
  dropTarget: boolean
  /** A drag is in progress anywhere on the board. */
  dragging: boolean
  emptyText: string
  /** Rendered above the cards (inline add on Not Started). */
  header?: ReactNode
  /** Rendered below the cards (Show more on Done). */
  footer?: ReactNode
}

export function BoardColumn({
  status,
  tasks,
  total,
  manual,
  dropTarget,
  dragging,
  emptyText,
  header,
  footer,
}: BoardColumnProps) {
  const { setNodeRef } = useDroppable({ id: columnDroppableId(status), data: { status } })
  const ids = tasks.map((t) => t.id)

  return (
    <section
      ref={setNodeRef}
      aria-label={STATUS_LABELS[status]}
      data-column={status}
      data-drop-target={dropTarget || undefined}
      className={cn(
        'flex min-h-0 min-w-64 flex-1 basis-0 flex-col rounded-lg bg-column',
        'ring-1 ring-transparent transition-[box-shadow,background-color] duration-150 ring-inset',
        dropTarget && 'bg-selection ring-primary/40',
      )}
    >
      <header className="flex h-10 shrink-0 items-center gap-2 px-3 text-xs font-medium">
        <StatusIcon status={status} />
        <span>{STATUS_LABELS[status]}</span>
        <span className="text-muted-foreground tabular-nums" data-testid={`count-${status}`}>
          {total}
        </span>
      </header>
      {header && <div className="shrink-0 px-2 pb-1.5">{header}</div>}
      <div
        className={cn(
          'flex min-h-0 flex-1 scrollbar-thin flex-col gap-1.5 overflow-y-auto px-2 pb-2',
          // A scroll container clips at its padding edge, so the first card's
          // selection/focus ring (drawn outside the card) needs headroom. The
          // negative margin cancels the padding so the cards do not move.
          '-mt-1 pt-1',
          // Keep a decent drop area even when the column is empty.
          'min-h-16',
        )}
        data-testid={`column-${status}`}
      >
        <SortableContext
          id={status}
          items={ids}
          strategy={manual ? verticalListSortingStrategy : noSorting}
        >
          {tasks.map((t) => (
            <SortableCard key={t.id} task={t} dragging={dragging} manual={manual} />
          ))}
        </SortableContext>
        {tasks.length === 0 && (
          <p
            className={cn(
              'px-1 py-1.5 text-xs text-muted-foreground/80 transition-opacity',
              dragging && 'opacity-0',
            )}
          >
            {emptyText}
          </p>
        )}
        {footer}
      </div>
    </section>
  )
}
