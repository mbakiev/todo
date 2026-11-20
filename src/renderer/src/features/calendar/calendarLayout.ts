// Pure month-grid + lane layout for the Calendar view. No React/DOM; unit-tested.
//
// A week row is 7 day columns. Every task whose DISPLAY span (`displaySpan`: the plan for
// not_started tasks, the record — started → today/due or → completed — for started and done
// tasks) intersects the week becomes one
// segment clipped to the week; segments are packed into lanes (rows) like all-day events in
// a typical calendar app: earliest start first, longer spans first, lowest free lane.
// All date maths is on `YYYY-MM-DD` strings via shared/dates (never milliseconds), so DST
// weeks lay out like any other week.

import {
  addDays,
  diffDays,
  endOfMonth,
  endOfWeek,
  maxDate,
  minDate,
  startOfMonth,
  startOfWeek,
} from '@shared/dates'
import type { LocalDate, Task, WeekStartsOn } from '@shared/types'
import {
  compareDueThenPriority,
  describeProgress,
  displaySpan,
  type DisplaySpan,
} from '@shared/views'

export const DAYS_PER_WEEK = 7

/** First day of every week row shown for the month containing `month`. */
export function monthGridWeeks(month: LocalDate, weekStartsOn: WeekStartsOn): LocalDate[] {
  const first = startOfWeek(startOfMonth(month), weekStartsOn)
  const last = endOfWeek(endOfMonth(month), weekStartsOn)
  const weeks: LocalDate[] = []
  for (let w = first; w <= last; w = addDays(w, DAYS_PER_WEEK)) weeks.push(w)
  return weeks
}

/** The 7 dates of the week starting at `weekStart`. */
export function weekDays(weekStart: LocalDate): LocalDate[] {
  return Array.from({ length: DAYS_PER_WEEK }, (_, i) => addDays(weekStart, i))
}

/** Inclusive `[first, last]` dates visible in the month grid. */
export function monthGridRange(
  month: LocalDate,
  weekStartsOn: WeekStartsOn,
): { start: LocalDate; end: LocalDate } {
  const weeks = monthGridWeeks(month, weekStartsOn)
  const start = weeks[0] ?? startOfMonth(month)
  const lastWeek = weeks[weeks.length - 1] ?? start
  return { start, end: addDays(lastWeek, DAYS_PER_WEEK - 1) }
}

export interface WeekSegment {
  task: Task
  /** 0-based column of the first visible day in this week. */
  startCol: number
  /** 0-based column of the last visible day (inclusive). */
  endCol: number
  lane: number
  /** The task started before this segment (previous week / hidden part): flat left edge. */
  continuesBefore: boolean
  /** The task continues after this segment: flat right edge. */
  continuesAfter: boolean
  /** `bar` = the display span covers several days; `chip` = a single-day span. */
  kind: 'bar' | 'chip'
  /** `planned` = a not_started task's plan (draggable); `actual` = what really happened. */
  source: DisplaySpan['source']
  /** Started and still open: the span runs (at least) to today. */
  ongoing: boolean
  /**
   * Ongoing segments only (else null): how many of this segment's columns are on or before
   * today (0 … columns). Those are the elapsed part; the rest is the planned remainder up to
   * the due date, drawn lighter (and never hatched).
   */
  elapsedCols: number | null
}

export interface WeekLayout {
  weekStart: LocalDate
  /** The `today` the layout was computed for (ongoing spans and elapsed columns depend on it). */
  today: LocalDate
  segments: WeekSegment[]
  /** Number of lanes used (max lane + 1). */
  laneCount: number
}

/** Columns `startCol … endCol` on or before today's column (which may lie outside the week). */
function elapsedIn(startCol: number, endCol: number, todayCol: number): number {
  return Math.max(0, Math.min(endCol, todayCol) - startCol + 1)
}

/**
 * Packs the tasks whose display span intersects the week into lanes. Tasks outside the week
 * (or without a span: undated not_started) are ignored. `today` decides where ongoing
 * (in_progress / blocked) spans end.
 */
export function layoutWeek(
  weekStart: LocalDate,
  tasks: readonly Task[],
  today: LocalDate,
): WeekLayout {
  const weekEnd = addDays(weekStart, DAYS_PER_WEEK - 1)
  const raw: WeekSegment[] = []
  const todayCol = diffDays(weekStart, today)
  // Each segment's display-span start, computed once: the lane sort's tie-break is the hot
  // path (many long-running tasks clamped to the same week tie on column and length).
  const spanStart = new Map<Task, LocalDate>()
  for (const task of tasks) {
    const span = displaySpan(task, today)
    if (!span || span.start > weekEnd || span.end < weekStart) continue
    spanStart.set(task, span.start)
    const startCol = diffDays(weekStart, maxDate(span.start, weekStart))
    const endCol = diffDays(weekStart, minDate(span.end, weekEnd))
    raw.push({
      task,
      startCol,
      endCol,
      lane: 0,
      continuesBefore: span.start < weekStart,
      continuesAfter: span.end > weekEnd,
      kind: span.start === span.end ? 'chip' : 'bar',
      source: span.source,
      ongoing: span.ongoing,
      elapsedCols: span.ongoing ? elapsedIn(startCol, endCol, todayCol) : null,
    })
  }
  // Same order as `compareByDisplayStart` after column and length.
  const startOf = (t: Task): LocalDate => spanStart.get(t) ?? ''
  raw.sort((a, b) => {
    const sa = startOf(a.task)
    const sb = startOf(b.task)
    return (
      a.startCol - b.startCol ||
      b.endCol - b.startCol - (a.endCol - a.startCol) ||
      (sa < sb ? -1 : sa > sb ? 1 : 0) ||
      compareDueThenPriority(a.task, b.task)
    )
  })
  // Interval-graph colouring: segments arrive by start column, so a lane is free when its
  // last occupied column is before this segment's start.
  const laneEnds: number[] = []
  for (const seg of raw) {
    let lane = laneEnds.findIndex((end) => end < seg.startCol)
    if (lane === -1) lane = laneEnds.length
    laneEnds[lane] = seg.endCol
    seg.lane = lane
  }
  return { weekStart, today, segments: raw, laneCount: laneEnds.length }
}

export interface FittedWeek {
  /** Visible pieces (a segment may be split where some of its days overflow). */
  pieces: WeekSegment[]
  /** Per column: how many tasks on that day are hidden behind "+N more". */
  hiddenByCol: number[]
  /** Per column: every task touching that day, in lane order (for the "+N more" popover). */
  tasksByCol: Task[][]
}

/**
 * Fits a week layout into `maxLanes` rows per day. On a day whose highest lane fits, all
 * lanes are shown; otherwise the last row is reserved for "+N more" and lanes from
 * `maxLanes - 1` up are hidden on that day. Segments are cut into visible runs.
 */
export function fitWeek(layout: WeekLayout, maxLanes: number): FittedWeek {
  const rows = Math.max(0, Math.floor(maxLanes))
  const topLane = new Array<number>(DAYS_PER_WEEK).fill(-1)
  const tasksByCol: Task[][] = Array.from({ length: DAYS_PER_WEEK }, () => [])
  const byLane = layout.segments.slice().sort((a, b) => a.lane - b.lane)
  for (const seg of byLane) {
    for (let c = seg.startCol; c <= seg.endCol; c++) {
      topLane[c] = Math.max(topLane[c] ?? -1, seg.lane)
      tasksByCol[c]?.push(seg.task)
    }
  }
  const limit = topLane.map((top) => (top + 1 <= rows ? rows : Math.max(0, rows - 1)))
  const hiddenByCol = new Array<number>(DAYS_PER_WEEK).fill(0)
  const pieces: WeekSegment[] = []
  const todayCol = diffDays(layout.weekStart, layout.today)

  for (const seg of byLane) {
    let runStart: number | null = null
    const flush = (end: number): void => {
      if (runStart === null) return
      pieces.push({
        ...seg,
        startCol: runStart,
        endCol: end,
        continuesBefore: seg.continuesBefore || runStart > seg.startCol,
        continuesAfter: seg.continuesAfter || end < seg.endCol,
        // A cut piece counts its own elapsed columns.
        elapsedCols: seg.elapsedCols === null ? null : elapsedIn(runStart, end, todayCol),
      })
      runStart = null
    }
    for (let c = seg.startCol; c <= seg.endCol; c++) {
      if (seg.lane < (limit[c] ?? 0)) {
        if (runStart === null) runStart = c
      } else {
        hiddenByCol[c] = (hiddenByCol[c] ?? 0) + 1
        flush(c - 1)
      }
    }
    flush(seg.endCol)
  }
  return { pieces, hiddenByCol, tasksByCol }
}

/**
 * New PLAN dates for a not_started task dragged by `deltaDays`: single-date tasks move that date, ranged
 * tasks shift both ends (duration preserved). Returns null when nothing changes.
 */
export function shiftTaskDates(
  task: Pick<Task, 'startDate' | 'dueDate'>,
  deltaDays: number,
): { startDate: LocalDate | null; dueDate: LocalDate | null } | null {
  if (deltaDays === 0 || (task.startDate === null && task.dueDate === null)) return null
  return {
    startDate: task.startDate === null ? null : addDays(task.startDate, deltaDays),
    dueDate: task.dueDate === null ? null : addDays(task.dueDate, deltaDays),
  }
}

/**
 * Hover text for an item: the title, plus the record for started / done tasks
 * ("Write report — Started Nov 3 · in progress 16 days · Due Nov 25").
 */
export function itemTitle(task: Task, today: LocalDate): string {
  const progress = describeProgress(task, today)
  return progress.length === 0 ? task.title : `${task.title} — ${progress.join(' · ')}`
}
