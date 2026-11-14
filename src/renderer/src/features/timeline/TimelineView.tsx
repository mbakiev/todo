// Timeline (Gantt) view — spec §6. One scroll container: the left pane is `sticky left`,
// the header `sticky top`, so vertical scroll is shared and only the grid scrolls sideways.
// Rows are virtualized; the grid (day lines, weekend shading) is CSS backgrounds.
import { useVirtualizer } from '@tanstack/react-virtual'
import { AlertCircle, ChevronRight } from 'lucide-react'
import {
  memo,
  useCallback,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
} from 'react'
import type { LocalDate, Task, WeekStartsOn } from '@shared/types'
import { filterTimeline, isOverdue } from '@shared/views'
import { PriorityIcon, StatusIcon, TaskContextMenu } from '@/components/task'
import { useToday } from '@/lib/useToday'
import { cn } from '@/lib/utils'
import { useFilteredTasks, useIsFilterActive, useSettings } from '@/stores/selectors'
import { useTasksStore } from '@/stores/tasksStore'
import { useUiStore } from '@/stores/uiStore'
import { TimelineBar } from './TimelineBar'
import { HEADER_H, TimelineHeader } from './TimelineHeader'
import { TimelineToolbar } from './TimelineToolbar'
import {
  barRect,
  buildTimelineRange,
  DAY_WIDTH,
  dateToX,
  monthStarts,
  rangeDays,
  scrollLeftFor,
  weekendOffsetDays,
  weekStartOffsetDays,
  type DateRange,
  type DragMode,
  type TaskDates,
  type Zoom,
} from './timelineGeometry'
import { buildTimelineRows, type TimelineRow } from './timelineRows'
import { useBarDrag, type DragPreview } from './useBarDrag'
import { useTimelineViewStore } from './timelineViewStore'

const LEFT_W = 260
const ROW_H = 32
const GROUP_ROW_H = 30

/** Grid background: weekend shading + day/week lines as repeating CSS gradients. */
function gridStyle(range: DateRange, zoom: Zoom, weekStartsOn: WeekStartsOn): CSSProperties {
  const dw = DAY_WIDTH[zoom]
  const line = 'var(--grid-line)'
  const layers: string[] = []
  const sizes: string[] = []
  const positions: string[] = []
  if (zoom === 'day') {
    layers.push(`linear-gradient(to right, ${line} 0 1px, transparent 1px)`)
    sizes.push(`${dw}px 100%`)
    positions.push('0 0')
  }
  if (zoom === 'day' || zoom === 'week') {
    layers.push(`linear-gradient(to right, ${line} 0 1px, transparent 1px)`)
    sizes.push(`${dw * 7}px 100%`)
    positions.push(`${weekStartOffsetDays(range.start, weekStartsOn) * dw}px 0`)
    layers.push(`linear-gradient(to right, var(--weekend) 0 ${dw * 2}px, transparent ${dw * 2}px)`)
    sizes.push(`${dw * 7}px 100%`)
    positions.push(`${weekendOffsetDays(range.start) * dw}px 0`)
  }
  return {
    backgroundImage: layers.join(', ') || undefined,
    backgroundSize: sizes.join(', ') || undefined,
    backgroundPosition: positions.join(', ') || undefined,
    backgroundRepeat: 'repeat-x',
  }
}

export function TimelineView() {
  const tasks = useFilteredTasks()
  const filterActive = useIsFilterActive()
  const today = useToday()
  const { weekStartsOn } = useSettings()
  const selectedTaskId = useUiStore((s) => s.selectedTaskId)

  const zoom = useTimelineViewStore((s) => s.zoom)
  const setZoomState = useTimelineViewStore((s) => s.setZoom)
  const groupBy = useTimelineViewStore((s) => s.groupBy)
  const setGroupBy = useTimelineViewStore((s) => s.setGroupBy)
  const showCompleted = useTimelineViewStore((s) => s.showCompleted)
  const setShowCompleted = useTimelineViewStore((s) => s.setShowCompleted)
  const collapsed = useTimelineViewStore((s) => s.collapsed)
  const toggleGroup = useTimelineViewStore((s) => s.toggleCollapsed)
  const [hoveredId, setHoveredId] = useState<string | null>(null)

  const scrollRef = useRef<HTMLDivElement>(null)
  const [viewport, setViewport] = useState({ width: 0, height: 0 })
  useLayoutEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const measure = (): void => setViewport({ width: el.clientWidth, height: el.clientHeight })
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const timelineTasks = useMemo(
    () => filterTimeline(tasks, { showCompleted }),
    [tasks, showCompleted],
  )
  const rows = useMemo(
    () => buildTimelineRows(timelineTasks, groupBy, collapsed),
    [timelineTasks, groupBy, collapsed],
  )

  const dw = DAY_WIDTH[zoom]
  const range = useMemo(
    () =>
      buildTimelineRange(timelineTasks, today, {
        padDays: zoom === 'month' ? 45 : 14,
        minDays: Math.ceil(Math.max(0, viewport.width - LEFT_W) / dw) + 7,
      }),
    [timelineTasks, today, zoom, dw, viewport.width],
  )
  const gridWidth = rangeDays(range) * dw

  const commit = useCallback((taskId: string, patch: Partial<TaskDates>) => {
    void useTasksStore.getState().update(taskId, patch)
  }, [])
  const { preview, onPointerDown, consumeClick } = useBarDrag({
    scrollRef,
    range,
    dayWidth: dw,
    leftPaneWidth: LEFT_W,
    onCommit: commit,
  })

  // The virtualizer is read fresh every render (its items depend on scroll state).
  // eslint-disable-next-line react-hooks/incompatible-library
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: (i) => (rows[i]?.kind === 'group' ? GROUP_ROW_H : ROW_H),
    getItemKey: (i) => {
      const r = rows[i]
      return r === undefined ? i : r.kind === 'group' ? r.key : r.task.id
    },
    overscan: 12,
    scrollPaddingStart: HEADER_H,
  })
  const items = virtualizer.getVirtualItems()
  const bodyHeight = Math.max(virtualizer.getTotalSize(), viewport.height - HEADER_H - 1)

  // Scroll position: today near the left edge on first render; across zoom changes keep
  // the date at the left edge where it was.
  const leftDay = useRef<number | null>(null)
  const lastZoom = useRef<Zoom | null>(null)
  useLayoutEffect(() => {
    const el = scrollRef.current
    if (!el) return
    if (lastZoom.current === null) {
      el.scrollLeft = scrollLeftFor(today, range, zoom)
    } else if (lastZoom.current !== zoom && leftDay.current !== null) {
      el.scrollLeft = leftDay.current * dw
    }
    lastZoom.current = zoom
    // `range` / `today` only matter for the very first positioning.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [zoom, dw])

  const setZoom = useCallback(
    (next: Zoom) => {
      const el = scrollRef.current
      if (el) leftDay.current = el.scrollLeft / DAY_WIDTH[zoom]
      setZoomState(next)
    },
    [zoom, setZoomState],
  )

  const scrollToToday = useCallback(() => {
    scrollRef.current?.scrollTo({ left: scrollLeftFor(today, range, zoom), behavior: 'smooth' })
  }, [today, range, zoom])

  const onRowClick = useCallback(
    (taskId: string) => {
      if (consumeClick()) return
      useUiStore.getState().selectTask(taskId)
    },
    [consumeClick],
  )

  const todayX = dateToX(today, range.start, dw)
  const months = useMemo(() => monthStarts(range), [range])
  const background = useMemo(
    () => gridStyle(range, zoom, weekStartsOn),
    [range, zoom, weekStartsOn],
  )

  const empty = timelineTasks.length === 0

  return (
    <div className="relative h-full" data-testid="timeline-view" data-current-zoom={zoom}>
      <TimelineToolbar
        zoom={zoom}
        onZoom={setZoom}
        onToday={scrollToToday}
        groupBy={groupBy}
        onGroupBy={setGroupBy}
        showCompleted={showCompleted}
        onShowCompleted={setShowCompleted}
      />
      <div
        ref={scrollRef}
        className="h-full scrollbar-thin overflow-auto overscroll-none"
        onScroll={(e) => {
          leftDay.current = e.currentTarget.scrollLeft / dw
        }}
        style={
          {
            '--grid-line': 'color-mix(in oklab, var(--border) 55%, transparent)',
            '--weekend': 'color-mix(in oklab, var(--muted) 45%, transparent)',
          } as CSSProperties
        }
      >
        <div style={{ width: LEFT_W + gridWidth }}>
          <TimelineHeader
            range={range}
            zoom={zoom}
            today={today}
            weekStartsOn={weekStartsOn}
            leftPaneWidth={LEFT_W}
            corner={
              <span className="text-[11px] font-medium text-muted-foreground">
                {timelineTasks.length} {timelineTasks.length === 1 ? 'task' : 'tasks'}
              </span>
            }
          />
          <div className="relative flex" style={{ height: bodyHeight }}>
            {/* Left pane */}
            <div
              className="sticky left-0 z-10 shrink-0 border-r bg-background"
              style={{ width: LEFT_W }}
              data-testid="timeline-left-pane"
            >
              {items.map((vi) => {
                const row = rows[vi.index]
                if (!row) return null
                return (
                  <div
                    key={vi.key}
                    className="absolute inset-x-0"
                    style={{ top: vi.start, height: vi.size }}
                  >
                    {row.kind === 'group' ? (
                      <GroupLabel row={row} onToggle={toggleGroup} />
                    ) : (
                      <TaskLabel
                        task={row.task}
                        selected={row.task.id === selectedTaskId}
                        hovered={row.task.id === hoveredId}
                        today={today}
                        onClick={onRowClick}
                        onHover={setHoveredId}
                      />
                    )}
                  </div>
                )
              })}
            </div>

            {/* Grid */}
            <div className="relative shrink-0" style={{ width: gridWidth }}>
              <div aria-hidden className="absolute inset-0" style={background} />
              {months.map((m) => (
                <div
                  key={m}
                  aria-hidden
                  className="absolute inset-y-0 w-px bg-border"
                  style={{ left: dateToX(m, range.start, dw) }}
                />
              ))}
              {zoom === 'day' && (
                <div
                  aria-hidden
                  className="absolute inset-y-0 bg-primary/[0.05]"
                  style={{ left: todayX, width: dw }}
                />
              )}
              <div
                aria-hidden
                data-testid="timeline-today-line"
                data-date={today}
                className="pointer-events-none absolute inset-y-0 w-px bg-primary/80"
                style={{ left: todayX + dw / 2 }}
              />
              {items.map((vi) => {
                const row = rows[vi.index]
                if (!row) return null
                return (
                  <div
                    key={vi.key}
                    className="absolute inset-x-0"
                    style={{ top: vi.start, height: vi.size }}
                  >
                    {row.kind === 'group' ? (
                      <div className="h-full border-b border-border/50 bg-muted/40" />
                    ) : (
                      <GridRow
                        task={row.task}
                        range={range}
                        zoom={zoom}
                        today={today}
                        selected={row.task.id === selectedTaskId}
                        hovered={row.task.id === hoveredId}
                        preview={preview?.taskId === row.task.id ? preview : null}
                        onClick={onRowClick}
                        onHover={setHoveredId}
                        onBarPointerDown={onPointerDown}
                      />
                    )}
                  </div>
                )
              })}
            </div>
          </div>
        </div>
      </div>
      {empty && (
        <p className="pointer-events-none absolute inset-x-0 top-1/2 text-center text-[13px] text-muted-foreground">
          {filterActive
            ? 'No dated tasks match the current filters.'
            : 'Tasks with a start or due date show up here.'}
        </p>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Rows
// ---------------------------------------------------------------------------

const GroupLabel = memo(function GroupLabel({
  row,
  onToggle,
}: {
  row: Extract<TimelineRow, { kind: 'group' }>
  onToggle(key: string): void
}) {
  return (
    <button
      type="button"
      data-group={row.key}
      aria-expanded={!row.collapsed}
      onClick={() => onToggle(row.key)}
      className="flex h-full w-full items-center gap-1.5 border-b border-border/50 bg-muted/40 px-2 text-left text-xs font-medium text-foreground/80 outline-none hover:bg-muted/70 focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:ring-inset"
    >
      <ChevronRight
        className={cn(
          'size-3.5 shrink-0 text-muted-foreground transition-transform duration-150',
          !row.collapsed && 'rotate-90',
        )}
      />
      {row.status !== undefined && <StatusIcon status={row.status} />}
      {row.priority !== undefined && <PriorityIcon priority={row.priority} />}
      <span className="truncate">{row.label}</span>
      <span className="text-[11px] font-normal text-muted-foreground tabular-nums">
        {row.count}
      </span>
    </button>
  )
})

interface RowHandlers {
  onClick(taskId: string): void
  onHover(taskId: string | null): void
}

const TaskLabel = memo(function TaskLabel({
  task,
  selected,
  hovered,
  today,
  onClick,
  onHover,
}: { task: Task; selected: boolean; hovered: boolean; today: LocalDate } & RowHandlers) {
  const done = task.status === 'done'
  // Same overdue look as the calendar: red title + small alert icon (the bar is red-outlined).
  const overdue = isOverdue(task, today)
  return (
    <TaskContextMenu task={task}>
      <div
        data-task-id={task.id}
        data-selected={selected || undefined}
        onClick={() => onClick(task.id)}
        onPointerEnter={() => onHover(task.id)}
        onPointerLeave={() => onHover(null)}
        className={cn(
          'flex h-full cursor-default items-center gap-2 border-b border-border/40 px-3 text-[13px]',
          hovered && !selected && 'bg-muted/50',
          selected && 'bg-selection',
        )}
      >
        <StatusIcon status={task.status} />
        <span
          className={cn(
            'min-w-0 flex-1 truncate',
            done && 'text-muted-foreground',
            overdue && 'text-overdue',
          )}
        >
          {task.title}
        </span>
        {overdue && (
          <AlertCircle aria-label="Overdue" role="img" className="size-3 shrink-0 text-overdue" />
        )}
        <PriorityIcon priority={task.priority} />
      </div>
    </TaskContextMenu>
  )
})

const GridRow = memo(function GridRow({
  task,
  range,
  zoom,
  today,
  selected,
  hovered,
  preview,
  onClick,
  onHover,
  onBarPointerDown,
}: {
  task: Task
  range: DateRange
  zoom: Zoom
  today: LocalDate
  selected: boolean
  hovered: boolean
  preview: DragPreview | null
  onBarPointerDown(e: ReactPointerEvent, task: Task, mode: DragMode): void
} & RowHandlers) {
  const dates = preview?.dates ?? task
  const rect = barRect(dates, range, DAY_WIDTH[zoom])
  const overdue = isOverdue({ status: task.status, dueDate: dates.dueDate }, today)
  return (
    <TaskContextMenu task={task}>
      <div
        data-row-id={task.id}
        onClick={() => onClick(task.id)}
        onPointerEnter={() => onHover(task.id)}
        onPointerLeave={() => onHover(null)}
        className={cn(
          'relative h-full border-b border-border/40',
          hovered && !selected && 'bg-muted/30',
          selected && 'bg-selection',
        )}
      >
        {rect && (
          <TimelineBar
            task={task}
            rect={rect}
            today={today}
            overdue={overdue}
            selected={selected}
            dragging={preview ? preview.mode : null}
            stickyLeft={LEFT_W}
            onPointerDown={onBarPointerDown}
          />
        )}
      </div>
    </TaskContextMenu>
  )
})
