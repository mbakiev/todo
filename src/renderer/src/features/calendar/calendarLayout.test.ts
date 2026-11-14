import { makeTask } from '@shared/test/factories'
import type { Task } from '@shared/types'
import {
  fitWeek,
  layoutWeek,
  monthGridRange,
  monthGridWeeks,
  shiftTaskDates,
  weekDays,
  type WeekSegment,
} from './calendarLayout'

const ranged = (id: string, startDate: string, dueDate: string, extra: Partial<Task> = {}): Task =>
  makeTask({ id, startDate, dueDate, ...extra })
const due = (id: string, dueDate: string, extra: Partial<Task> = {}): Task =>
  makeTask({ id, dueDate, ...extra })

function seg(segments: WeekSegment[], id: string): WeekSegment {
  const s = segments.find((x) => x.task.id === id)
  if (!s) throw new Error(`no segment for ${id}`)
  return s
}

describe('monthGridWeeks', () => {
  it('starts on Monday and covers the whole month (Nov 2026, Mon start)', () => {
    // Nov 1 2026 is a Sunday → grid starts Mon Oct 26; Nov 30 is a Monday → ends Sun Dec 6.
    const weeks = monthGridWeeks('2026-11-15', 1)
    expect(weeks[0]).toBe('2026-10-26')
    expect(weeks).toHaveLength(6)
    expect(monthGridRange('2026-11-15', 1)).toEqual({ start: '2026-10-26', end: '2026-12-06' })
  })

  it('honours a Sunday week start', () => {
    const weeks = monthGridWeeks('2026-11-01', 0)
    expect(weeks[0]).toBe('2026-11-01')
    expect(weeks).toHaveLength(5)
    expect(monthGridRange('2026-11-01', 0).end).toBe('2026-12-05')
  })

  it('can be exactly four weeks (Feb 2026 with a Sunday start)', () => {
    expect(monthGridWeeks('2026-02-10', 0)).toEqual([
      '2026-02-01',
      '2026-02-08',
      '2026-02-15',
      '2026-02-22',
    ])
  })

  it('crosses a year boundary', () => {
    const weeks = monthGridWeeks('2027-01-01', 1)
    expect(weeks[0]).toBe('2026-12-28')
  })
})

describe('weekDays across DST changes', () => {
  it('gives 7 consecutive calendar days in the US spring-forward week', () => {
    // DST starts Sun Mar 8 2026 in America/New_York (the unit-test TZ).
    expect(weekDays('2026-03-02')).toEqual([
      '2026-03-02',
      '2026-03-03',
      '2026-03-04',
      '2026-03-05',
      '2026-03-06',
      '2026-03-07',
      '2026-03-08',
    ])
    expect(weekDays('2026-03-08')[6]).toBe('2026-03-14')
  })

  it('gives 7 consecutive calendar days in the fall-back week', () => {
    // DST ends Sun Nov 1 2026.
    expect(weekDays('2026-10-26')[6]).toBe('2026-11-01')
    expect(weekDays('2026-11-01')).toContain('2026-11-02')
  })
})

describe('layoutWeek', () => {
  const week = '2026-11-09' // Mon … Sun Nov 15

  it('places single-date tasks as one-day chips on the right column', () => {
    const { segments, laneCount } = layoutWeek(week, [due('a', '2026-11-11')])
    expect(segments).toEqual([
      expect.objectContaining({
        startCol: 2,
        endCol: 2,
        lane: 0,
        kind: 'chip',
        continuesBefore: false,
        continuesAfter: false,
      }),
    ])
    expect(laneCount).toBe(1)
  })

  it('treats a start-only task as a chip on its start date', () => {
    const t = makeTask({ id: 's', startDate: '2026-11-15' })
    expect(layoutWeek(week, [t]).segments[0]).toMatchObject({ startCol: 6, kind: 'chip' })
  })

  it('treats start === due as a chip', () => {
    expect(layoutWeek(week, [ranged('x', '2026-11-10', '2026-11-10')]).segments[0]?.kind).toBe(
      'chip',
    )
  })

  it('renders ranged tasks as bars and packs non-overlapping ones into the same lane', () => {
    const { segments, laneCount } = layoutWeek(week, [
      ranged('a', '2026-11-09', '2026-11-11'),
      ranged('b', '2026-11-12', '2026-11-14'),
      ranged('c', '2026-11-10', '2026-11-13'),
    ])
    expect(seg(segments, 'a')).toMatchObject({ startCol: 0, endCol: 2, lane: 0, kind: 'bar' })
    expect(seg(segments, 'c')).toMatchObject({ startCol: 1, endCol: 4, lane: 1 })
    expect(seg(segments, 'b')).toMatchObject({ startCol: 3, endCol: 5, lane: 0 })
    expect(laneCount).toBe(2)
  })

  it('gives longer spans the lower lane when they start on the same day', () => {
    const { segments } = layoutWeek(week, [
      due('short', '2026-11-10'),
      ranged('long', '2026-11-10', '2026-11-14'),
    ])
    expect(seg(segments, 'long').lane).toBe(0)
    expect(seg(segments, 'short').lane).toBe(1)
  })

  it('clips multi-week spans and flags continuation on each side', () => {
    const t = ranged('m', '2026-11-04', '2026-11-20')
    const before = layoutWeek('2026-11-02', [t]).segments[0]
    const middle = layoutWeek('2026-11-09', [t]).segments[0]
    const after = layoutWeek('2026-11-16', [t]).segments[0]
    expect(before).toMatchObject({
      startCol: 2,
      endCol: 6,
      continuesBefore: false,
      continuesAfter: true,
    })
    expect(middle).toMatchObject({
      startCol: 0,
      endCol: 6,
      continuesBefore: true,
      continuesAfter: true,
    })
    expect(after).toMatchObject({
      startCol: 0,
      endCol: 4,
      continuesBefore: true,
      continuesAfter: false,
    })
  })

  it('handles tasks that start before / end after the visible grid', () => {
    // Visible grid for Nov 2026 (Mon start) is Oct 26 … Dec 6.
    const t = ranged('huge', '2026-09-01', '2027-02-01')
    const weeks = monthGridWeeks('2026-11-01', 1)
    const first = layoutWeek(weeks[0] ?? '', [t]).segments[0]
    const last = layoutWeek(weeks[weeks.length - 1] ?? '', [t]).segments[0]
    expect(first).toMatchObject({
      startCol: 0,
      endCol: 6,
      continuesBefore: true,
      continuesAfter: true,
    })
    expect(last).toMatchObject({
      startCol: 0,
      endCol: 6,
      continuesBefore: true,
      continuesAfter: true,
    })
  })

  it('spans a month boundary inside one week row', () => {
    // Week of Mon Nov 30 2026 contains Dec 1–6.
    const { segments } = layoutWeek('2026-11-30', [ranged('b', '2026-11-29', '2026-12-02')])
    expect(segments[0]).toMatchObject({
      startCol: 0,
      endCol: 2,
      continuesBefore: true,
      continuesAfter: false,
    })
  })

  it('lays out identically with a Sunday week start', () => {
    const t = ranged('r', '2026-11-14', '2026-11-16') // Sat … Mon
    const sunWeek = layoutWeek('2026-11-08', [t]).segments[0]
    const nextSunWeek = layoutWeek('2026-11-15', [t]).segments[0]
    expect(sunWeek).toMatchObject({ startCol: 6, endCol: 6, continuesAfter: true, kind: 'bar' })
    expect(nextSunWeek).toMatchObject({ startCol: 0, endCol: 1, continuesBefore: true })
  })

  it('counts columns by calendar days across DST changes', () => {
    const spring = layoutWeek('2026-03-02', [ranged('d', '2026-03-07', '2026-03-10')])
    expect(spring.segments[0]).toMatchObject({ startCol: 5, endCol: 6, continuesAfter: true })
    const nextWeek = layoutWeek('2026-03-09', [ranged('d', '2026-03-07', '2026-03-10')])
    expect(nextWeek.segments[0]).toMatchObject({ startCol: 0, endCol: 1 })
    const fall = layoutWeek('2026-10-26', [
      due('f', '2026-11-01'),
      ranged('g', '2026-10-31', '2026-11-03'),
    ])
    expect(seg(fall.segments, 'f')).toMatchObject({ startCol: 6, endCol: 6 })
    expect(seg(fall.segments, 'g')).toMatchObject({ startCol: 5, endCol: 6, continuesAfter: true })
  })

  it('ignores undated tasks and tasks outside the week', () => {
    const { segments } = layoutWeek(week, [
      makeTask({ id: 'none' }),
      due('prev', '2026-11-08'),
      due('next', '2026-11-16'),
    ])
    expect(segments).toEqual([])
  })
})

describe('fitWeek', () => {
  const week = '2026-11-09'

  it('shows everything when the lanes fit', () => {
    // Same day: higher priority gets the lower lane.
    const layout = layoutWeek(week, [
      due('b', '2026-11-09', { priority: 1 }),
      due('a', '2026-11-09', { priority: 4 }),
    ])
    const fit = fitWeek(layout, 2)
    expect(fit.pieces).toHaveLength(2)
    expect(fit.hiddenByCol).toEqual([0, 0, 0, 0, 0, 0, 0])
    expect(fit.tasksByCol[0]?.map((t) => t.id)).toEqual(['a', 'b'])
  })

  it('reserves the last row for "+N more" on overflowing days only', () => {
    const layout = layoutWeek(week, [
      due('a', '2026-11-09', { priority: 4 }),
      due('b', '2026-11-09', { priority: 3 }),
      due('c', '2026-11-09', { priority: 2 }),
      due('d', '2026-11-10'),
    ])
    const fit = fitWeek(layout, 2)
    // Monday: 3 tasks, 2 rows → 1 shown + "+2 more". Tuesday: 1 task shown.
    expect(fit.hiddenByCol[0]).toBe(2)
    expect(fit.hiddenByCol[1]).toBe(0)
    expect(fit.pieces.map((p) => p.task.id).sort()).toEqual(['a', 'd'])
  })

  it('splits a bar where it runs through an overflowing day', () => {
    const layout = layoutWeek(week, [
      due('x1', '2026-11-11'),
      due('x2', '2026-11-11'),
      ranged('bar', '2026-11-09', '2026-11-13'),
    ])
    // Long bar takes lane 0; x1/x2 on Wednesday lanes 1 and 2. With 2 rows Wednesday overflows.
    expect(seg(layout.segments, 'bar').lane).toBe(0)
    const fit = fitWeek(layout, 2)
    const bars = fit.pieces.filter((p) => p.task.id === 'bar')
    expect(bars).toHaveLength(1) // lane 0 < limit 1 on Wednesday, so the bar stays whole
    const tight = fitWeek(layout, 1)
    const tightBars = tight.pieces.filter((p) => p.task.id === 'bar')
    // With one row, Wednesday shows only "+3 more"; the bar is cut into Mon–Tue and Thu–Fri.
    expect(
      tightBars.map((p) => [p.startCol, p.endCol, p.continuesBefore, p.continuesAfter]),
    ).toEqual([
      [0, 1, false, true],
      [3, 4, true, false],
    ])
    expect(tight.hiddenByCol[2]).toBe(3)
  })

  it('hides a high lane even when few tasks touch that day', () => {
    // Lanes 0–2 are long bars Mon–Tue; a chip on Tue gets lane 3.
    const layout = layoutWeek(week, [
      ranged('l0', '2026-11-09', '2026-11-12'),
      ranged('l1', '2026-11-09', '2026-11-11'),
      ranged('l2', '2026-11-09', '2026-11-10'),
      due('chip', '2026-11-10'),
    ])
    expect(seg(layout.segments, 'chip').lane).toBe(3)
    const fit = fitWeek(layout, 3)
    expect(fit.hiddenByCol[1]).toBe(2) // l2 and chip hidden on Tuesday
    expect(fit.hiddenByCol[0]).toBe(0) // Monday has 3 lanes → fits
  })

  it('hides everything with zero rows', () => {
    const fit = fitWeek(layoutWeek(week, [due('a', '2026-11-09')]), 0)
    expect(fit.pieces).toEqual([])
    expect(fit.hiddenByCol[0]).toBe(1)
  })
})

describe('shiftTaskDates', () => {
  it('moves a single due date', () => {
    expect(shiftTaskDates({ startDate: null, dueDate: '2026-11-10' }, 3)).toEqual({
      startDate: null,
      dueDate: '2026-11-13',
    })
  })

  it('moves a single start date', () => {
    expect(shiftTaskDates({ startDate: '2026-11-10', dueDate: null }, -1)).toEqual({
      startDate: '2026-11-09',
      dueDate: null,
    })
  })

  it('keeps the duration of a ranged task, across a month and DST boundary', () => {
    expect(shiftTaskDates({ startDate: '2026-10-29', dueDate: '2026-11-02' }, 7)).toEqual({
      startDate: '2026-11-05',
      dueDate: '2026-11-09',
    })
  })

  it('returns null for no-ops', () => {
    expect(shiftTaskDates({ startDate: null, dueDate: '2026-11-10' }, 0)).toBeNull()
    expect(shiftTaskDates({ startDate: null, dueDate: null }, 2)).toBeNull()
  })
})
