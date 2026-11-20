import { localMs, makeTask } from './test/factories'
import {
  anchor,
  applyFilter,
  boardColumns,
  buildBoardColumns,
  checklistProgress,
  compareTagsByName,
  dateBadge,
  describeProgress,
  displaySpan,
  filterCalendar,
  filterTimeline,
  filterTodayBoard,
  filterWeekBoard,
  isDueToday,
  isInTodayBoard,
  isInWeekBoard,
  isOverdue,
  sortTasks,
  startedOn,
  taskSpan,
  tagsInDisplayOrder,
  tasksInRange,
  timelineRange,
} from './views'

// 2026-11-13 is a Friday. Mon-start week: 11-09..11-15. Sun-start week: 11-08..11-14.
const TODAY = '2026-11-13'
const MON = { weekStartsOn: 1 as const }
const SUN = { weekStartsOn: 0 as const }

describe('predicates', () => {
  it('anchor prefers startDate', () => {
    expect(anchor({ startDate: '2026-11-01', dueDate: '2026-11-20' })).toBe('2026-11-01')
    expect(anchor({ startDate: null, dueDate: '2026-11-20' })).toBe('2026-11-20')
    expect(anchor({ startDate: null, dueDate: null })).toBeNull()
  })
  it('overdue only when open and due before today', () => {
    expect(isOverdue(makeTask({ dueDate: '2026-11-12' }), TODAY)).toBe(true)
    expect(isOverdue(makeTask({ dueDate: TODAY }), TODAY)).toBe(false)
    expect(isOverdue(makeTask({ dueDate: '2026-11-12', status: 'done' }), TODAY)).toBe(false)
    expect(isOverdue(makeTask({ startDate: '2026-11-01' }), TODAY)).toBe(false)
  })
  it('due today only when open', () => {
    expect(isDueToday(makeTask({ dueDate: TODAY }), TODAY)).toBe(true)
    expect(isDueToday(makeTask({ dueDate: TODAY, status: 'done' }), TODAY)).toBe(false)
    expect(isDueToday(makeTask({ dueDate: '2026-11-14' }), TODAY)).toBe(false)
  })
  it('taskSpan handles single and double dates', () => {
    expect(taskSpan(makeTask())).toBeNull()
    expect(taskSpan(makeTask({ dueDate: '2026-11-20' }))).toEqual({
      start: '2026-11-20',
      end: '2026-11-20',
    })
    expect(taskSpan(makeTask({ startDate: '2026-11-18' }))).toEqual({
      start: '2026-11-18',
      end: '2026-11-18',
    })
    expect(taskSpan(makeTask({ startDate: '2026-11-18', dueDate: '2026-11-20' }))).toEqual({
      start: '2026-11-18',
      end: '2026-11-20',
    })
  })
})

describe('Today board', () => {
  it('includes undated open tasks', () => {
    expect(isInTodayBoard(makeTask(), TODAY)).toBe(true)
  })
  it('uses anchor: only start / only due / both', () => {
    expect(isInTodayBoard(makeTask({ startDate: TODAY }), TODAY)).toBe(true)
    expect(isInTodayBoard(makeTask({ startDate: '2026-11-14' }), TODAY)).toBe(false)
    expect(isInTodayBoard(makeTask({ dueDate: '2026-11-10' }), TODAY)).toBe(true) // overdue
    expect(isInTodayBoard(makeTask({ dueDate: '2026-11-14' }), TODAY)).toBe(false)
    // Started already, due later → visible today.
    expect(
      isInTodayBoard(makeTask({ startDate: '2026-11-10', dueDate: '2026-11-30' }), TODAY),
    ).toBe(true)
    // Starts later even though due later still → hidden.
    expect(
      isInTodayBoard(makeTask({ startDate: '2026-11-20', dueDate: '2026-11-30' }), TODAY),
    ).toBe(false)
  })
  it('done column: completed today only, split at local midnight', () => {
    const doneAt = (ms: number) => makeTask({ status: 'done', completedAt: ms })
    expect(isInTodayBoard(doneAt(localMs(2026, 11, 13, 0, 0, 0, 0)), TODAY)).toBe(true)
    expect(isInTodayBoard(doneAt(localMs(2026, 11, 13, 23, 59, 59, 999)), TODAY)).toBe(true)
    expect(isInTodayBoard(doneAt(localMs(2026, 11, 12, 23, 59, 59, 999)), TODAY)).toBe(false)
    expect(isInTodayBoard(doneAt(localMs(2026, 11, 14, 0, 0, 0, 0)), TODAY)).toBe(false)
  })
  it('done tasks ignore their dates', () => {
    const t = makeTask({
      status: 'done',
      dueDate: '2026-12-01',
      completedAt: localMs(2026, 11, 13, 9),
    })
    expect(isInTodayBoard(t, TODAY)).toBe(true)
  })
  it('done without completedAt is hidden', () => {
    expect(isInTodayBoard(makeTask({ status: 'done', completedAt: null }), TODAY)).toBe(false)
  })
})

describe('Week board', () => {
  it('open tasks anchored up to end of week (Mon start)', () => {
    expect(isInWeekBoard(makeTask({ dueDate: '2026-11-15' }), TODAY, MON)).toBe(true) // Sunday
    expect(isInWeekBoard(makeTask({ dueDate: '2026-11-16' }), TODAY, MON)).toBe(false)
    expect(isInWeekBoard(makeTask({ startDate: '2026-10-01' }), TODAY, MON)).toBe(true)
    expect(isInWeekBoard(makeTask(), TODAY, MON)).toBe(true)
  })
  it('open tasks anchored up to end of week (Sun start)', () => {
    expect(isInWeekBoard(makeTask({ dueDate: '2026-11-14' }), TODAY, SUN)).toBe(true) // Saturday
    expect(isInWeekBoard(makeTask({ dueDate: '2026-11-15' }), TODAY, SUN)).toBe(false)
  })
  it('done this week only (Mon start)', () => {
    const doneAt = (ms: number) => makeTask({ status: 'done', completedAt: ms })
    expect(isInWeekBoard(doneAt(localMs(2026, 11, 9, 0, 0, 0, 0)), TODAY, MON)).toBe(true)
    expect(isInWeekBoard(doneAt(localMs(2026, 11, 8, 23, 59, 59, 999)), TODAY, MON)).toBe(false)
    expect(isInWeekBoard(doneAt(localMs(2026, 11, 8, 12)), TODAY, SUN)).toBe(true)
    expect(isInWeekBoard(doneAt(localMs(2026, 11, 7, 23, 59)), TODAY, SUN)).toBe(false)
  })
  it('on the first day of a week', () => {
    const monday = '2026-11-16'
    const doneSunday = makeTask({ status: 'done', completedAt: localMs(2026, 11, 15, 20) })
    expect(isInWeekBoard(doneSunday, monday, MON)).toBe(false)
    expect(isInWeekBoard(doneSunday, monday, SUN)).toBe(true)
  })
  it('filters a list', () => {
    const tasks = [makeTask({ dueDate: '2026-11-15' }), makeTask({ dueDate: '2026-11-20' })]
    expect(filterWeekBoard(tasks, TODAY, MON)).toHaveLength(1)
    expect(filterTodayBoard(tasks, TODAY)).toHaveLength(0)
  })
})

describe('sorting and columns', () => {
  const a = makeTask({ id: 'a', priority: 3, dueDate: '2026-11-20', createdAt: 1, position: 3 })
  const b = makeTask({ id: 'b', priority: 3, dueDate: null, createdAt: 5, position: 1 })
  const c = makeTask({ id: 'c', priority: 4, dueDate: '2026-12-01', createdAt: 2, position: 2 })
  const d = makeTask({ id: 'd', priority: 3, dueDate: '2026-11-15', createdAt: 3, position: 0 })
  const e = makeTask({ id: 'e', priority: 1, dueDate: '2026-11-15', createdAt: 9, position: 4 })

  it('priority: priority desc, due asc nulls last, newest first', () => {
    expect(sortTasks([a, b, c, d, e], 'priority').map((t) => t.id)).toEqual([
      'c',
      'd',
      'a',
      'b',
      'e',
    ])
  })
  it('due: due asc nulls last, then priority desc', () => {
    expect(sortTasks([a, b, c, d, e], 'due').map((t) => t.id)).toEqual(['d', 'e', 'a', 'c', 'b'])
  })
  it('manual: position asc', () => {
    expect(sortTasks([a, b, c, d, e], 'manual').map((t) => t.id)).toEqual(['d', 'b', 'c', 'a', 'e'])
  })
  it('ties newest first', () => {
    const x = makeTask({ id: 'x', priority: 2, createdAt: 10 })
    const y = makeTask({ id: 'y', priority: 2, createdAt: 20 })
    expect(sortTasks([x, y], 'priority').map((t) => t.id)).toEqual(['y', 'x'])
  })
  it('groups by status and sorts done by completedAt desc', () => {
    const d1 = makeTask({ id: 'd1', status: 'done', completedAt: 100, position: 0 })
    const d2 = makeTask({ id: 'd2', status: 'done', completedAt: 200, position: 1 })
    const ip = makeTask({ id: 'ip', status: 'in_progress' })
    const cols = buildBoardColumns([d1, d2, ip, a], 'priority', 'today')
    expect(cols.done.map((t) => t.id)).toEqual(['d2', 'd1'])
    expect(cols.in_progress.map((t) => t.id)).toEqual(['ip'])
    expect(cols.not_started.map((t) => t.id)).toEqual(['a'])
    expect(cols.blocked).toEqual([])
    // Manual on Today keeps position order in Done…
    expect(buildBoardColumns([d1, d2], 'manual', 'today').done.map((t) => t.id)).toEqual([
      'd1',
      'd2',
    ])
    // …but Everything always sorts Done by completion.
    expect(buildBoardColumns([d1, d2], 'manual', 'everything').done.map((t) => t.id)).toEqual([
      'd2',
      'd1',
    ])
  })
  it('boardColumns combines filter + sort', () => {
    const future = makeTask({ startDate: '2026-12-01' })
    const cols = boardColumns('today', [future, a], TODAY, MON, 'priority')
    expect(cols.not_started).toHaveLength(0) // a is due 11-20, future starts 12-01
    expect(
      boardColumns('everything', [future, a], TODAY, MON, 'priority').not_started,
    ).toHaveLength(2)
  })
})

describe('timeline and calendar', () => {
  const undated = makeTask({ id: 'undated' })
  const overdue = makeTask({ id: 'overdue', dueDate: '2026-10-01' })
  const future = makeTask({ id: 'future', startDate: '2026-12-01', dueDate: '2026-12-10' })
  const onlyStart = makeTask({ id: 'onlyStart', startDate: '2026-11-20' })
  // Planned for 11-10, actually ran 11-08 → 11-11.
  const done = makeTask({
    id: 'done',
    status: 'done',
    dueDate: '2026-11-10',
    startedAt: localMs(2026, 11, 8, 9),
    completedAt: localMs(2026, 11, 11, 17),
  })
  // Undated but in progress since 11-02: must appear.
  const working = makeTask({
    id: 'working',
    status: 'in_progress',
    startedAt: localMs(2026, 11, 2, 10),
  })

  it('timeline: open tasks with a display span sorted by its start; done hidden by default', () => {
    const all = [undated, future, done, onlyStart, overdue, working]
    expect(filterTimeline(all, TODAY).map((t) => t.id)).toEqual([
      'overdue',
      'working',
      'onlyStart',
      'future',
    ])
    expect(filterTimeline(all, TODAY, { showCompleted: true }).map((t) => t.id)).toEqual([
      'overdue',
      'working',
      'done',
      'onlyStart',
      'future',
    ])
  })
  it('timeline: done tasks ending before the range start are left out; open ones never are', () => {
    const ancientDone = makeTask({
      id: 'ancientDone',
      status: 'done',
      startedAt: localMs(2024, 1, 1),
      completedAt: localMs(2024, 1, 5),
    })
    const ancientOpen = makeTask({
      id: 'ancientOpen',
      status: 'in_progress',
      startedAt: localMs(2024, 1, 1),
    })
    const ancientPlan = makeTask({ id: 'ancientPlan', dueDate: '2024-01-01' })
    // Ran before today − 7 but within the look-back: kept, and it pulls the range back.
    const lastMonth = makeTask({
      id: 'lastMonth',
      status: 'done',
      startedAt: localMs(2026, 10, 1),
      completedAt: localMs(2026, 10, 3),
    })
    const ids = filterTimeline([ancientDone, ancientOpen, ancientPlan, lastMonth], TODAY, {
      showCompleted: true,
    }).map((t) => t.id)
    expect(ids).toEqual(['ancientPlan', 'ancientOpen', 'lastMonth'])
  })
  it('timeline: a done task ending inside the range (default look-back) stays', () => {
    const recent = makeTask({
      id: 'recent',
      status: 'done',
      startedAt: localMs(2026, 11, 7),
      completedAt: localMs(2026, 11, 7, 15),
    })
    expect(filterTimeline([recent], TODAY, { showCompleted: true })).toHaveLength(1)
    expect(filterTimeline([recent], TODAY)).toHaveLength(0)
  })
  it('calendar: everything with a display span, done shown by default', () => {
    const all = [undated, future, done, onlyStart, overdue, working]
    expect(filterCalendar(all, TODAY).map((t) => t.id)).toEqual([
      'overdue',
      'working',
      'done',
      'onlyStart',
      'future',
    ])
    expect(filterCalendar(all, TODAY, { showCompleted: false })).toHaveLength(4)
  })
  it('sort ties: due asc, then priority desc', () => {
    const a = makeTask({ id: 'a', startDate: '2026-11-20', dueDate: '2026-11-25' })
    const b = makeTask({ id: 'b', startDate: '2026-11-20', dueDate: '2026-11-22' })
    const c = makeTask({ id: 'c', startDate: '2026-11-20', dueDate: '2026-11-22', priority: 4 })
    expect(filterCalendar([a, b, c], TODAY).map((t) => t.id)).toEqual(['c', 'b', 'a'])
  })
  it('tasksInRange intersects display spans', () => {
    expect(
      tasksInRange([future, onlyStart, overdue], TODAY, '2026-12-05', '2026-12-31').map(
        (t) => t.id,
      ),
    ).toEqual(['future'])
    expect(tasksInRange([future], TODAY, '2026-11-01', '2026-12-01')).toHaveLength(1)
    // done is drawn where it ran (11-08..11-11), not on its planned 11-10 alone.
    expect(tasksInRange([done], TODAY, '2026-11-08', '2026-11-08')).toHaveLength(1)
    expect(tasksInRange([done], TODAY, '2026-11-12', '2026-11-30')).toHaveLength(0)
    // in progress reaches today.
    expect(tasksInRange([working], TODAY, TODAY, TODAY)).toHaveLength(1)
    expect(tasksInRange([working, undated], TODAY, '2026-11-14', '2026-11-30')).toHaveLength(0)
  })
  it('timelineRange: 1 week back, at least 6 weeks forward, extends to latest date', () => {
    expect(timelineRange([], TODAY)).toEqual({ start: '2026-11-06', end: '2026-12-25' })
    const far = makeTask({ dueDate: '2027-03-01' })
    // An old planned (not started) task does not stretch the chart back.
    expect(timelineRange([far, overdue], TODAY)).toEqual({ start: '2026-11-06', end: '2027-03-01' })
  })
  it('timelineRange: reaches back to the earliest actual start, never later than today − 7', () => {
    expect(timelineRange([working], TODAY).start).toBe('2026-11-02')
    expect(timelineRange([working, done], TODAY).start).toBe('2026-11-02')
    // A start inside the default week does not pull the start forward.
    const recent = makeTask({ status: 'blocked', startedAt: localMs(2026, 11, 12) })
    expect(timelineRange([recent], TODAY).start).toBe('2026-11-06')
    // Done history counts too (the view only passes it when Completed is on).
    const oldDone = makeTask({
      status: 'done',
      startedAt: localMs(2026, 9, 1),
      completedAt: localMs(2026, 9, 2),
    })
    expect(timelineRange([oldDone], TODAY).start).toBe('2026-09-01')
  })
  it('timelineRange: look-back capped at TIMELINE_MAX_LOOKBACK_DAYS (365)', () => {
    const ancient = makeTask({ status: 'in_progress', startedAt: localMs(2020, 1, 1) })
    expect(timelineRange([ancient], TODAY).start).toBe('2025-11-13')
    const justInside = makeTask({ status: 'in_progress', startedAt: localMs(2025, 11, 14) })
    expect(timelineRange([justInside], TODAY).start).toBe('2025-11-14')
  })
  it('timelineRange: end follows the latest display-span end', () => {
    const dueLater = makeTask({
      status: 'in_progress',
      startedAt: localMs(2026, 11, 1),
      dueDate: '2027-02-01',
    })
    expect(timelineRange([dueLater], TODAY).end).toBe('2027-02-01')
  })
})

describe('displaySpan', () => {
  it('not_started: the plan (taskSpan), null when undated', () => {
    expect(displaySpan(makeTask(), TODAY)).toBeNull()
    expect(displaySpan(makeTask({ dueDate: '2026-11-20' }), TODAY)).toEqual({
      start: '2026-11-20',
      end: '2026-11-20',
      source: 'planned',
      ongoing: false,
    })
    expect(
      displaySpan(makeTask({ startDate: '2026-11-18', dueDate: '2026-11-25' }), TODAY),
    ).toEqual({ start: '2026-11-18', end: '2026-11-25', source: 'planned', ongoing: false })
  })
  it('in_progress: started day → today, even when undated', () => {
    const t = makeTask({ status: 'in_progress', startedAt: localMs(2026, 11, 3, 9) })
    expect(displaySpan(t, TODAY)).toEqual({
      start: '2026-11-03',
      end: TODAY,
      source: 'actual',
      ongoing: true,
    })
  })
  it('in_progress: the planned startDate is superseded by the actual start', () => {
    const t = makeTask({
      status: 'in_progress',
      startDate: '2026-11-10',
      startedAt: localMs(2026, 11, 3),
    })
    expect(displaySpan(t, TODAY)?.start).toBe('2026-11-03')
  })
  it('due in the future extends the end; due in the past stops at today', () => {
    const base = { status: 'in_progress' as const, startedAt: localMs(2026, 11, 3) }
    expect(displaySpan(makeTask({ ...base, dueDate: '2026-11-25' }), TODAY)?.end).toBe('2026-11-25')
    expect(displaySpan(makeTask({ ...base, dueDate: '2026-11-05' }), TODAY)?.end).toBe(TODAY)
    expect(displaySpan(makeTask({ ...base, dueDate: TODAY }), TODAY)?.end).toBe(TODAY)
  })
  it('blocked: same geometry as in progress', () => {
    const t = makeTask({
      status: 'blocked',
      startedAt: localMs(2026, 11, 3),
      dueDate: '2026-12-01',
    })
    expect(displaySpan(t, TODAY)).toEqual({
      start: '2026-11-03',
      end: '2026-12-01',
      source: 'actual',
      ongoing: true,
    })
  })
  it('done: started day → completed day, ignoring the plan', () => {
    const t = makeTask({
      status: 'done',
      startDate: '2026-12-01',
      dueDate: '2026-12-05',
      startedAt: localMs(2026, 11, 3, 9),
      completedAt: localMs(2026, 11, 12, 18),
    })
    expect(displaySpan(t, TODAY)).toEqual({
      start: '2026-11-03',
      end: '2026-11-12',
      source: 'actual',
      ongoing: false,
    })
  })
  it('done with start == completed is a one-day span', () => {
    const at = localMs(2026, 11, 12, 23, 59)
    const t = makeTask({ status: 'done', startedAt: at, completedAt: at })
    expect(displaySpan(t, TODAY)).toMatchObject({ start: '2026-11-12', end: '2026-11-12' })
  })
  it('local dates: a late-evening start is that local day (TZ America/New_York)', () => {
    const t = makeTask({ status: 'in_progress', startedAt: localMs(2026, 11, 3, 23, 30) })
    expect(displaySpan(t, TODAY)?.start).toBe('2026-11-03')
  })
  it('legacy started rows without startedAt still get a span', () => {
    const createdAt = localMs(2026, 11, 1)
    for (const status of ['in_progress', 'blocked'] as const) {
      expect(displaySpan(makeTask({ status, startedAt: null, createdAt }), TODAY)).toEqual({
        start: '2026-11-01',
        end: TODAY,
        source: 'actual',
        ongoing: true,
      })
    }
    expect(
      displaySpan(
        makeTask({ status: 'done', startedAt: null, completedAt: localMs(2026, 11, 9) }),
        TODAY,
      ),
    ).toEqual({ start: '2026-11-09', end: '2026-11-09', source: 'actual', ongoing: false })
    // Done without even a completedAt falls back to updatedAt.
    expect(
      displaySpan(
        makeTask({
          status: 'done',
          startedAt: null,
          completedAt: null,
          updatedAt: localMs(2026, 11, 7),
        }),
        TODAY,
      ),
    ).toMatchObject({ start: '2026-11-07', end: '2026-11-07' })
  })
  it('clamps end >= start (start in the future after a clock / time-zone change)', () => {
    const t = makeTask({ status: 'in_progress', startedAt: localMs(2026, 11, 20) })
    expect(displaySpan(t, TODAY)).toMatchObject({ start: '2026-11-20', end: '2026-11-20' })
    const d = makeTask({
      status: 'done',
      startedAt: localMs(2026, 11, 12),
      completedAt: localMs(2026, 11, 10),
    })
    const span = displaySpan(d, TODAY)
    expect(span?.end !== undefined && span.start <= span.end).toBe(true)
  })
  it('startedOn: local date of the effective start, null when not started', () => {
    expect(startedOn(makeTask())).toBeNull()
    expect(startedOn(makeTask({ status: 'blocked', startedAt: localMs(2026, 11, 3, 0, 5) }))).toBe(
      '2026-11-03',
    )
    expect(startedOn(makeTask({ status: 'in_progress', createdAt: localMs(2026, 10, 30) }))).toBe(
      '2026-10-30',
    )
  })
})

describe('describeProgress', () => {
  const NOW = localMs(2026, 11, 13, 15)
  it('not started: no lines (callers keep their plan wording)', () => {
    expect(describeProgress(makeTask({ dueDate: '2026-11-20' }), TODAY, NOW)).toEqual([])
  })
  it('in progress, with due / overdue / due-today / undated', () => {
    const base = { status: 'in_progress' as const, startedAt: localMs(2026, 11, 3, 9) }
    expect(describeProgress(makeTask(base), TODAY, NOW)).toEqual([
      'Started Nov 3 · in progress 10 days',
    ])
    expect(describeProgress(makeTask({ ...base, dueDate: '2026-11-25' }), TODAY, NOW)).toEqual([
      'Started Nov 3 · in progress 10 days',
      'Due Nov 25',
    ])
    expect(describeProgress(makeTask({ ...base, dueDate: '2026-11-10' }), TODAY, NOW)).toEqual([
      'Started Nov 3 · in progress 10 days',
      'Overdue · was due Nov 10',
    ])
    expect(describeProgress(makeTask({ ...base, dueDate: TODAY }), TODAY, NOW)).toEqual([
      'Started Nov 3 · in progress 10 days',
      'Due today',
    ])
  })
  it('in progress for a few hours', () => {
    const t = makeTask({ status: 'in_progress', startedAt: localMs(2026, 11, 13, 11, 40) })
    expect(describeProgress(t, TODAY, NOW)).toEqual(['Started Nov 13 · in progress 3 h 20 min'])
  })
  it('blocked', () => {
    const t = makeTask({
      status: 'blocked',
      startedAt: localMs(2026, 11, 3, 9),
      dueDate: '2026-11-25',
    })
    expect(describeProgress(t, TODAY, NOW)).toEqual([
      'Blocked · started Nov 3 · 10 days',
      'Due Nov 25',
    ])
  })
  it('done across days, same day, and zero length', () => {
    expect(
      describeProgress(
        makeTask({
          status: 'done',
          startedAt: localMs(2026, 11, 3, 9),
          completedAt: localMs(2026, 11, 12, 9),
        }),
        TODAY,
        NOW,
      ),
    ).toEqual(['Nov 3 – Nov 12 · took 9 days'])
    expect(
      describeProgress(
        makeTask({
          status: 'done',
          startedAt: localMs(2026, 11, 12, 9),
          completedAt: localMs(2026, 11, 12, 12, 20),
        }),
        TODAY,
        NOW,
      ),
    ).toEqual(['Nov 12 · took 3 h 20 min'])
    const at = localMs(2026, 11, 12, 9)
    expect(
      describeProgress(makeTask({ status: 'done', startedAt: at, completedAt: at }), TODAY, NOW),
    ).toEqual(['Completed Nov 12'])
  })
  it('years outside the current one are spelled out', () => {
    const t = makeTask({
      status: 'done',
      startedAt: localMs(2025, 12, 30),
      completedAt: localMs(2026, 1, 2),
    })
    expect(describeProgress(t, TODAY, NOW)).toEqual(['Dec 30, 2025 – Jan 2 · took 3 days'])
  })
  it('legacy rows use the effective start', () => {
    const t = makeTask({
      status: 'in_progress',
      startedAt: null,
      createdAt: localMs(2026, 11, 3, 15),
    })
    expect(describeProgress(t, TODAY, NOW)).toEqual(['Started Nov 3 · in progress 10 days'])
    const d = makeTask({ status: 'done', startedAt: null, completedAt: localMs(2026, 11, 12) })
    expect(describeProgress(d, TODAY, NOW)).toEqual(['Completed Nov 12'])
  })
})

describe('filter bar', () => {
  const t1 = makeTask({
    id: '1',
    title: 'Reply to Anna',
    description: 'about the **budget**',
    tagIds: ['work'],
    priority: 3,
  })
  const t2 = makeTask({ id: '2', title: 'Buy milk', tagIds: ['home'], priority: 1 })
  const t3 = makeTask({ id: '3', title: 'File ticket', tagIds: ['work', 'ops'], priority: 4 })

  it('empty filter returns everything', () => {
    expect(applyFilter([t1, t2, t3], { text: '  ', tagIds: [], priorities: [] })).toHaveLength(3)
  })
  it('text matches title and description, case-insensitive, all terms', () => {
    expect(
      applyFilter([t1, t2, t3], { text: 'BUDGET', tagIds: [], priorities: [] }).map((t) => t.id),
    ).toEqual(['1'])
    expect(
      applyFilter([t1, t2, t3], { text: 'reply budget', tagIds: [], priorities: [] }).map(
        (t) => t.id,
      ),
    ).toEqual(['1'])
    expect(
      applyFilter([t1, t2, t3], { text: 'reply milk', tagIds: [], priorities: [] }),
    ).toHaveLength(0)
  })
  it('tags match any; priorities match any; combined with AND', () => {
    expect(
      applyFilter([t1, t2, t3], { text: '', tagIds: ['ops', 'home'], priorities: [] }).map(
        (t) => t.id,
      ),
    ).toEqual(['2', '3'])
    expect(
      applyFilter([t1, t2, t3], { text: '', tagIds: ['work'], priorities: [4] }).map((t) => t.id),
    ).toEqual(['3'])
    expect(
      applyFilter([t1, t2, t3], { text: '', tagIds: [], priorities: [1, 3] }).map((t) => t.id),
    ).toEqual(['1', '2'])
  })
})

describe('checklistProgress', () => {
  it('counts GFM task items', () => {
    expect(checklistProgress('nothing here')).toBeNull()
    expect(
      checklistProgress('- [ ] a\n- [x] b\n  * [X] nested\n1. [ ] numbered\n- not a task'),
    ).toEqual({ done: 2, total: 4 })
  })
})

describe('tag display order', () => {
  const tag = (id: string, name: string) => ({ id, name })
  const byId = {
    z1: tag('z1', 'zeta'),
    a1: tag('a1', 'Alpha'),
    b1: tag('b1', 'beta'),
    b0: tag('b0', 'Beta'),
  }
  it('is alphabetical, case-insensitive, whatever order the ids come in', () => {
    const names = (ids: string[]) => tagsInDisplayOrder(ids, byId).map((t) => t.id)
    expect(names(['z1', 'b1', 'a1'])).toEqual(['a1', 'b1', 'z1'])
    expect(names(['a1', 'z1', 'b1'])).toEqual(['a1', 'b1', 'z1'])
    // Same name in another case: ties broken by id, so the order is stable between runs.
    expect(names(['b1', 'b0'])).toEqual(['b0', 'b1'])
    expect(names(['b0', 'b1'])).toEqual(['b0', 'b1'])
  })
  it('skips unknown ids', () => {
    expect(tagsInDisplayOrder(['gone', 'a1'], byId).map((t) => t.id)).toEqual(['a1'])
  })
  it('sorts plain names too (quick-add chips)', () => {
    expect(['Work', 'home', 'Errands'].map((name) => ({ name })).sort(compareTagsByName)).toEqual([
      { name: 'Errands' },
      { name: 'home' },
      { name: 'Work' },
    ])
  })
})

describe('dateBadge', () => {
  it('prefers the due date; a start-only task shows its start', () => {
    expect(dateBadge({ startDate: '2026-11-10', dueDate: '2026-11-20' })).toEqual({
      kind: 'due',
      date: '2026-11-20',
    })
    expect(dateBadge({ startDate: '2026-11-10', dueDate: null })).toEqual({
      kind: 'start',
      date: '2026-11-10',
    })
    expect(dateBadge({ startDate: null, dueDate: null })).toBeNull()
  })
})
