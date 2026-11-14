import { ChevronLeft } from 'lucide-react'
import { memo, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from 'react'
import { STATUS_LABELS } from '@shared/constants'
import { formatShortDate } from '@shared/dates'
import type { LocalDate, Priority, Task } from '@shared/types'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import { measureLabel } from './measureText'
import {
  formatDuration,
  formatSpan,
  spanDays,
  type BarRect,
  type DragMode,
} from './timelineGeometry'

/** Priority colour token per priority (spec §10). */
const BAR_COLOR: Record<Priority, string> = {
  1: 'var(--priority-low)',
  2: 'var(--priority-medium)',
  3: 'var(--priority-high)',
  4: 'var(--priority-critical)',
}

/**
 * Soft, opaque priority fill (mixed into the background so grid lines and the today line
 * do not show through) with a slightly stronger border; overdue swaps the border to red.
 */
const BAR_FILL =
  'bg-[color-mix(in_oklab,var(--bar)_20%,var(--background))] hover:bg-[color-mix(in_oklab,var(--bar)_30%,var(--background))]'

/** Horizontal padding inside the bar around the label. */
const LABEL_PAD = 8
const CHEVRON_W = 12

export interface TimelineBarProps {
  task: Task
  rect: BarRect
  today: LocalDate
  overdue: boolean
  selected: boolean
  dragging: DragMode | null
  /** Viewport x of the grid's visible left edge (width of the sticky left pane). */
  stickyLeft: number
  onPointerDown(e: ReactPointerEvent, task: Task, mode: DragMode): void
}

export const TimelineBar = memo(function TimelineBar({
  task,
  rect,
  today,
  overdue,
  selected,
  dragging,
  stickyLeft,
  onPointerDown,
}: TimelineBarProps) {
  const [tipOpen, setTipOpen] = useState(false)
  const done = task.status === 'done'
  const pinnedLeft = rect.clampedStart
  const chevron = pinnedLeft ? CHEVRON_W : 0

  // Pre-range tasks append their real date so the clamp never hides how late they are.
  const realDate = rect.span.end
  const label = rect.beforeRange
    ? `${task.title} · ${task.dueDate ? 'due' : 'from'} ${formatShortDate(realDate, today)}`
    : task.title
  const inside = measureLabel(label) + LABEL_PAD * 2 + chevron <= rect.width

  const handle = rect.width >= 28 ? 7 : rect.width >= 14 ? 4 : 0
  const showStartHandle = handle > 0 && !pinnedLeft
  const showEndHandle = handle > 0 && !rect.clampedEnd

  const days = spanDays(rect.span)
  // A stub for a task entirely before the range follows the visible left edge of the grid,
  // so long-overdue work stays in sight however far the chart is scrolled.
  const sticky = rect.beforeRange

  const content = (
    <>
      <Tooltip open={tipOpen && dragging === null} onOpenChange={setTipOpen} delayDuration={500}>
        <TooltipTrigger asChild>
          <div
            role="button"
            tabIndex={-1}
            aria-label={label}
            data-testid="timeline-bar"
            data-bar-id={task.id}
            data-start={rect.span.start}
            data-end={rect.span.end}
            data-clamped={pinnedLeft ? (rect.beforeRange ? 'before' : 'start') : undefined}
            data-overdue={overdue || undefined}
            data-selected={selected || undefined}
            data-dragging={dragging ?? undefined}
            onPointerDown={(e) => onPointerDown(e, task, 'move')}
            className={cn(
              'pointer-events-auto',
              'group/bar absolute top-1.5 flex h-5 items-center overflow-hidden border text-xs font-medium text-foreground select-none',
              'cursor-grab transition-[background-color,box-shadow] duration-100',
              BAR_FILL,
              pinnedLeft ? 'rounded-r-[5px] border-l-0' : 'rounded-[5px]',
              rect.clampedEnd && 'rounded-r-none border-r-0',
              overdue && 'ring-1 ring-overdue/40',
              done && 'opacity-45',
              selected && 'ring-2 ring-primary/70',
              dragging !== null && 'z-10 cursor-grabbing shadow-md',
            )}
            style={
              {
                left: rect.left,
                width: rect.width,
                '--bar': BAR_COLOR[task.priority],
                borderColor: overdue
                  ? 'var(--overdue)'
                  : 'color-mix(in oklab, var(--bar) 55%, transparent)',
              } as CSSProperties
            }
          >
            {pinnedLeft && (
              <ChevronLeft
                aria-hidden
                strokeWidth={2.5}
                className={cn(
                  'ml-0.5 size-3 shrink-0',
                  overdue ? 'text-overdue' : 'text-muted-foreground',
                )}
              />
            )}
            {inside && (
              <span
                className={cn('min-w-0 truncate', done && 'line-through')}
                style={{ paddingLeft: pinnedLeft ? 2 : LABEL_PAD, paddingRight: LABEL_PAD }}
              >
                {label}
              </span>
            )}
            {showStartHandle && (
              <span
                aria-hidden
                data-handle="start"
                onPointerDown={(e) => onPointerDown(e, task, 'start')}
                className="absolute inset-y-0 left-0 cursor-ew-resize after:absolute after:inset-y-1 after:left-0.5 after:w-0.5 after:rounded-full after:bg-foreground/30 after:opacity-0 group-hover/bar:after:opacity-100"
                style={{ width: handle }}
              />
            )}
            {showEndHandle && (
              <span
                aria-hidden
                data-handle="end"
                onPointerDown={(e) => onPointerDown(e, task, 'end')}
                className="absolute inset-y-0 right-0 cursor-ew-resize after:absolute after:inset-y-1 after:right-0.5 after:w-0.5 after:rounded-full after:bg-foreground/30 after:opacity-0 group-hover/bar:after:opacity-100"
                style={{ width: handle }}
              />
            )}
          </div>
        </TooltipTrigger>
        <TooltipContent side="top" className="max-w-72 px-2.5 py-1.5">
          <div className="font-medium">{task.title}</div>
          <div className="mt-0.5 tabular-nums opacity-75">
            {formatSpan(rect.span, today)} · {formatDuration(days)}
          </div>
          {(overdue || done) && (
            <div className="mt-0.5 opacity-75">
              {done ? STATUS_LABELS.done : `Overdue · was due ${formatShortDate(realDate, today)}`}
            </div>
          )}
        </TooltipContent>
      </Tooltip>
      {dragging !== null ? (
        <span
          data-testid="timeline-drag-label"
          className="pointer-events-none absolute top-1.5 z-20 flex h-5 items-center rounded-[5px] bg-foreground px-1.5 text-[11px] font-medium whitespace-nowrap text-background tabular-nums shadow-sm"
          style={{ left: rect.left + rect.width + 6 }}
        >
          {formatSpan(rect.span, today)} · {formatDuration(days)}
        </span>
      ) : (
        !inside && (
          <span
            className={cn(
              'pointer-events-none absolute top-1.5 flex h-5 max-w-80 items-center truncate text-xs whitespace-nowrap text-muted-foreground',
              done && 'line-through',
            )}
            style={{ left: rect.left + rect.width + 6 }}
          >
            {rect.beforeRange ? (
              <>
                <span className="truncate text-foreground/80">{task.title}</span>
                <span className={cn('ml-1.5 shrink-0', overdue && 'text-overdue')}>
                  {task.dueDate ? 'due' : 'from'} {formatShortDate(realDate, today)}
                </span>
              </>
            ) : (
              <span className="truncate">{task.title}</span>
            )}
          </span>
        )
      )}
    </>
  )
  if (!sticky) return content
  return (
    <div
      className="pointer-events-none sticky top-0 h-full"
      style={{ left: stickyLeft, width: rect.width + 6 + 320 }}
    >
      {content}
    </div>
  )
})
