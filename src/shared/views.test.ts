import { localMs, makeTask } from './test/factories'
import {
  anchor,
  applyFilter,
  boardColumns,
  buildBoardColumns,
  checklistProgress,
  filterCalendar,
  filterTimeline,
  filterTodayBoard,
  filterWeekBoard,
  isDueToday,
  isInTodayBoard,
  isInWeekBoard,
  isOverdue,
  sortTasks,
  taskSpan,
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
  const done = makeTask({ id: 'done', status: 'done', dueDate: '2026-11-10', completedAt: 1 })

  it('timeline: open dated tasks sorted by anchor; done hidden by default', () => {
    const all = [undated, future, done, onlyStart, overdue]
    expect(filterTimeline(all).map((t) => t.id)).toEqual(['overdue', 'onlyStart', 'future'])
    expect(filterTimeline(all, { showCompleted: true }).map((t) => t.id)).toEqual([
      'overdue',
      'done',
      'onlyStart',
      'future',
    ])
  })
  it('calendar: all dated tasks, done shown by default', () => {
    const all = [undated, future, done, onlyStart, overdue]
    expect(filterCalendar(all)).toHaveLength(4)
    expect(filterCalendar(all, { showCompleted: false })).toHaveLength(3)
  })
  it('tasksInRange intersects spans', () => {
    expect(
      tasksInRange([future, onlyStart, overdue], '2026-12-05', '2026-12-31').map((t) => t.id),
    ).toEqual(['future'])
    expect(tasksInRange([future], '2026-11-01', '2026-12-01')).toHaveLength(1)
  })
  it('timelineRange: 1 week back, at least 6 weeks forward, extends to latest date', () => {
    expect(timelineRange([], TODAY)).toEqual({ start: '2026-11-06', end: '2026-12-25' })
    const far = makeTask({ dueDate: '2027-03-01' })
    expect(timelineRange([far, overdue], TODAY)).toEqual({ start: '2026-11-06', end: '2027-03-01' })
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
