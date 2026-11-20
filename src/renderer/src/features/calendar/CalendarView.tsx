// Calendar view (spec §6 "Calendar"): custom month grid with lane-packed bars and chips,
// "+N more" overflow popovers, drag-to-reschedule (dnd-kit) and click-to-create.
// Items are laid out by `displaySpan`: the plan for not_started tasks (these drag), the record
// for started / done tasks (started → today / due, or → completed; these do not drag).
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  pointerWithin,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
} from '@dnd-kit/core'
import { ChevronLeft, ChevronRight, CircleCheck } from 'lucide-react'
import { useCallback, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import {
  addDays,
  addMonths,
  diffDays,
  eachDay,
  formatShortDate,
  localDateToDate,
  maxDate,
  minDate,
  startOfMonth,
  weekdayShort,
} from '@shared/dates'
import type { LocalDate, Task } from '@shared/types'
import { dateBadge, displaySpan, filterCalendar, taskSpan, tasksInRange } from '@shared/views'
import { ToolbarButton, ToolbarControls } from '@/app/ToolbarControls'
import { StartDateBadge, TaskContextMenu } from '@/components/task'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { useToday } from '@/lib/useToday'
import { cn } from '@/lib/utils'
import { useFilteredTasks, useSettings } from '@/stores/selectors'
import { useTasksStore } from '@/stores/tasksStore'
import { useUiStore } from '@/stores/uiStore'
import {
  DAYS_PER_WEEK,
  fitWeek,
  itemTitle,
  layoutWeek,
  monthGridRange,
  monthGridWeeks,
  shiftTaskDates,
  weekDays,
} from './calendarLayout'
import { CalendarItem, ItemLook, type DragData } from './CalendarItem'
import { useCalendarViewStore } from './calendarViewStore'

/** Height of the day-number strip at the top of each cell. */
const DAY_HEADER = 26
/** Vertical pitch of one lane (item height + gap). */
const LANE = 22
const ITEM_HEIGHT = 20
const BOTTOM_PAD = 4

const monthLabelFormat = new Intl.DateTimeFormat(undefined, { month: 'long', year: 'numeric' })
const dayLabelFormat = new Intl.DateTimeFormat(undefined, {
  weekday: 'long',
  month: 'long',
  day: 'numeric',
})

const openTask = (id: string): void => useUiStore.getState().selectTask(id)

// --- toolbar -----------------------------------------------------------------------------

function CalendarToolbar({ month, today }: { month: LocalDate; today: LocalDate }) {
  const setMonth = useCalendarViewStore((s) => s.setMonth)
  const showCompleted = useCalendarViewStore((s) => s.showCompleted)
  const setShowCompleted = useCalendarViewStore((s) => s.setShowCompleted)
  const isCurrent = month === startOfMonth(today)
  return (
    <ToolbarControls>
      <div className="flex items-center gap-0.5">
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              className="size-7 p-0"
              aria-label="Previous month"
              onClick={() => setMonth(addMonths(month, -1))}
            >
              <ChevronLeft className="size-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Previous month</TooltipContent>
        </Tooltip>
        <Button
          variant="outline"
          size="sm"
          className="h-7 px-2.5 text-xs shadow-none"
          disabled={isCurrent}
          aria-label="Go to today"
          onClick={() => setMonth(null)}
        >
          Today
        </Button>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              className="size-7 p-0"
              aria-label="Next month"
              onClick={() => setMonth(addMonths(month, 1))}
            >
              <ChevronRight className="size-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Next month</TooltipContent>
        </Tooltip>
      </div>
      <span
        className="ml-1.5 min-w-30 text-[13px] font-medium whitespace-nowrap tabular-nums"
        data-testid="calendar-month-label"
      >
        {monthLabelFormat.format(localDateToDate(month))}
      </span>
      <ToolbarButton
        className="ml-1"
        icon={<CircleCheck className="size-3.5" />}
        label="Completed"
        hint={showCompleted ? 'Hide completed tasks' : 'Show completed tasks'}
        aria-pressed={showCompleted}
        aria-label="Show completed"
        active={showCompleted}
        onClick={() => setShowCompleted(!showCompleted)}
      />
    </ToolbarControls>
  )
}

// --- day cell ----------------------------------------------------------------------------

interface DayCellProps {
  date: LocalDate
  today: LocalDate
  inMonth: boolean
  highlighted: boolean
}

function DayCell({ date, today, inMonth, highlighted }: DayCellProps) {
  const { setNodeRef } = useDroppable({ id: date })
  const isToday = date === today
  const dayNum = Number(date.slice(8))
  const label =
    dayNum === 1
      ? `${new Intl.DateTimeFormat(undefined, { month: 'short' }).format(localDateToDate(date))} 1`
      : String(dayNum)
  return (
    <div
      ref={setNodeRef}
      data-date={date}
      data-in-month={inMonth || undefined}
      aria-current={isToday ? 'date' : undefined}
      aria-label={dayLabelFormat.format(localDateToDate(date))}
      onClick={() => useUiStore.getState().openNewTaskDialog({ dueDate: date })}
      className={cn(
        'relative min-w-0 border-r border-border/70 transition-colors last:border-r-0',
        !inMonth && 'bg-muted/40 dark:bg-muted/35',
        'hover:bg-muted/30',
        highlighted && 'bg-selection hover:bg-selection',
      )}
    >
      <div className="flex h-[26px] items-center justify-end px-1.5">
        <span
          className={cn(
            'flex h-5 min-w-5 items-center justify-center rounded-full px-1 text-[12px] tabular-nums',
            inMonth ? 'text-foreground/80' : 'text-muted-foreground/60',
            dayNum === 1 && 'font-medium',
            isToday && 'bg-primary font-semibold text-primary-foreground',
          )}
        >
          {label}
        </span>
      </div>
    </div>
  )
}

// --- "+N more" ---------------------------------------------------------------------------

function MorePopover({
  date,
  hidden,
  tasks,
  today,
  style,
}: {
  date: LocalDate
  hidden: number
  tasks: Task[]
  today: LocalDate
  style: CSSProperties
}) {
  const [open, setOpen] = useState(false)
  const selectedTaskId = useUiStore((s) => s.selectedTaskId)
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          data-more={date}
          aria-label={`${hidden} more tasks`}
          className="pointer-events-auto absolute flex items-center overflow-hidden rounded-[4px] px-1.5 text-[11px] font-medium whitespace-nowrap text-muted-foreground outline-none hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/60"
          style={style}
        >
          +{hidden} more
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-64 p-1.5" data-testid="calendar-more-popover">
        <div className="px-1.5 pt-0.5 pb-1.5 text-xs font-medium text-muted-foreground">
          {dayLabelFormat.format(localDateToDate(date))}
        </div>
        <ul className="flex max-h-72 scrollbar-thin flex-col gap-0.5 overflow-y-auto">
          {tasks.map((t) => {
            const span = displaySpan(t, today)
            const kind = span && span.start !== span.end ? 'bar' : 'chip'
            // Planned items keep the plan badge ("Starts <date>" for start-only); started and
            // done items say when they really started / finished instead.
            const badge = span?.source === 'actual' ? null : dateBadge(t)
            const record =
              span?.source !== 'actual'
                ? null
                : span.ongoing
                  ? `Started ${formatShortDate(span.start, today)}`
                  : `Done ${formatShortDate(span.end, today)}`
            return (
              <li key={t.id} className="h-6">
                <TaskContextMenu task={t}>
                  <button
                    type="button"
                    data-task-id={t.id}
                    data-status={t.status}
                    data-source={span?.source}
                    data-ongoing={span?.ongoing}
                    data-selected={t.id === selectedTaskId || undefined}
                    aria-label={t.title}
                    title={itemTitle(t, today)}
                    className={cn(
                      'flex h-full w-full items-center rounded-[4px] text-left outline-none focus-visible:ring-2 focus-visible:ring-ring/60',
                      t.id === selectedTaskId && 'ring-2 ring-primary/70',
                    )}
                    onClick={() => {
                      setOpen(false)
                      openTask(t.id)
                    }}
                  >
                    <ItemLook
                      task={t}
                      kind={kind}
                      today={today}
                      continuesBefore={!!span && span.start < date}
                      continuesAfter={!!span && span.end > date}
                      className="min-w-0 flex-1"
                    />
                    {badge?.kind === 'start' && (
                      <StartDateBadge startDate={badge.date} className="shrink-0 px-1.5" />
                    )}
                    {record !== null && (
                      <span className="shrink-0 px-1.5 text-[11px] font-medium whitespace-nowrap text-muted-foreground tabular-nums">
                        {record}
                      </span>
                    )}
                  </button>
                </TaskContextMenu>
              </li>
            )
          })}
        </ul>
      </PopoverContent>
    </Popover>
  )
}

// --- week row ----------------------------------------------------------------------------

interface WeekRowProps {
  weekStart: LocalDate
  month: LocalDate
  today: LocalDate
  tasks: Task[]
  maxLanes: number
  highlight: ReadonlySet<LocalDate>
  draggingTaskId: string | null
}

const colStyle = (
  startCol: number,
  endCol: number,
  top: number,
  height: number,
): CSSProperties => ({
  left: `calc(${(startCol / DAYS_PER_WEEK) * 100}% + 3px)`,
  width: `calc(${((endCol - startCol + 1) / DAYS_PER_WEEK) * 100}% - 6px)`,
  top,
  height,
})

function WeekRow({
  weekStart,
  month,
  today,
  tasks,
  maxLanes,
  highlight,
  draggingTaskId,
}: WeekRowProps) {
  const days = weekDays(weekStart)
  const fitted = useMemo(
    () => fitWeek(layoutWeek(weekStart, tasks, today), maxLanes),
    [weekStart, tasks, today, maxLanes],
  )
  const monthKey = month.slice(0, 7)
  return (
    <div
      className="relative grid min-h-0 grid-cols-7 border-b border-border/70 last:border-b-0"
      data-week={weekStart}
    >
      {days.map((d) => (
        <DayCell
          key={d}
          date={d}
          today={today}
          inMonth={d.slice(0, 7) === monthKey}
          highlighted={highlight.has(d)}
        />
      ))}
      <div className="pointer-events-none absolute inset-x-0 bottom-0" style={{ top: DAY_HEADER }}>
        {fitted.pieces.map((p) => (
          <CalendarItem
            key={`${p.task.id}:${p.startCol}`}
            piece={p}
            weekStart={weekStart}
            today={today}
            dimmed={draggingTaskId === p.task.id}
            onOpen={openTask}
            style={colStyle(p.startCol, p.endCol, p.lane * LANE, ITEM_HEIGHT)}
          />
        ))}
        {fitted.hiddenByCol.map((hidden, col) => {
          const date = days[col]
          if (hidden === 0 || !date) return null
          return (
            <MorePopover
              key={date}
              date={date}
              hidden={hidden}
              tasks={fitted.tasksByCol[col] ?? []}
              today={today}
              style={colStyle(col, col, Math.max(0, maxLanes - 1) * LANE, ITEM_HEIGHT)}
            />
          )
        })}
      </div>
    </div>
  )
}

// --- view --------------------------------------------------------------------------------

/** Measures how many lanes fit in one week row (recomputed on resize). */
function useMaxLanes(weekCount: number): [(el: HTMLDivElement | null) => void, number] {
  const [el, setEl] = useState<HTMLDivElement | null>(null)
  const [height, setHeight] = useState(0)
  useLayoutEffect(() => {
    if (!el) return
    const measure = (): void => setHeight(el.clientHeight)
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [el])
  const rowHeight = weekCount > 0 ? height / weekCount : 0
  const lanes = Math.floor((rowHeight - DAY_HEADER - BOTTOM_PAD + (LANE - ITEM_HEIGHT)) / LANE)
  return [setEl, Math.max(1, lanes)]
}

/** The day under the pointer at drag start (a bar is grabbed at some day along its span). */
function dateAtPoint(x: number, y: number): LocalDate | null {
  for (const el of document.elementsFromPoint(x, y)) {
    const date = (el as HTMLElement).dataset?.date
    if (date) return date
  }
  return null
}

function pointerOf(event: Event | null): { x: number; y: number } | null {
  if (event && 'clientX' in event && 'clientY' in event) {
    return { x: Number(event.clientX), y: Number(event.clientY) }
  }
  return null
}

interface ActiveDrag {
  task: Task
  grabDate: LocalDate
}

export function CalendarView() {
  const today = useToday()
  const { weekStartsOn } = useSettings()
  const storedMonth = useCalendarViewStore((s) => s.month)
  const showCompleted = useCalendarViewStore((s) => s.showCompleted)
  const month = storedMonth ?? startOfMonth(today)
  const filtered = useFilteredTasks()

  const weeks = useMemo(() => monthGridWeeks(month, weekStartsOn), [month, weekStartsOn])
  const visible = useMemo(() => {
    const range = monthGridRange(month, weekStartsOn)
    return tasksInRange(
      filterCalendar(filtered, today, { showCompleted }),
      today,
      range.start,
      range.end,
    )
  }, [filtered, today, showCompleted, month, weekStartsOn])

  const [gridRef, maxLanes] = useMaxLanes(weeks.length)

  // --- drag & drop
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }))
  const [active, setActive] = useState<ActiveDrag | null>(null)
  const [overDate, setOverDate] = useState<LocalDate | null>(null)
  const activeRef = useRef<ActiveDrag | null>(null)

  const onDragStart = useCallback((e: DragStartEvent) => {
    const data = e.active.data.current as DragData | undefined
    const task = data ? useTasksStore.getState().byId[data.taskId] : undefined
    // Only planned (not_started) items are draggable; the drag moves the plan (`taskSpan`).
    const span = task && task.status === 'not_started' ? taskSpan(task) : null
    if (!task || !span) return
    const p = pointerOf(e.activatorEvent)
    const grabbed = p ? dateAtPoint(p.x, p.y) : null
    // Clamp to the task's own span (the pointer could sit on a cell edge).
    const grabDate = grabbed ? maxDate(span.start, minDate(span.end, grabbed)) : span.start
    activeRef.current = { task, grabDate }
    setActive(activeRef.current)
  }, [])

  const onDragOver = useCallback((e: DragOverEvent) => {
    setOverDate(e.over ? String(e.over.id) : null)
  }, [])

  const endDrag = useCallback(() => {
    activeRef.current = null
    setActive(null)
    setOverDate(null)
  }, [])

  const onDragEnd = useCallback(
    (e: DragEndEvent) => {
      const drag = activeRef.current
      endDrag()
      if (!drag || !e.over) return
      const patch = shiftTaskDates(drag.task, diffDays(drag.grabDate, String(e.over.id)))
      if (patch) void useTasksStore.getState().update(drag.task.id, patch)
    },
    [endDrag],
  )

  // Highlight the days the dragged task would occupy if dropped now.
  const highlight = useMemo<ReadonlySet<LocalDate>>(() => {
    if (!active || !overDate) return new Set()
    const span = taskSpan(active.task)
    if (!span) return new Set()
    const delta = diffDays(active.grabDate, overDate)
    return new Set(eachDay(addDays(span.start, delta), addDays(span.end, delta)))
  }, [active, overDate])

  const activeSpan = active ? taskSpan(active.task) : null

  return (
    <div className="flex h-full flex-col" data-testid="calendar-view">
      <CalendarToolbar month={month} today={today} />
      <div className="grid shrink-0 grid-cols-7 border-b">
        {Array.from({ length: DAYS_PER_WEEK }, (_, i) => (
          <div
            key={i}
            data-weekday={(weekStartsOn + i) % 7}
            className="h-7 px-2.5 text-right text-[11px] leading-7 font-medium tracking-wide text-muted-foreground uppercase"
          >
            {weekdayShort(weekStartsOn + i)}
          </div>
        ))}
      </div>
      <DndContext
        sensors={sensors}
        collisionDetection={pointerWithin}
        onDragStart={onDragStart}
        onDragOver={onDragOver}
        onDragEnd={onDragEnd}
        onDragCancel={endDrag}
      >
        <div
          ref={gridRef}
          className="grid min-h-0 flex-1"
          style={{ gridTemplateRows: `repeat(${weeks.length}, minmax(0, 1fr))` }}
          data-testid="calendar-grid"
        >
          {weeks.map((w) => (
            <WeekRow
              key={w}
              weekStart={w}
              month={month}
              today={today}
              tasks={visible}
              maxLanes={maxLanes}
              highlight={highlight}
              draggingTaskId={active?.task.id ?? null}
            />
          ))}
        </div>
        <DragOverlay dropAnimation={null}>
          {active && activeSpan ? (
            <div className="h-5 w-44 cursor-grabbing rounded-[4px] bg-popover shadow-md ring-1 ring-border">
              <ItemLook
                task={active.task}
                kind={activeSpan.start === activeSpan.end ? 'chip' : 'bar'}
                today={today}
              />
            </div>
          ) : null}
        </DragOverlay>
      </DndContext>
    </div>
  )
}
