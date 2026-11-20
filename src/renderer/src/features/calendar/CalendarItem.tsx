// A task rendered in the month grid: a bar (multi-day display span) or a single-day chip.
// not_started tasks show their plan and drag to reschedule it; started and done tasks show
// what really happened (`displaySpan` source 'actual') and do not drag.
import { useDraggable } from '@dnd-kit/core'
import { AlertCircle } from 'lucide-react'
import type { CSSProperties } from 'react'
import type { LocalDate, Priority, Task } from '@shared/types'
import { isOverdue } from '@shared/views'
import { StatusIcon, TaskContextMenu } from '@/components/task'
import { cn } from '@/lib/utils'
import { useUiStore } from '@/stores/uiStore'
import { itemTitle, type WeekSegment } from './calendarLayout'

const BAR_BORDER: Record<Priority, string> = {
  1: 'border-priority-low',
  2: 'border-priority-medium',
  3: 'border-priority-high',
  4: 'border-priority-critical',
}
const BAR_FILL: Record<Priority, string> = {
  1: 'bg-priority-low/15',
  2: 'bg-priority-medium/15',
  3: 'bg-priority-high/20',
  4: 'bg-priority-critical/15',
}
/** Planned remainder of an ongoing bar (after today, up to its due date): faint, dashed. */
const REMAINDER_CLASS: Record<Priority, string> = {
  1: 'bg-priority-low/5 border-priority-low/50',
  2: 'bg-priority-medium/5 border-priority-medium/50',
  3: 'bg-priority-high/[0.07] border-priority-high/50',
  4: 'bg-priority-critical/5 border-priority-critical/50',
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
  /**
   * Ongoing bars: share (0 … 1) of the bar on or before today. The rest is the planned
   * remainder, drawn lighter and never hatched. Omitted = all elapsed / not ongoing.
   */
  elapsedFraction?: number
  className?: string
}

/** Pure visual (shared by grid items, the drag overlay and the "+N more" popover). */
export function ItemLook({
  task,
  kind,
  today,
  continuesBefore = false,
  continuesAfter = false,
  elapsedFraction = 1,
  className,
}: ItemLookProps) {
  // Colour rule (shared with the timeline): fill / dot colour follows priority only; overdue
  // is red title text plus a small alert icon, so it never reads as "critical".
  const overdue = isOverdue(task, today)
  const done = task.status === 'done'
  // Blocked = started but stalled: a hatch over the bar plus the status icon on every shape,
  // so it reads as pending without relying on colour.
  const blocked = task.status === 'blocked'
  const alert = overdue && (
    <AlertCircle aria-label="Overdue" role="img" className="size-3 shrink-0 text-overdue" />
  )
  const blockedIcon = blocked && (
    <StatusIcon status="blocked" role="img" className="size-3" data-blocked-marker="" />
  )
  if (kind === 'bar') {
    const elapsed = Math.min(1, Math.max(0, elapsedFraction))
    const pct = `${elapsed * 100}%`
    return (
      <span
        className={cn(
          'relative isolate flex h-full w-full min-w-0 items-center gap-1 overflow-hidden px-1.5 text-[12px] leading-none font-medium text-foreground',
          BAR_BORDER[task.priority],
          overdue && 'text-overdue',
          !continuesBefore && 'rounded-l-[4px] border-l-[3px]',
          !continuesAfter && 'rounded-r-[4px]',
          done && 'opacity-50',
          className,
        )}
      >
        {/* Elapsed part (on / before today): the normal fill, hatched when blocked. */}
        {elapsed > 0 && (
          <span
            aria-hidden
            data-bar-elapsed=""
            className={cn('absolute inset-y-0 left-0 -z-10', BAR_FILL[task.priority])}
            style={{ width: pct }}
          >
            {blocked && <span data-bar-hatch="" className="bg-hatch absolute inset-0" />}
          </span>
        )}
        {/* Planned remainder (after today): lighter, dashed top / bottom, no hatch. */}
        {elapsed < 1 && (
          <span
            aria-hidden
            data-bar-remainder=""
            className={cn(
              'absolute inset-y-0 right-0 -z-10 border-y border-dashed',
              REMAINDER_CLASS[task.priority],
              !continuesAfter && 'rounded-r-[4px]',
            )}
            style={{ left: pct }}
          />
        )}
        {blockedIcon}
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
      {blockedIcon}
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
  const selected = useUiStore((s) => s.selectedTaskId === task.id)
  // Dragging edits the plan, so only a planned (not_started) item drags.
  const draggable = piece.source === 'planned'
  const { attributes, listeners, setNodeRef } = useDraggable({
    id: `${task.id}|${weekStart}|${piece.startCol}`,
    data: { taskId: task.id } satisfies DragData,
    disabled: !draggable,
  })
  // dnd-kit returns its keyboard / a11y attributes (aria-roledescription="draggable",
  // aria-describedby drag instructions) even when disabled; only a draggable item gets them.
  return (
    <TaskContextMenu task={task}>
      <button
        ref={setNodeRef}
        type="button"
        data-task-id={task.id}
        data-kind={piece.kind}
        data-status={task.status}
        data-source={piece.source}
        data-ongoing={piece.ongoing}
        data-elapsed-cols={piece.elapsedCols ?? undefined}
        data-selected={selected || undefined}
        {...(draggable ? attributes : {})}
        {...(draggable ? listeners : {})}
        aria-label={task.title}
        onClick={() => onOpen(task.id)}
        className={cn(
          'pointer-events-auto absolute flex cursor-default outline-none focus-visible:ring-2 focus-visible:ring-ring/60',
          piece.kind === 'chip' ? 'rounded-[4px]' : '',
          // Selected (detail panel open) looks the same as on board cards and timeline bars.
          selected && 'rounded-[4px] ring-2 ring-primary/70',
          dimmed && 'opacity-30',
        )}
        style={style}
        title={itemTitle(task, today)}
      >
        <ItemLook
          task={task}
          kind={piece.kind}
          today={today}
          continuesBefore={piece.continuesBefore}
          continuesAfter={piece.continuesAfter}
          elapsedFraction={
            piece.elapsedCols === null
              ? undefined
              : piece.elapsedCols / (piece.endCol - piece.startCol + 1)
          }
        />
      </button>
    </TaskContextMenu>
  )
}
