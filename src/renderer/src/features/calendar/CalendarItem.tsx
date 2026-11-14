// A task rendered in the month grid: a bar (start → due) or a single-day chip.
import { useDraggable } from '@dnd-kit/core'
import { AlertCircle } from 'lucide-react'
import type { CSSProperties } from 'react'
import type { LocalDate, Priority, Task } from '@shared/types'
import { isOverdue } from '@shared/views'
import { TaskContextMenu } from '@/components/task'
import { cn } from '@/lib/utils'
import type { WeekSegment } from './calendarLayout'

const BAR_CLASS: Record<Priority, string> = {
  1: 'bg-priority-low/15 border-priority-low',
  2: 'bg-priority-medium/15 border-priority-medium',
  3: 'bg-priority-high/20 border-priority-high',
  4: 'bg-priority-critical/15 border-priority-critical',
}
const DOT_CLASS: Record<Priority, string> = {
  1: 'bg-priority-low',
  2: 'bg-priority-medium',
  3: 'bg-priority-high',
  4: 'bg-priority-critical',
}

export interface ItemLookProps {
  task: Task
  kind: 'bar' | 'chip'
  today: LocalDate
  continuesBefore?: boolean
  continuesAfter?: boolean
  className?: string
}

/** Pure visual (shared by grid items, the drag overlay and the "+N more" popover). */
export function ItemLook({
  task,
  kind,
  today,
  continuesBefore = false,
  continuesAfter = false,
  className,
}: ItemLookProps) {
  // Colour rule (shared with the timeline): fill / dot colour follows priority only; overdue
  // is red title text plus a small alert icon, so it never reads as "critical".
  const overdue = isOverdue(task, today)
  const done = task.status === 'done'
  const alert = overdue && (
    <AlertCircle aria-label="Overdue" role="img" className="size-3 shrink-0 text-overdue" />
  )
  if (kind === 'bar') {
    return (
      <span
        className={cn(
          'flex h-full w-full min-w-0 items-center gap-1 px-1.5 text-[12px] leading-none font-medium text-foreground',
          BAR_CLASS[task.priority],
          overdue && 'text-overdue',
          !continuesBefore && 'rounded-l-[4px] border-l-[3px]',
          !continuesAfter && 'rounded-r-[4px]',
          done && 'opacity-50',
          className,
        )}
      >
        {alert}
        <span className={cn('truncate', done && 'line-through')}>{task.title}</span>
      </span>
    )
  }
  return (
    <span
      className={cn(
        'flex h-full w-full min-w-0 items-center gap-1.5 rounded-[4px] px-1.5 text-[12px] leading-none',
        'hover:bg-muted',
        overdue && 'text-overdue',
        done && 'text-muted-foreground opacity-60',
        className,
      )}
    >
      <span className={cn('size-1.5 shrink-0 rounded-full', DOT_CLASS[task.priority])} />
      <span className={cn('truncate', done && 'line-through')}>{task.title}</span>
      {alert}
    </span>
  )
}

export interface DragData {
  taskId: string
}

export interface CalendarItemProps {
  piece: WeekSegment
  weekStart: LocalDate
  today: LocalDate
  /** True while any piece of this task is being dragged. */
  dimmed: boolean
  style: CSSProperties
  onOpen(taskId: string): void
}

export function CalendarItem({
  piece,
  weekStart,
  today,
  dimmed,
  style,
  onOpen,
}: CalendarItemProps) {
  const { task } = piece
  const { attributes, listeners, setNodeRef } = useDraggable({
    id: `${task.id}|${weekStart}|${piece.startCol}`,
    data: { taskId: task.id } satisfies DragData,
  })
  return (
    <TaskContextMenu task={task}>
      <button
        ref={setNodeRef}
        type="button"
        data-task-id={task.id}
        data-kind={piece.kind}
        {...attributes}
        {...listeners}
        aria-label={task.title}
        onClick={() => onOpen(task.id)}
        className={cn(
          'pointer-events-auto absolute flex cursor-default outline-none focus-visible:ring-2 focus-visible:ring-ring/60',
          piece.kind === 'chip' ? 'rounded-[4px]' : '',
          dimmed && 'opacity-30',
        )}
        style={style}
        title={task.title}
      >
        <ItemLook
          task={task}
          kind={piece.kind}
          today={today}
          continuesBefore={piece.continuesBefore}
          continuesAfter={piece.continuesAfter}
        />
      </button>
    </TaskContextMenu>
  )
}
