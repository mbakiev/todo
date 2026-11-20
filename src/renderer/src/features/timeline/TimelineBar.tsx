import { ChevronLeft } from 'lucide-react'
import { memo, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from 'react'
import { formatShortDate } from '@shared/dates'
import type { LocalDate, Priority, Task } from '@shared/types'
import { dateBadge, describeProgress } from '@shared/views'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import { measureLabel } from './measureText'
import {
  dragModes,
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
 * Soft, opaque priority fills (mixed into the background so grid lines and the today line
 * do not show through). Open work is the strongest; the planned remainder of an ongoing bar
 * (after today, up to its due date) is faint; done history is quieter than open work but
 * still clearly coloured.
 */
// The bar's own fill hovers with `hover:`; segments inside it with `group-hover/bar:`.
const FILL_PLANNED =
  'bg-[color-mix(in_oklab,var(--bar)_20%,var(--background))] hover:bg-[color-mix(in_oklab,var(--bar)_30%,var(--background))]'
const FILL_ELAPSED =
  'bg-[color-mix(in_oklab,var(--bar)_28%,var(--background))] hover:bg-[color-mix(in_oklab,var(--bar)_38%,var(--background))]'
const FILL_DONE =
  'bg-[color-mix(in_oklab,var(--bar)_12%,var(--background))] hover:bg-[color-mix(in_oklab,var(--bar)_20%,var(--background))]'
const SEGMENT_ELAPSED =
  'bg-[color-mix(in_oklab,var(--bar)_28%,var(--background))] group-hover/bar:bg-[color-mix(in_oklab,var(--bar)_38%,var(--background))]'
const SEGMENT_REMAINDER =
  'bg-[color-mix(in_oklab,var(--bar)_7%,var(--background))] group-hover/bar:bg-[color-mix(in_oklab,var(--bar)_13%,var(--background))]'

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

/** The word before a pre-range stub's real date ("· due Oct 2"). */
function stubWord(task: Task): string {
  if (task.status === 'done') return 'done'
  return task.dueDate ? 'due' : 'from'
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
  const blocked = task.status === 'blocked'
  const started = rect.source === 'actual'
  const pinnedLeft = rect.clampedStart
  const flatRight = rect.clampedEnd || rect.openEnded
  const chevron = pinnedLeft ? CHEVRON_W : 0
  const modes = dragModes(task.status)

  // Pre-range stubs append their real date so the clamp never hides how late they are. (An
  // ongoing bar always reaches today, so it is pinned at worst, never a stub.)
  const realDate = rect.span.end
  const stubText = `${stubWord(task)} ${formatShortDate(realDate, today)}`
  const label = rect.beforeRange ? `${task.title} · ${stubText}` : task.title
  const inside = measureLabel(label) + LABEL_PAD * 2 + chevron <= rect.width

  const handle = rect.width >= 28 ? 7 : rect.width >= 14 ? 4 : 0
  const showStartHandle = handle > 0 && !pinnedLeft && modes.includes('start')
  const showEndHandle = handle > 0 && !rect.clampedEnd && modes.includes('end')

  // Ongoing bar with a planned remainder after today (a future due date): the elapsed part
  // is solid, the remainder faint with a dashed outline. Drawn as two segments.
  const elapsed = rect.elapsedWidth ?? rect.width
  const split = rect.ongoing && elapsed < rect.width

  const days = spanDays(rect.span)
  // A start-only task reads "Starts <date>" (shared rule with cards and the calendar).
  const startBadge = dateBadge(task)
  // Record first for started / done tasks; computed on open so elapsed time is current.
  const progress = started && tipOpen ? describeProgress(task, today) : []
  // A stub for a task entirely before the range follows the visible left edge of the grid,
  // so long-overdue work stays in sight however far the chart is scrolled.
  const sticky = rect.beforeRange

  const borderColor = overdue
    ? 'var(--overdue)'
    : `color-mix(in oklab, var(--bar) ${done ? 35 : 55}%, transparent)`
  const fill = done ? FILL_DONE : started ? FILL_ELAPSED : FILL_PLANNED

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
            data-status={task.status}
            data-source={rect.source}
            data-ongoing={rect.ongoing || undefined}
            data-open-ended={rect.openEnded || undefined}
            data-clamped={pinnedLeft ? (rect.beforeRange ? 'before' : 'start') : undefined}
            data-overdue={overdue || undefined}
            data-selected={selected || undefined}
            data-dragging={dragging ?? undefined}
            onPointerDown={(e) => onPointerDown(e, task, 'move')}
            className={cn(
              'pointer-events-auto',
              // overflow-clip, not -hidden: it clips the same but is no scroll container, so the
              // label below can stick to the grid's visible left edge.
              'group/bar absolute top-1.5 flex h-5 items-center overflow-clip text-xs font-medium select-none',
              done ? 'text-foreground/75' : 'text-foreground',
              modes.includes('move') ? 'cursor-grab' : 'cursor-default',
              'transition-[background-color,box-shadow] duration-100',
              split ? 'border-0' : ['border', fill],
              pinnedLeft ? 'rounded-r-[5px] border-l-0' : 'rounded-[5px]',
              flatRight && 'rounded-r-none border-r-0',
              overdue && 'ring-1 ring-overdue/40',
              selected && 'ring-2 ring-primary/70',
              dragging !== null && 'z-10 shadow-md',
              dragging === 'move' && 'cursor-grabbing',
            )}
            style={
              {
                left: rect.left,
                width: rect.width,
                '--bar': BAR_COLOR[task.priority],
                borderColor,
              } as CSSProperties
            }
          >
            {split && (
              <>
                <span
                  aria-hidden
                  data-testid="timeline-bar-elapsed"
                  className={cn(
                    'pointer-events-none absolute inset-y-0 left-0 border-y transition-[background-color] duration-100',
                    SEGMENT_ELAPSED,
                    pinnedLeft ? 'border-l-0' : 'rounded-l-[5px] border-l',
                  )}
                  style={{ width: elapsed, borderColor }}
                />
                <span
                  aria-hidden
                  data-testid="timeline-bar-remainder"
                  className={cn(
                    'pointer-events-none absolute inset-y-0 right-0 border-y border-dashed transition-[background-color] duration-100',
                    SEGMENT_REMAINDER,
                    !rect.clampedEnd && 'rounded-r-[5px] border-r',
                  )}
                  style={{ left: elapsed, borderColor }}
                />
              </>
            )}
            {blocked && (
              // Started but stalled: hatched over the elapsed part, readable without colour.
              <span
                aria-hidden
                data-testid="timeline-bar-hatch"
                className="bg-hatch pointer-events-none absolute inset-y-0 left-0"
                style={{ width: elapsed }}
              />
            )}
            {pinnedLeft && (
              <ChevronLeft
                aria-hidden
                strokeWidth={2.5}
                className={cn(
                  'relative ml-0.5 size-3 shrink-0',
                  overdue ? 'text-overdue' : 'text-muted-foreground',
                )}
              />
            )}
            {inside && (
              // Sticky: when the bar's start is scrolled under the left pane, the label stays
              // in the visible part of the bar until the bar's end pushes it out.
              <span
                data-testid="timeline-bar-label"
                className="sticky min-w-0 truncate"
                style={{
                  left: stickyLeft,
                  paddingLeft: pinnedLeft ? 2 : LABEL_PAD,
                  paddingRight: LABEL_PAD,
                }}
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
          {started ? (
            progress.map((line) => (
              <div key={line} className="mt-0.5 tabular-nums opacity-75">
                {line}
              </div>
            ))
          ) : (
            <>
              <div className="mt-0.5 tabular-nums opacity-75">
                {startBadge?.kind === 'start'
                  ? `Starts ${formatShortDate(startBadge.date, today)}`
                  : `${formatSpan(rect.span, today)} · ${formatDuration(days)}`}
              </div>
              {overdue && (
                <div className="mt-0.5 opacity-75">
                  Overdue · was due {formatShortDate(realDate, today)}
                </div>
              )}
            </>
          )}
        </TooltipContent>
      </Tooltip>
      {dragging !== null ? (
        <span
          data-testid="timeline-drag-label"
          className="pointer-events-none absolute top-1.5 z-20 flex h-5 items-center rounded-[5px] bg-foreground px-1.5 text-[11px] font-medium whitespace-nowrap text-background tabular-nums shadow-sm"
          style={{ left: rect.left + rect.width + 6 }}
        >
          {started
            ? `Due ${formatShortDate(rect.span.end, today)}`
            : `${formatSpan(rect.span, today)} · ${formatDuration(days)}`}
        </span>
      ) : (
        !inside && (
          <span
            className="pointer-events-none absolute top-1.5 flex h-5 max-w-80 items-center truncate text-xs whitespace-nowrap text-muted-foreground"
            style={{ left: rect.left + rect.width + 6 }}
          >
            {rect.beforeRange ? (
              <>
                <span className="truncate text-foreground/80">{task.title}</span>
                <span className={cn('ml-1.5 shrink-0', overdue && 'text-overdue')}>{stubText}</span>
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
