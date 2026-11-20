import { localMs, makeTask } from '@shared/test/factories'
import type { Task } from '@shared/types'
import {
  fitWeek,
  itemTitle,
  layoutWeek,
  monthGridRange,
  monthGridWeeks,
  shiftTaskDates,
  weekDays,
  type WeekSegment,
} from './calendarLayout'

/** Thu Nov 19 2026. Only matters for started tasks (ongoing spans end at today). */
const TODAY = '2026-11-19'
const lay = (weekStart: string, tasks: readonly Task[]) => layoutWeek(weekStart, tasks, TODAY)

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
    const { segments, laneCount } = lay(week, [due('a', '2026-11-11')])
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
    expect(lay(week, [t]).segments[0]).toMatchObject({ startCol: 6, kind: 'chip' })
  })

  it('treats start === due as a chip', () => {
    expect(lay(week, [ranged('x', '2026-11-10', '2026-11-10')]).segments[0]?.kind).toBe('chip')
  })

  it('renders ranged tasks as bars and packs non-overlapping ones into the same lane', () => {
    const { segments, laneCount } = lay(week, [
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
    const { segments } = lay(week, [
      due('short', '2026-11-10'),
      ranged('long', '2026-11-10', '2026-11-14'),
    ])
    expect(seg(segments, 'long').lane).toBe(0)
    expect(seg(segments, 'short').lane).toBe(1)
  })

  it('clips multi-week spans and flags continuation on each side', () => {
    const t = ranged('m', '2026-11-04', '2026-11-20')
    const before = lay('2026-11-02', [t]).segments[0]
    const middle = lay('2026-11-09', [t]).segments[0]
    const after = lay('2026-11-16', [t]).segments[0]
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
    const first = lay(weeks[0] ?? '', [t]).segments[0]
    const last = lay(weeks[weeks.length - 1] ?? '', [t]).segments[0]
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
    const { segments } = lay('2026-11-30', [ranged('b', '2026-11-29', '2026-12-02')])
    expect(segments[0]).toMatchObject({
      startCol: 0,
      endCol: 2,
      continuesBefore: true,
      continuesAfter: false,
    })
  })

  it('lays out identically with a Sunday week start', () => {
    const t = ranged('r', '2026-11-14', '2026-11-16') // Sat … Mon
    const sunWeek = lay('2026-11-08', [t]).segments[0]
    const nextSunWeek = lay('2026-11-15', [t]).segments[0]
    expect(sunWeek).toMatchObject({ startCol: 6, endCol: 6, continuesAfter: true, kind: 'bar' })
    expect(nextSunWeek).toMatchObject({ startCol: 0, endCol: 1, continuesBefore: true })
  })

  it('counts columns by calendar days across DST changes', () => {
    const spring = lay('2026-03-02', [ranged('d', '2026-03-07', '2026-03-10')])
    expect(spring.segments[0]).toMatchObject({ startCol: 5, endCol: 6, continuesAfter: true })
    const nextWeek = lay('2026-03-09', [ranged('d', '2026-03-07', '2026-03-10')])
    expect(nextWeek.segments[0]).toMatchObject({ startCol: 0, endCol: 1 })
    const fall = lay('2026-10-26', [
      due('f', '2026-11-01'),
      ranged('g', '2026-10-31', '2026-11-03'),
    ])
    expect(seg(fall.segments, 'f')).toMatchObject({ startCol: 6, endCol: 6 })
    expect(seg(fall.segments, 'g')).toMatchObject({ startCol: 5, endCol: 6, continuesAfter: true })
  })

  it('ignores undated tasks and tasks outside the week', () => {
    const { segments } = lay(week, [
      makeTask({ id: 'none' }),
      due('prev', '2026-11-08'),
      due('next', '2026-11-16'),
    ])
    expect(segments).toEqual([])
  })
})

describe('layoutWeek with started and done tasks (display span)', () => {
  // TODAY is Thu Nov 19 2026; this week runs Mon Nov 16 … Sun Nov 22.
  const week = '2026-11-16'
  const started = (
    id: string,
    status: 'in_progress' | 'blocked',
    startedAt: number,
    extra: Partial<Task> = {},
  ): Task => makeTask({ id, status, startedAt, createdAt: startedAt - 3_600_000, ...extra })
  const done = (id: string, startedAt: number, completedAt: number, extra: Partial<Task> = {}) =>
    makeTask({
      id,
      status: 'done',
      startedAt,
      completedAt,
      createdAt: startedAt - 3_600_000,
      updatedAt: completedAt,
      ...extra,
    })

  it('lays out an undated in-progress task from its start day to today', () => {
    const t = started('ip', 'in_progress', localMs(2026, 11, 17, 10))
    expect(lay(week, [t]).segments).toEqual([
      expect.objectContaining({
        startCol: 1,
        endCol: 3,
        kind: 'bar',
        source: 'actual',
        ongoing: true,
        continuesBefore: false,
        continuesAfter: false,
      }),
    ])
  })

  it('draws a task started today as a chip on today', () => {
    const t = started('now', 'in_progress', localMs(2026, 11, 19, 8))
    expect(lay(week, [t]).segments[0]).toMatchObject({
      startCol: 3,
      endCol: 3,
      kind: 'chip',
      source: 'actual',
      ongoing: true,
    })
  })

  it('runs an in-progress task on to a future due date, ignoring the planned start', () => {
    const t = started('due', 'in_progress', localMs(2026, 11, 17, 10), {
      startDate: '2026-11-20',
      dueDate: '2026-11-25',
    })
    expect(lay(week, [t]).segments[0]).toMatchObject({
      startCol: 1,
      endCol: 6,
      continuesAfter: true,
    })
    expect(lay('2026-11-23', [t]).segments[0]).toMatchObject({
      startCol: 0,
      endCol: 2,
      continuesBefore: true,
      continuesAfter: false,
    })
  })

  it('ends an overdue in-progress task at today, not at its past due date', () => {
    const t = started('late', 'in_progress', localMs(2026, 11, 16, 9), { dueDate: '2026-11-17' })
    expect(lay(week, [t]).segments[0]).toMatchObject({ startCol: 0, endCol: 3 })
  })

  it('lays out blocked tasks like in-progress ones', () => {
    const undated = started('b1', 'blocked', localMs(2026, 11, 18, 9))
    const withDue = started('b2', 'blocked', localMs(2026, 11, 16, 9), { dueDate: '2026-11-21' })
    const { segments } = lay(week, [undated, withDue])
    expect(seg(segments, 'b1')).toMatchObject({
      startCol: 2,
      endCol: 3,
      source: 'actual',
      ongoing: true,
    })
    expect(seg(segments, 'b2')).toMatchObject({ startCol: 0, endCol: 5, ongoing: true })
  })

  it('draws done tasks on the days they actually ran, not their planned dates', () => {
    const t = done('d', localMs(2026, 11, 10, 9), localMs(2026, 11, 12, 17), {
      startDate: '2026-11-02',
      dueDate: '2026-11-04',
    })
    expect(lay('2026-11-02', [t]).segments).toEqual([])
    expect(lay('2026-11-09', [t]).segments[0]).toMatchObject({
      startCol: 1,
      endCol: 3,
      kind: 'bar',
      source: 'actual',
      ongoing: false,
    })
  })

  it('draws a done task started and completed on the same day as a chip', () => {
    const instant = localMs(2026, 11, 18, 14)
    const sameInstant = done('same', instant, instant, { dueDate: '2026-11-25' })
    const sameDay = done('day', localMs(2026, 11, 17, 9), localMs(2026, 11, 17, 15))
    const { segments } = lay(week, [sameInstant, sameDay])
    expect(seg(segments, 'same')).toMatchObject({ startCol: 2, endCol: 2, kind: 'chip' })
    expect(seg(segments, 'day')).toMatchObject({ startCol: 1, endCol: 1, kind: 'chip' })
  })

  it('clips a long-running task to each week and flags the continuation', () => {
    const t = started('long', 'in_progress', localMs(2026, 10, 20, 9))
    expect(lay('2026-10-19', [t]).segments[0]).toMatchObject({
      startCol: 1,
      endCol: 6,
      continuesBefore: false,
      continuesAfter: true,
    })
    expect(lay('2026-11-09', [t]).segments[0]).toMatchObject({
      startCol: 0,
      endCol: 6,
      continuesBefore: true,
      continuesAfter: true,
    })
    expect(lay(week, [t]).segments[0]).toMatchObject({
      startCol: 0,
      endCol: 3,
      continuesBefore: true,
      continuesAfter: false,
    })
    expect(lay('2026-11-23', [t]).segments).toEqual([])
  })

  it('keeps the plan for not_started tasks', () => {
    expect(lay(week, [ranged('p', '2026-11-17', '2026-11-18')]).segments[0]).toMatchObject({
      startCol: 1,
      endCol: 2,
      source: 'planned',
      ongoing: false,
    })
  })

  it('orders equal clipped segments by actual start, not by the plan', () => {
    // Both run Mon … today in this week. The plan would put `planEarly` first; the record
    // says `startedEarly` began first.
    const startedEarly = started('startedEarly', 'in_progress', localMs(2026, 10, 1, 9), {
      startDate: '2026-12-01',
      priority: 1,
    })
    const planEarly = started('planEarly', 'in_progress', localMs(2026, 11, 1, 9), {
      startDate: '2026-09-01',
      priority: 4,
    })
    const { segments } = lay(week, [planEarly, startedEarly])
    expect(seg(segments, 'startedEarly').lane).toBe(0)
    expect(seg(segments, 'planEarly').lane).toBe(1)
  })

  it('breaks a tie on the same actual start day by due date, then priority', () => {
    const at = localMs(2026, 10, 1, 9)
    const laterDue = started('laterDue', 'in_progress', at, { dueDate: '2026-11-30', priority: 4 })
    const soonerDue = started('soonerDue', 'blocked', at, { dueDate: '2026-11-25', priority: 1 })
    const noDueHigh = started('noDueHigh', 'in_progress', at, { priority: 4 })
    const noDueLow = started('noDueLow', 'in_progress', at, { priority: 1 })
    const { segments } = lay(week, [noDueLow, laterDue, noDueHigh, soonerDue])
    expect(
      ['soonerDue', 'laterDue', 'noDueHigh', 'noDueLow'].map((id) => seg(segments, id).lane),
    ).toEqual([0, 1, 2, 3])
  })
})

describe('fitWeek', () => {
  const week = '2026-11-09'

  it('shows everything when the lanes fit', () => {
    // Same day: higher priority gets the lower lane.
    const layout = lay(week, [
      due('b', '2026-11-09', { priority: 1 }),
      due('a', '2026-11-09', { priority: 4 }),
    ])
    const fit = fitWeek(layout, 2)
    expect(fit.pieces).toHaveLength(2)
    expect(fit.hiddenByCol).toEqual([0, 0, 0, 0, 0, 0, 0])
    expect(fit.tasksByCol[0]?.map((t) => t.id)).toEqual(['a', 'b'])
  })

  it('reserves the last row for "+N more" on overflowing days only', () => {
    const layout = lay(week, [
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
    const layout = lay(week, [
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
    const layout = lay(week, [
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
    const fit = fitWeek(lay(week, [due('a', '2026-11-09')]), 0)
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

describe('elapsed columns of ongoing segments', () => {
  // TODAY is Thu Nov 19 2026 (column 3 of the Mon Nov 16 week).
  const blocked = makeTask({
    id: 'k',
    status: 'blocked',
    startedAt: localMs(2026, 11, 7, 9),
    createdAt: localMs(2026, 11, 6, 9),
    dueDate: '2027-01-18',
  })

  it('splits the piece containing today mid-week', () => {
    expect(lay('2026-11-16', [blocked]).segments[0]).toMatchObject({
      startCol: 0,
      endCol: 6,
      elapsedCols: 4,
    })
  })

  it('is fully elapsed before today and zero in future weeks', () => {
    expect(lay('2026-11-09', [blocked]).segments[0]).toMatchObject({ elapsedCols: 7 })
    // Started Sat Nov 7: columns 5–6 of the Nov 2 week, both elapsed.
    expect(lay('2026-11-02', [blocked]).segments[0]).toMatchObject({
      startCol: 5,
      endCol: 6,
      elapsedCols: 2,
    })
    expect(lay('2026-11-23', [blocked]).segments[0]).toMatchObject({ elapsedCols: 0 })
    expect(lay('2027-01-18', [blocked]).segments[0]).toMatchObject({ endCol: 0, elapsedCols: 0 })
  })

  it('counts an ongoing task that ends today as all elapsed', () => {
    const ip = makeTask({
      id: 'ip',
      status: 'in_progress',
      startedAt: localMs(2026, 11, 17, 9),
      createdAt: localMs(2026, 11, 16, 9),
    })
    expect(lay('2026-11-16', [ip]).segments[0]).toMatchObject({
      startCol: 1,
      endCol: 3,
      elapsedCols: 3,
    })
  })

  it('is null for done and planned segments', () => {
    const done = makeTask({
      id: 'd',
      status: 'done',
      startedAt: localMs(2026, 11, 16, 9),
      completedAt: localMs(2026, 11, 18, 9),
      createdAt: localMs(2026, 11, 15, 9),
      updatedAt: localMs(2026, 11, 18, 9),
    })
    const { segments } = lay('2026-11-16', [done, ranged('p', '2026-11-16', '2026-11-22')])
    expect(seg(segments, 'd').elapsedCols).toBeNull()
    expect(seg(segments, 'p').elapsedCols).toBeNull()
  })

  it('recomputes elapsed columns for each piece fitWeek cuts', () => {
    // The blocked bar takes lane 0 Mon–Sun; three chips on Tue push that day into "+N more"
    // with one row, so the bar is cut into Mon and Wed–Sun.
    const layout = lay('2026-11-16', [blocked, due('c1', '2026-11-17'), due('c2', '2026-11-17')])
    const pieces = fitWeek(layout, 1).pieces.filter((p) => p.task.id === 'k')
    expect(pieces.map((p) => [p.startCol, p.endCol, p.elapsedCols])).toEqual([
      [0, 0, 1],
      [2, 6, 2],
    ])
  })
})

describe('itemTitle', () => {
  it('is just the title for a not_started task', () => {
    expect(itemTitle(makeTask({ title: 'Plan it', dueDate: '2026-11-25' }), TODAY)).toBe('Plan it')
  })

  it('appends the record for started and done tasks', () => {
    const ip = makeTask({
      title: 'Write report',
      status: 'in_progress',
      startedAt: localMs(2026, 11, 3, 9),
      createdAt: localMs(2026, 11, 2, 9),
      dueDate: '2026-11-25',
    })
    expect(itemTitle(ip, TODAY)).toMatch(
      /^Write report — Started Nov 3 · in progress .+ · Due Nov 25$/,
    )
    const instant = localMs(2026, 11, 12, 10)
    const done = makeTask({
      title: 'Ship',
      status: 'done',
      startedAt: instant,
      completedAt: instant,
      createdAt: instant - 1000,
      updatedAt: instant,
    })
    expect(itemTitle(done, TODAY)).toBe('Ship — Completed Nov 12')
  })
})
