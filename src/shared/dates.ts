// Local calendar-date helpers. Calendar dates are `YYYY-MM-DD` strings in the user's local
// time zone; timestamps (epoch ms) are only used for created/updated/completed instants.
// All arithmetic on LocalDate strings is done on UTC components so DST never shifts a day.

import type { LocalDate, WeekStartsOn } from './types'

const LOCAL_DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/

function pad(n: number, width = 2): string {
  return String(n).padStart(width, '0')
}

function parts(date: LocalDate): [number, number, number] {
  const m = LOCAL_DATE_RE.exec(date)
  if (!m) throw new Error(`Invalid local date: ${date}`)
  return [Number(m[1]), Number(m[2]), Number(m[3])]
}

/** True for a well-formed, real calendar date (`2026-02-30` is false). */
export function isLocalDate(value: unknown): value is LocalDate {
  if (typeof value !== 'string') return false
  const m = LOCAL_DATE_RE.exec(value)
  if (!m) return false
  const y = Number(m[1])
  const mo = Number(m[2])
  const d = Number(m[3])
  if (mo < 1 || mo > 12 || d < 1) return false
  const dt = new Date(Date.UTC(y, mo - 1, d))
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d
}

/** Formats the local calendar date of a JS Date. */
export function toLocalDate(date: Date): LocalDate {
  return `${pad(date.getFullYear(), 4)}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

/** Today's local calendar date. */
export function todayLocal(now: Date = new Date()): LocalDate {
  return toLocalDate(now)
}

/** Local calendar date of an epoch-ms instant. */
export function localDateOfTimestamp(ms: number): LocalDate {
  return toLocalDate(new Date(ms))
}

/** A Date at local midnight of the given calendar date (for date pickers / display). */
export function localDateToDate(date: LocalDate): Date {
  const [y, m, d] = parts(date)
  return new Date(y, m - 1, d)
}

/** Epoch ms of local midnight at the start of `date`. */
export function startOfLocalDayMs(date: LocalDate): number {
  return localDateToDate(date).getTime()
}

function fromUtcDays(days: number): LocalDate {
  const dt = new Date(days * 86_400_000)
  return `${pad(dt.getUTCFullYear(), 4)}-${pad(dt.getUTCMonth() + 1)}-${pad(dt.getUTCDate())}`
}

function toUtcDays(date: LocalDate): number {
  const [y, m, d] = parts(date)
  return Date.UTC(y, m - 1, d) / 86_400_000
}

export function addDays(date: LocalDate, n: number): LocalDate {
  return fromUtcDays(toUtcDays(date) + n)
}

/** Whole days from `a` to `b` (`b - a`). */
export function diffDays(a: LocalDate, b: LocalDate): number {
  return toUtcDays(b) - toUtcDays(a)
}

export function addMonths(date: LocalDate, n: number): LocalDate {
  const [y, m, d] = parts(date)
  const total = y * 12 + (m - 1) + n
  const ny = Math.floor(total / 12)
  const nm = total - ny * 12
  const lastDay = new Date(Date.UTC(ny, nm + 1, 0)).getUTCDate()
  return `${pad(ny, 4)}-${pad(nm + 1)}-${pad(Math.min(d, lastDay))}`
}

/** 0 = Sunday … 6 = Saturday. */
export function dayOfWeek(date: LocalDate): number {
  return new Date(toUtcDays(date) * 86_400_000).getUTCDay()
}

export function isWeekend(date: LocalDate): boolean {
  const dow = dayOfWeek(date)
  return dow === 0 || dow === 6
}

export function startOfWeek(date: LocalDate, weekStartsOn: WeekStartsOn): LocalDate {
  const offset = (dayOfWeek(date) - weekStartsOn + 7) % 7
  return addDays(date, -offset)
}

/** Last day (inclusive) of the week containing `date`. */
export function endOfWeek(date: LocalDate, weekStartsOn: WeekStartsOn): LocalDate {
  return addDays(startOfWeek(date, weekStartsOn), 6)
}

export function startOfMonth(date: LocalDate): LocalDate {
  return `${date.slice(0, 7)}-01`
}

export function endOfMonth(date: LocalDate): LocalDate {
  return addDays(addMonths(startOfMonth(date), 1), -1)
}

/** String comparison is correct for YYYY-MM-DD. Returns <0, 0, >0. */
export function compareLocalDates(a: LocalDate, b: LocalDate): number {
  return a < b ? -1 : a > b ? 1 : 0
}

export function minDate(a: LocalDate, b: LocalDate): LocalDate {
  return a <= b ? a : b
}

export function maxDate(a: LocalDate, b: LocalDate): LocalDate {
  return a >= b ? a : b
}

/** Inclusive list of dates from `from` to `to`. Empty when `to < from`. */
export function eachDay(from: LocalDate, to: LocalDate): LocalDate[] {
  const out: LocalDate[] = []
  const n = diffDays(from, to)
  for (let i = 0; i <= n; i++) out.push(addDays(from, i))
  return out
}

/** Date-preset targets shared by pickers and the context menu. */
export type DatePreset = 'today' | 'tomorrow' | 'nextWeek'

export function presetDate(
  preset: DatePreset,
  today: LocalDate,
  weekStartsOn: WeekStartsOn,
): LocalDate {
  switch (preset) {
    case 'today':
      return today
    case 'tomorrow':
      return addDays(today, 1)
    case 'nextWeek':
      // First day of next week (Monday by default).
      return addDays(startOfWeek(today, weekStartsOn), 7)
  }
}

const MONTHS_SHORT = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
]
const WEEKDAYS_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

/**
 * Compact, human label relative to today: "Today", "Tomorrow", "Yesterday", weekday name
 * within the next 6 days, "Nov 20" this year, "Nov 20, 2027" otherwise.
 */
export function formatRelativeDate(date: LocalDate, today: LocalDate): string {
  const delta = diffDays(today, date)
  if (delta === 0) return 'Today'
  if (delta === 1) return 'Tomorrow'
  if (delta === -1) return 'Yesterday'
  if (delta > 1 && delta < 7) return WEEKDAYS_SHORT[dayOfWeek(date)] ?? date
  return formatShortDate(date, today)
}

/** "Nov 20" in the current year, "Nov 20, 2027" otherwise. */
export function formatShortDate(date: LocalDate, today?: LocalDate): string {
  const [y, m, d] = parts(date)
  const label = `${MONTHS_SHORT[m - 1] ?? ''} ${d}`
  if (today && today.slice(0, 4) === date.slice(0, 4)) return label
  return `${label}, ${y}`
}

export function weekdayShort(dow: number): string {
  return WEEKDAYS_SHORT[((dow % 7) + 7) % 7] ?? ''
}

export function monthShort(month0: number): string {
  return MONTHS_SHORT[((month0 % 12) + 12) % 12] ?? ''
}

const MINUTE_MS = 60_000
const HOUR_MS = 60 * MINUTE_MS
const DAY_MS = 24 * HOUR_MS

/**
 * Compact elapsed time between two instants (epoch-ms difference), for "took …" / "in
 * progress …" wording. Units are truncated so a value never rounds up past what has elapsed:
 * - under 1 min: "under a minute" (negative values count as 0)
 * - under 1 h:   "N min"
 * - under 24 h:  "N h" / "N h M min"
 * - under 7 days: "1 day" / "1 day 4 h" / "3 days 2 h"
 * - 7 days or more: whole days, rounded to the nearest: "9 days"
 */
export function formatElapsed(ms: number): string {
  const v = Number.isFinite(ms) ? Math.max(0, ms) : 0
  if (v < MINUTE_MS) return 'under a minute'
  if (v < HOUR_MS) return `${Math.floor(v / MINUTE_MS)} min`
  if (v < DAY_MS) {
    const h = Math.floor(v / HOUR_MS)
    const m = Math.floor((v - h * HOUR_MS) / MINUTE_MS)
    return m === 0 ? `${h} h` : `${h} h ${m} min`
  }
  const dayWord = (n: number): string => `${n} ${n === 1 ? 'day' : 'days'}`
  if (v < 7 * DAY_MS) {
    const d = Math.floor(v / DAY_MS)
    const h = Math.floor((v - d * DAY_MS) / HOUR_MS)
    return h === 0 ? dayWord(d) : `${dayWord(d)} ${h} h`
  }
  return dayWord(Math.round(v / DAY_MS))
}
