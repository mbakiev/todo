import {
  addDays,
  addMonths,
  dayOfWeek,
  diffDays,
  eachDay,
  endOfMonth,
  endOfWeek,
  formatElapsed,
  formatRelativeDate,
  formatShortDate,
  isLocalDate,
  isWeekend,
  localDateOfTimestamp,
  presetDate,
  startOfLocalDayMs,
  startOfWeek,
  toLocalDate,
} from './dates'
import { localMs } from './test/factories'

describe('isLocalDate', () => {
  it('accepts real dates', () => {
    expect(isLocalDate('2026-11-13')).toBe(true)
    expect(isLocalDate('2028-02-29')).toBe(true)
  })
  it('rejects malformed or impossible dates', () => {
    for (const v of [
      '2026-02-30',
      '2027-02-29',
      '2026-13-01',
      '2026-00-10',
      '2026-1-1',
      '26-01-01',
      '',
      null,
      20261113,
      '2026-11-13T00:00',
    ]) {
      expect(isLocalDate(v)).toBe(false)
    }
  })
})

describe('arithmetic', () => {
  it('adds days across month/year boundaries', () => {
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01')
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28')
    expect(addDays('2028-03-01', -1)).toBe('2028-02-29')
  })
  it('is unaffected by DST transitions', () => {
    // US DST ends 2026-11-01, starts 2026-03-08; EU ends 2026-10-25.
    expect(addDays('2026-10-31', 1)).toBe('2026-11-01')
    expect(addDays('2026-11-01', 1)).toBe('2026-11-02')
    expect(addDays('2026-03-07', 2)).toBe('2026-03-09')
    expect(diffDays('2026-10-24', '2026-10-26')).toBe(2)
    expect(diffDays('2026-11-02', '2026-10-30')).toBe(-3)
  })
  it('adds months clamping the day', () => {
    expect(addMonths('2026-01-31', 1)).toBe('2026-02-28')
    expect(addMonths('2026-12-15', 1)).toBe('2027-01-15')
    expect(addMonths('2026-01-15', -2)).toBe('2025-11-15')
    expect(endOfMonth('2028-02-10')).toBe('2028-02-29')
  })
  it('lists each day inclusive', () => {
    expect(eachDay('2026-12-30', '2027-01-02')).toEqual([
      '2026-12-30',
      '2026-12-31',
      '2027-01-01',
      '2027-01-02',
    ])
    expect(eachDay('2026-01-02', '2026-01-01')).toEqual([])
  })
})

describe('weeks', () => {
  // 2026-11-13 is a Friday.
  it('computes day of week', () => {
    expect(dayOfWeek('2026-11-13')).toBe(5)
    expect(isWeekend('2026-11-14')).toBe(true)
    expect(isWeekend('2026-11-13')).toBe(false)
  })
  it('Monday-start weeks', () => {
    expect(startOfWeek('2026-11-13', 1)).toBe('2026-11-09')
    expect(endOfWeek('2026-11-13', 1)).toBe('2026-11-15')
    // Sunday belongs to the week that started the previous Monday.
    expect(startOfWeek('2026-11-15', 1)).toBe('2026-11-09')
    expect(startOfWeek('2026-11-16', 1)).toBe('2026-11-16')
  })
  it('Sunday-start weeks', () => {
    expect(startOfWeek('2026-11-13', 0)).toBe('2026-11-08')
    expect(endOfWeek('2026-11-13', 0)).toBe('2026-11-14')
    expect(startOfWeek('2026-11-15', 0)).toBe('2026-11-15')
    expect(endOfWeek('2026-11-15', 0)).toBe('2026-11-21')
  })
  it('weeks spanning a year boundary', () => {
    expect(startOfWeek('2027-01-01', 1)).toBe('2026-12-28')
    expect(endOfWeek('2026-12-30', 0)).toBe('2027-01-02')
  })
})

describe('timestamps', () => {
  it('maps timestamps to the local date around midnight', () => {
    expect(localDateOfTimestamp(localMs(2026, 11, 13, 0, 0, 0, 0))).toBe('2026-11-13')
    expect(localDateOfTimestamp(localMs(2026, 11, 12, 23, 59, 59, 999))).toBe('2026-11-12')
    expect(startOfLocalDayMs('2026-11-13')).toBe(localMs(2026, 11, 13, 0))
    expect(toLocalDate(new Date(2026, 0, 5))).toBe('2026-01-05')
  })
})

describe('presets and formatting', () => {
  it('resolves presets', () => {
    expect(presetDate('today', '2026-11-13', 1)).toBe('2026-11-13')
    expect(presetDate('tomorrow', '2026-11-13', 1)).toBe('2026-11-14')
    expect(presetDate('nextWeek', '2026-11-13', 1)).toBe('2026-11-16')
    expect(presetDate('nextWeek', '2026-11-13', 0)).toBe('2026-11-15')
    // On the first day of the week, "next week" is 7 days later.
    expect(presetDate('nextWeek', '2026-11-16', 1)).toBe('2026-11-23')
  })
  it('formats relative dates', () => {
    const today = '2026-11-13'
    expect(formatRelativeDate('2026-11-13', today)).toBe('Today')
    expect(formatRelativeDate('2026-11-14', today)).toBe('Tomorrow')
    expect(formatRelativeDate('2026-11-12', today)).toBe('Yesterday')
    expect(formatRelativeDate('2026-11-17', today)).toBe('Tue')
    expect(formatRelativeDate('2026-12-01', today)).toBe('Dec 1')
    expect(formatRelativeDate('2027-01-01', today)).toBe('Jan 1, 2027')
    expect(formatShortDate('2026-11-05')).toBe('Nov 5, 2026')
  })
})

describe('formatElapsed', () => {
  const MIN = 60_000
  const H = 60 * MIN
  const D = 24 * H
  it('under a minute, including zero and negative', () => {
    expect(formatElapsed(0)).toBe('under a minute')
    expect(formatElapsed(59_999)).toBe('under a minute')
    expect(formatElapsed(-5 * H)).toBe('under a minute')
    expect(formatElapsed(Number.NaN)).toBe('under a minute')
  })
  it('minutes, truncated', () => {
    expect(formatElapsed(MIN)).toBe('1 min')
    expect(formatElapsed(59 * MIN + 59_999)).toBe('59 min')
  })
  it('hours and minutes under a day', () => {
    expect(formatElapsed(H)).toBe('1 h')
    expect(formatElapsed(3 * H + 20 * MIN)).toBe('3 h 20 min')
    expect(formatElapsed(23 * H + 59 * MIN + 59_000)).toBe('23 h 59 min')
  })
  it('days and hours under a week', () => {
    expect(formatElapsed(D)).toBe('1 day')
    expect(formatElapsed(D + 4 * H + 30 * MIN)).toBe('1 day 4 h')
    expect(formatElapsed(2 * D)).toBe('2 days')
    expect(formatElapsed(6 * D + 23 * H)).toBe('6 days 23 h')
  })
  it('whole days from a week up, rounded', () => {
    expect(formatElapsed(7 * D)).toBe('7 days')
    expect(formatElapsed(9 * D + 4 * H)).toBe('9 days')
    expect(formatElapsed(9 * D + 13 * H)).toBe('10 days')
    expect(formatElapsed(400 * D)).toBe('400 days')
  })
})
