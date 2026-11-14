// Board card: the presentational body (also used by the drag overlay) and the sortable,
// clickable, right-clickable card that lives in a column.
import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { AlignLeft, ListChecks } from 'lucide-react'
import { memo, type KeyboardEvent } from 'react'
import type { Task } from '@shared/types'
import { checklistProgress, hasDescription } from '@shared/views'
import { DueDateBadge, PriorityIcon, TaskContextMenu, TaskTags } from '@/components/task'
import { cn } from '@/lib/utils'
import { isTempId } from '@/stores/tasksStore'
import { useUiStore } from '@/stores/uiStore'

interface CardBodyProps {
  task: Task
  selected?: boolean
  /** Rendered inside the drag overlay (lifted look). */
  overlay?: boolean
}

/** Card visuals. Pure presentation: no drag or click behaviour. */
export function CardBody({ task, selected = false, overlay = false }: CardBodyProps) {
  const done = task.status === 'done'
  const progress = checklistProgress(task.description)
  const described = hasDescription(task)
  return (
    <div
      className={cn(
        'flex w-full flex-col gap-1.5 rounded-md border bg-card px-2.5 py-2 text-left shadow-xs',
        'transition-[border-color,box-shadow,background-color] duration-100',
        !overlay && 'group-hover/card:border-foreground/20',
        done && !overlay && 'bg-card/60 shadow-none',
        selected && 'border-primary/70 ring-2 ring-primary/70 group-hover/card:border-primary/70',
        overlay && 'cursor-grabbing border-foreground/20 shadow-lg',
      )}
    >
      <span className="flex items-start gap-1.5">
        <PriorityIcon priority={task.priority} className={cn('mt-[2px]', done && 'opacity-50')} />
        <span
          className={cn(
            'line-clamp-3 min-w-0 flex-1 text-[13px] leading-snug break-words',
            done ? 'text-muted-foreground' : 'text-card-foreground',
          )}
        >
          {task.title}
        </span>
      </span>
      {(task.dueDate || task.startDate || described || progress || task.tagIds.length > 0) && (
        <span
          className={cn('flex flex-wrap items-center gap-x-2 gap-y-1 pl-5', done && 'opacity-60')}
        >
          <DueDateBadge dueDate={task.dueDate} status={task.status} />
          {progress && (
            <span
              className={cn(
                'inline-flex items-center gap-1 text-[11px] font-medium text-muted-foreground tabular-nums',
                progress.done === progress.total && 'text-status-done',
              )}
              title={`${progress.done} of ${progress.total} checklist items done`}
            >
              <ListChecks className="size-3" />
              {progress.done}/{progress.total}
            </span>
          )}
          {described && !progress && (
            <AlignLeft
              className="size-3 text-muted-foreground"
              aria-label="Has description"
              role="img"
            />
          )}
          <TaskTags tagIds={task.tagIds} />
        </span>
      )}
    </div>
  )
}

interface SortableCardProps {
  task: Task
  /** A drag is in progress somewhere on the board. */
  dragging: boolean
  /** The column honours manual order: the dragged card leaves a drop slot, not a ghost. */
  manual: boolean
}

function onCardKeyDown(e: KeyboardEvent<HTMLDivElement>, id: string): void {
  if (e.key === 'Enter' && e.target === e.currentTarget) {
    e.preventDefault()
    useUiStore.getState().selectTask(id)
  }
}

/** A card in a column: click selects, right-click opens the context menu, drag moves. */
export const SortableCard = memo(function SortableCard({
  task,
  dragging,
  manual,
}: SortableCardProps) {
  const selected = useUiStore((s) => s.selectedTaskId === task.id)
  const temp = isTempId(task.id)
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: task.id,
    data: { status: task.status },
    // Optimistic tasks can't be moved until the server has assigned their real id.
    disabled: temp,
  })

  return (
    <TaskContextMenu task={task}>
      <div
        ref={setNodeRef}
        data-task-id={task.id}
        data-status={task.status}
        data-selected={selected || undefined}
        style={{ transform: CSS.Translate.toString(transform), transition }}
        className={cn(
          'group/card relative rounded-md outline-none select-none',
          'focus-visible:ring-2 focus-visible:ring-ring/50',
          dragging ? 'cursor-grabbing' : 'cursor-default',
          temp && 'opacity-70',
        )}
        {...attributes}
        {...listeners}
        aria-roledescription="task card"
        aria-label={task.title}
        onClick={() => useUiStore.getState().selectTask(task.id)}
        onKeyDown={(e) => {
          onCardKeyDown(e, task.id)
          if (!e.defaultPrevented) listeners?.onKeyDown?.(e)
        }}
      >
        {/* Manual: the dragged card's slot is the drop placeholder. Sorted: a faded ghost. */}
        <div className={cn(isDragging && (manual ? 'invisible' : 'opacity-40'))}>
          <CardBody task={task} selected={selected} />
        </div>
        {isDragging && manual && (
          <div
            aria-hidden
            className="absolute inset-0 rounded-md border border-dashed border-primary/50 bg-selection"
          />
        )}
      </div>
    </TaskContextMenu>
  )
})
