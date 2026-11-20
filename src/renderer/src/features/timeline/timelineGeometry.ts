// Pure geometry + drag math for the Timeline (Gantt) view. No React, no DOM.
// Dates are `YYYY-MM-DD` strings and all arithmetic goes through `@shared/dates`
// (whole calendar days), so DST transitions never shift a bar.

import {
  addDays,
  addMonths,
  dayOfWeek,
  diffDays,
  formatShortDate,
  maxDate,
  minDate,
  monthShort,
  startOfMonth,
  startOfWeek,
  weekdayShort,
} from '@shared/dates'
import type { LocalDate, Status, Task, WeekStartsOn } from '@shared/types'
import { displaySpan, taskSpan, timelineRange } from '@shared/views'

export type Zoom = 'day' | 'week' | 'month'
export const ZOOMS: readonly Zoom[] = ['day', 'week', 'month']
export const ZOOM_LABELS: Record<Zoom, string> = { day: 'Day', week: 'Week', month: 'Month' }

/** Column width of one calendar day, per zoom level. */
export const DAY_WIDTH: Record<Zoom, number> = { day: 40, week: 18, month: 6 }

/** Narrowest a bar is ever drawn, so one-day bars stay grabbable at Month zoom. */
export const MIN_BAR_WIDTH = 8

/** Inclusive calendar-date range. */
export interface DateRange {
  start: LocalDate
  end: LocalDate
}

export type TaskDates = Pick<Task, 'startDate' | 'dueDate'>

/** Number of days in an inclusive range. */
export function rangeDays(range: DateRange): number {
  return diffDays(range.start, range.end) + 1
}

/**
 * The drawn range: `timelineRange` (one week before today, or further back to where started /
 * finished work actually began → latest display-span end, min 6 weeks ahead) plus `padDays` of trailing room to drag into, extended further when needed so the
 * grid fills at least `minDays` columns (wide windows at Month zoom).
 */
export function buildTimelineRange(
  tasks: readonly Task[],
  today: LocalDate,
  options: { padDays?: number; minDays?: number } = {},
): DateRange {
  const base = timelineRange(tasks, today)
  let end = addDays(base.end, options.padDays ?? 14)
  const minDays = options.minDays ?? 0
  if (diffDays(base.start, end) + 1 < minDays) end = addDays(base.start, minDays - 1)
  return { start: base.start, end }
}

/** Left offset (px) of the column for `date`. Dates before the range give negative x. */
export function dateToX(date: LocalDate, rangeStart: LocalDate, dayWidth: number): number {
  return diffDays(rangeStart, date) * dayWidth
}

/** The date whose column contains `x`. */
export function xToDate(x: number, rangeStart: LocalDate, dayWidth: number): LocalDate {
  return addDays(rangeStart, Math.floor(x / dayWidth))
}

/** Pointer delta in px → whole days (nearest), never `-0`. */
export function pxToDays(dx: number, dayWidth: number): number {
  return Math.round(dx / dayWidth) || 0
}

export interface VisualSpan extends DateRange {
  /** The real start lies before the range start (bar is pinned to the left edge). */
  clampedStart: boolean
  /** The whole task lies before the range; drawn as a one-day stub at the left edge. */
  beforeRange: boolean
  /** The real end lies after the range end (only happens while previewing a drag). */
  clampedEnd: boolean
}

/** The part of `span` that is drawn, pinned into `range`. */
export function visualSpan(span: DateRange, range: DateRange): VisualSpan {
  if (span.end < range.start) {
    return {
      start: range.start,
      end: range.start,
      clampedStart: true,
      beforeRange: true,
      clampedEnd: false,
    }
  }
  return {
    start: maxDate(span.start, range.start),
    end: minDate(span.end, range.end),
    clampedStart: span.start < range.start,
    beforeRange: false,
    clampedEnd: span.end > range.end,
  }
}

export interface BarRect extends VisualSpan {
  left: number
  width: number
  /** The real (unclamped) display span (`displaySpan`): the plan, or what actually happened. */
  span: DateRange
  /** `planned`: a not_started task's plan. `actual`: when a started / done task really ran. */
  source: 'planned' | 'actual'
  /** Started and still open: the bar reaches (at least) today and moves with it. */
  ongoing: boolean
  /**
   * Ongoing and ending today only because the task is still open (no due date ahead of
   * today): drawn flush to today's column with a flat right edge, reading "still going".
   */
  openEnded: boolean
  /**
   * Ongoing bars: px from the bar's left edge to the end of today's column, clamped into
   * `[0, width]` — the part already elapsed. Anything right of it is the planned remainder
   * up to a future due date. Equals `width` when nothing remains. Null when not ongoing.
   */
  elapsedWidth: number | null
}

/** Horizontal breathing room between a bar and its column edges. */
export function barInset(dayWidth: number): number {
  return dayWidth >= 24 ? 3 : 1
}

/**
 * Bar geometry for a task from its `displaySpan`, or null when it has none (an undated
 * not_started task). Pass `{ ...task, ...previewDates }` to draw a drag preview: a planned bar
 * follows the previewed plan, a started bar the previewed due date.
 */
export function barRect(
  task: Task,
  range: DateRange,
  dayWidth: number,
  today: LocalDate,
): BarRect | null {
  const ds = displaySpan(task, today)
  if (!ds) return null
  const span: DateRange = { start: ds.start, end: ds.end }
  const v = visualSpan(span, range)
  const openEnded =
    ds.ongoing && ds.end === today && (task.dueDate === null || task.dueDate < today)
  const inset = barInset(dayWidth)
  const x0 = dateToX(v.start, range.start, dayWidth)
  const x1 = dateToX(v.end, range.start, dayWidth) + dayWidth
  // A bar pinned to an edge runs flush to it, so the clamp reads as "continues past here";
  // an open-ended bar does the same at today's column.
  let left = v.clampedStart ? x0 : x0 + inset
  const right = v.clampedEnd || openEnded ? x1 : x1 - inset
  let width = right - left
  if (width < MIN_BAR_WIDTH) {
    left = Math.max(0, left - (MIN_BAR_WIDTH - width) / 2)
    width = MIN_BAR_WIDTH
  }
  let elapsedWidth: number | null = null
  if (ds.ongoing) {
    // Nothing planned after today: the whole bar is elapsed (also when MIN_BAR_WIDTH widened it).
    const todayEnd = dateToX(today, range.start, dayWidth) + dayWidth
    elapsedWidth = ds.end <= today ? width : Math.min(width, Math.max(0, todayEnd - left))
  }
  return {
    ...v,
    left,
    width,
    span,
    source: ds.source,
    ongoing: ds.ongoing,
    openEnded,
    elapsedWidth,
  }
}

// ---------------------------------------------------------------------------
// Drag math
// ---------------------------------------------------------------------------

export type DragMode = 'move' | 'start' | 'end'

const ALL_MODES: readonly DragMode[] = ['move', 'start', 'end']
const END_ONLY: readonly DragMode[] = ['end']
const NO_MODES: readonly DragMode[] = []

/**
 * Which drags a bar offers. Dragging edits the PLAN only: a not_started bar moves and resizes;
 * a started (in_progress / blocked) bar starts where work really began, so only its end
 * handle drags (it sets the due date); a done bar is history and does not drag.
 */
export function dragModes(status: Status): readonly DragMode[] {
  switch (status) {
    case 'not_started':
      return ALL_MODES
    case 'in_progress':
    case 'blocked':
      return END_ONLY
    case 'done':
      return NO_MODES
  }
}

/** What `applyDrag` needs to know about a started task (absent = a planned bar). */
export interface DragContext {
  status: Status
  today: LocalDate
  /** Local date the task actually started (`startedOn`); null for not_started. */
  startedOn: LocalDate | null
}

function sameDates(a: TaskDates, b: TaskDates): boolean {
  return a.startDate === b.startDate && a.dueDate === b.dueDate
}

/**
 * Rebuilds dates from a new `[start, end]`, keeping a single-date task single-dated when the
 * span collapses back to one day (so a resize that returns to the start is a no-op).
 */
function fromSpan(orig: TaskDates, start: LocalDate, end: LocalDate): TaskDates {
  const single = orig.startDate === null || orig.dueDate === null
  if (single && start === end) {
    return orig.startDate !== null
      ? { startDate: start, dueDate: null }
      : { startDate: null, dueDate: end }
  }
  return { startDate: start, dueDate: end }
}

/**
 * New dates after dragging a bar by `deltaDays` (whole days).
 *
 * - `move`: both dates shift, duration preserved; a single-date task moves its one date.
 * - `end` / `start`: resize that edge. Never crosses the other end. Resizing a single-date
 *   bar turns it into a range with the existing date as the other end.
 *
 * Clamped bars operate on what is drawn: a task entirely before the range is drawn as a
 * one-day stub at the left edge, so moving it by N days lands its due/end date N days into
 * the range (duration preserved). A drag that would leave such a task still before the
 * range is a no-op, so an ancient date is never silently rewritten. The left edge of a bar
 * whose start is clamped resizes from the drawn edge.
 */
export function applyDrag(
  dates: TaskDates,
  mode: DragMode,
  deltaDays: number,
  range: DateRange,
  ctx?: DragContext,
): TaskDates {
  if (ctx !== undefined && ctx.status !== 'not_started') {
    return applyStartedDrag(dates, mode, deltaDays, range, ctx)
  }
  const span = taskSpan(dates)
  if (!span || deltaDays === 0) return dates
  const v = visualSpan(span, range)

  if (mode === 'move') {
    const newEnd = addDays(v.end, deltaDays)
    if (v.beforeRange && newEnd < range.start) return dates
    const shift = diffDays(span.end, newEnd)
    return {
      startDate: dates.startDate === null ? null : addDays(dates.startDate, shift),
      dueDate: dates.dueDate === null ? null : addDays(dates.dueDate, shift),
    }
  }

  if (mode === 'end') {
    const target = addDays(v.end, deltaDays)
    if (v.beforeRange && target < range.start) return dates
    const next = fromSpan(dates, span.start, maxDate(target, span.start))
    return sameDates(next, dates) ? dates : next
  }

  // mode === 'start'
  if (v.beforeRange) return dates // the stub's left edge is the range edge, not the task's start
  const next = fromSpan(dates, minDate(addDays(v.start, deltaDays), span.end), span.end)
  return sameDates(next, dates) ? dates : next
}

/**
 * A started bar (drawn `startedOn → max(today, due ?? today)`): only the end handle drags, and
 * it sets `dueDate` to the new drawn end, clamped to `>= today`. A drawn end that does not
 * change is a no-op (an overdue due date is not silently rewritten to today). The planned
 * start is superseded once work has really started: if it would fall after the new due date,
 * it moves to the actual start (`startedOn`, clamped `<= due`) in the same patch, so the
 * repo's start <= due rule holds. Done bars never change.
 */
function applyStartedDrag(
  dates: TaskDates,
  mode: DragMode,
  deltaDays: number,
  range: DateRange,
  { status, today, startedOn }: DragContext,
): TaskDates {
  if (!dragModes(status).includes(mode) || deltaDays === 0) return dates
  const drawnEnd = minDate(maxDate(today, dates.dueDate ?? today), range.end)
  const end = maxDate(addDays(drawnEnd, deltaDays), today)
  if (end === drawnEnd) return dates
  const startDate =
    dates.startDate !== null && dates.startDate > end
      ? minDate(startedOn ?? today, end)
      : dates.startDate
  return { startDate, dueDate: end }
}

/** The `tasksStore.update` patch turning `before` into `after`, or null when unchanged. */
export function datesPatch(before: TaskDates, after: TaskDates): Partial<TaskDates> | null {
  const patch: Partial<TaskDates> = {}
  if (before.startDate !== after.startDate) patch.startDate = after.startDate
  if (before.dueDate !== after.dueDate) patch.dueDate = after.dueDate
  return Object.keys(patch).length === 0 ? null : patch
}

// ---------------------------------------------------------------------------
// Labels
// ---------------------------------------------------------------------------

/** Inclusive length of a span in days. */
export function spanDays(span: DateRange): number {
  return diffDays(span.start, span.end) + 1
}

export function formatDuration(days: number): string {
  return days === 1 ? '1 day' : `${days} days`
}

/** "Nov 14" for a one-day span, "Nov 14 – Nov 18" otherwise. */
export function formatSpan(span: DateRange, today: LocalDate): string {
  const a = formatShortDate(span.start, today)
  if (span.start === span.end) return a
  return `${a} – ${formatShortDate(span.end, today)}`
}

// ---------------------------------------------------------------------------
// Header + grid
// ---------------------------------------------------------------------------

export interface HeaderCell {
  key: string
  label: string
  /** Optional small prefix (weekday letter at Day zoom). */
  sub?: string
  left: number
  width: number
  start: LocalDate
  end: LocalDate
  weekend?: boolean
  today?: boolean
}

/** Splits `range` into consecutive segments; `next(d)` gives the first day of the next one. */
function segments(range: DateRange, next: (d: LocalDate) => LocalDate): DateRange[] {
  const out: DateRange[] = []
  let cur = range.start
  while (cur <= range.end) {
    const segEnd = minDate(addDays(next(cur), -1), range.end)
    out.push({ start: cur, end: segEnd })
    cur = addDays(segEnd, 1)
  }
  return out
}

const nextDay = (d: LocalDate): LocalDate => addDays(d, 1)
const nextMonth = (d: LocalDate): LocalDate => addMonths(startOfMonth(d), 1)
const nextYear = (d: LocalDate): LocalDate => `${String(Number(d.slice(0, 4)) + 1)}-01-01`

/** Month boundaries inside the range (first-of-month dates after the range start). */
export function monthStarts(range: DateRange): LocalDate[] {
  return segments(range, nextMonth)
    .slice(1)
    .map((s) => s.start)
}

/**
 * Two-tier header. Day: month / day number. Week: month / week ("9 – 15"). Month: year /
 * month name.
 */
export function headerTiers(
  range: DateRange,
  zoom: Zoom,
  today: LocalDate,
  weekStartsOn: WeekStartsOn,
): { top: HeaderCell[]; bottom: HeaderCell[] } {
  const dw = DAY_WIDTH[zoom]
  const cell = (s: DateRange, label: string, extra: Partial<HeaderCell> = {}): HeaderCell => ({
    key: s.start,
    label,
    left: dateToX(s.start, range.start, dw),
    width: spanDays(s) * dw,
    start: s.start,
    end: s.end,
    today: today >= s.start && today <= s.end,
    ...extra,
  })
  const monthLabel = (d: LocalDate): string =>
    `${monthShort(Number(d.slice(5, 7)) - 1)} ${d.slice(0, 4)}`

  if (zoom === 'month') {
    return {
      top: segments(range, nextYear).map((s) => cell(s, s.start.slice(0, 4))),
      bottom: segments(range, nextMonth).map((s) =>
        cell(s, monthShort(Number(s.start.slice(5, 7)) - 1)),
      ),
    }
  }
  const top = segments(range, nextMonth).map((s) => cell(s, monthLabel(s.start)))
  if (zoom === 'week') {
    const nextWeek = (d: LocalDate): LocalDate => addDays(startOfWeek(d, weekStartsOn), 7)
    return {
      top,
      bottom: segments(range, nextWeek).map((s) => {
        // Label with the full calendar week even when the range cuts it.
        const ws = startOfWeek(s.start, weekStartsOn)
        const we = addDays(ws, 6)
        return cell(s, `${Number(ws.slice(8))} – ${Number(we.slice(8))}`)
      }),
    }
  }
  return {
    top,
    bottom: segments(range, nextDay).map((s) => {
      const dow = dayOfWeek(s.start)
      return cell(s, String(Number(s.start.slice(8))), {
        sub: weekdayShort(dow).slice(0, 2),
        weekend: dow === 0 || dow === 6,
      })
    }),
  }
}

/** Days from the range start to the first Saturday (weekend shading phase). */
export function weekendOffsetDays(rangeStart: LocalDate): number {
  return (6 - dayOfWeek(rangeStart) + 7) % 7
}

/** Days from the range start to the first week start (weekly grid-line phase). */
export function weekStartOffsetDays(rangeStart: LocalDate, weekStartsOn: WeekStartsOn): number {
  return (weekStartsOn - dayOfWeek(rangeStart) + 7) % 7
}

/**
 * scrollLeft that puts `date` near the left edge with the preceding week still visible, so
 * recent overdue work (and pinned pre-range stubs) stay in view.
 */
/**
 * The `scrollLeft` that keeps the same date at the grid's left edge after the range start
 * and / or the day width change (`timelineRange` moves its start with the data: Completed
 * toggled, a filter, the earliest started task finished, midnight). Fractional days are kept,
 * so a zoom change preserves the exact position within the left-edge day.
 */
export function rebaseScrollLeft(
  scrollLeft: number,
  from: { start: LocalDate; dayWidth: number },
  to: { start: LocalDate; dayWidth: number },
): number {
  return (scrollLeft / from.dayWidth + diffDays(to.start, from.start)) * to.dayWidth
}

export function scrollLeftFor(date: LocalDate, range: DateRange, zoom: Zoom): number {
  const dw = DAY_WIDTH[zoom]
  return Math.max(0, dateToX(date, range.start, dw) - 7 * dw)
}
