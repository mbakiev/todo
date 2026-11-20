import { localMs, makeTask } from '@shared/test/factories'
import {
  buildTimelineRows,
  compareTimelineTasks,
  firstRecentRowIndex,
  rowOffset,
  type TimelineRow,
} from './timelineRows'

const TODAY = '2026-11-13'

describe('timeline rows', () => {
  const a = makeTask({ id: 'a', startDate: '2026-11-10', dueDate: '2026-11-20', priority: 1 })
  const b = makeTask({
    id: 'b',
    dueDate: '2026-11-10',
    priority: 4,
    status: 'blocked',
    startedAt: localMs(2026, 11, 9),
  })
  const c = makeTask({ id: 'c', dueDate: '2026-11-01', priority: 2 })
  const d = makeTask({
    id: 'd',
    startDate: '2026-11-15',
    priority: 2,
    status: 'in_progress',
    startedAt: localMs(2026, 11, 12),
  })

  it('sorts by display-span start, then priority desc', () => {
    expect([a, b, c, d].sort(compareTimelineTasks(TODAY)).map((t) => t.id)).toEqual([
      'c',
      'b',
      'a',
      'd',
    ])
  })

  it('sorts started work by when it really started, not by its plan', () => {
    // Planned to start on the 20th, actually started on the 2nd.
    const early = makeTask({
      id: 'early',
      startDate: '2026-11-20',
      status: 'in_progress',
      startedAt: localMs(2026, 11, 2),
    })
    // No plan at all, started on the 11th.
    const undated = makeTask({
      id: 'undated',
      status: 'in_progress',
      startedAt: localMs(2026, 11, 11),
    })
    // Done: drawn from its start on the 4th, whatever the plan said.
    const done = makeTask({
      id: 'done',
      status: 'done',
      dueDate: '2026-11-30',
      startedAt: localMs(2026, 11, 4),
      completedAt: localMs(2026, 11, 5),
    })
    const ids = [a, b, c, d, early, undated, done]
      .sort(compareTimelineTasks(TODAY))
      .map((t) => t.id)
    expect(ids).toEqual(['c', 'early', 'done', 'b', 'a', 'undated', 'd'])
  })

  it('breaks start ties by priority desc, then due asc, then oldest first', () => {
    const p1 = makeTask({ id: 'p1', dueDate: '2026-11-14', priority: 1 })
    const p3 = makeTask({ id: 'p3', dueDate: '2026-11-14', priority: 3 })
    const x = makeTask({ id: 'x', startDate: '2026-11-14', dueDate: '2026-11-20', createdAt: 2 })
    const y = makeTask({ id: 'y', startDate: '2026-11-14', dueDate: '2026-11-18', createdAt: 3 })
    const z = makeTask({ id: 'z', startDate: '2026-11-14', dueDate: '2026-11-18', createdAt: 1 })
    expect([p1, x, y, p3, z].sort(compareTimelineTasks(TODAY)).map((t) => t.id)).toEqual([
      'p3',
      'z',
      'y',
      'x',
      'p1',
    ])
  })

  it('returns flat task rows without grouping', () => {
    const rows = buildTimelineRows([a, b, c, d], TODAY, 'none')
    expect(rows.every((r) => r.kind === 'task')).toBe(true)
    expect(rows).toHaveLength(4)
  })

  it('groups by status in fixed order, skipping empty groups', () => {
    const rows = buildTimelineRows([a, b, c, d], TODAY, 'status')
    expect(rows.map((r) => (r.kind === 'group' ? `#${r.label}:${r.count}` : r.task.id))).toEqual([
      '#Not Started:2',
      'c',
      'a',
      '#In Progress:1',
      'd',
      '#Blocked:1',
      'b',
    ])
  })

  it('groups by priority (highest first) and hides collapsed groups', () => {
    const rows = buildTimelineRows([a, b, c, d], TODAY, 'priority', new Set(['priority:2']))
    expect(rows.map((r) => (r.kind === 'group' ? `#${r.label}` : r.task.id))).toEqual([
      '#Critical',
      'b',
      '#Medium',
      '#Low',
      'a',
    ])
    const medium = rows.find((r) => r.kind === 'group' && r.key === 'priority:2')
    expect(medium).toMatchObject({ collapsed: true, count: 2 })
  })
})

describe('first recent row (vertical positioning)', () => {
  const done = (id: string, day: number, priority: 1 | 2 | 3 | 4 = 2) =>
    makeTask({
      id,
      status: 'done',
      priority,
      startedAt: localMs(2026, 11, day, 9),
      completedAt: localMs(2026, 11, day, 10),
    })
  const old1 = done('old1', 1)
  const old2 = done('old2', 5) // ends Nov 5: before today − 7 (Nov 6)
  const recent = done('recent', 6) // ends exactly on today − 7
  const open = makeTask({ id: 'open', dueDate: '2026-11-20' })

  it('skips history that ends before today − 7', () => {
    const rows = buildTimelineRows([old1, old2, recent, open], TODAY, 'none')
    expect(firstRecentRowIndex(rows, TODAY)).toBe(2)
  })

  it('stops at open work even when it ends long ago (overdue stays in sight)', () => {
    const overdue = makeTask({ id: 'overdue', dueDate: '2026-10-01' })
    const rows = buildTimelineRows([old1, overdue, recent], TODAY, 'none')
    expect(rows.map((r) => (r.kind === 'task' ? r.task.id : ''))).toEqual([
      'overdue',
      'old1',
      'recent',
    ])
    expect(firstRecentRowIndex(rows, TODAY)).toBe(0)
  })

  it('brings the group header along when the row is first in its group', () => {
    const rows = buildTimelineRows(
      [done('crit-old', 1, 4), done('crit-recent', 10, 4), done('low-old', 2, 1)],
      TODAY,
      'priority',
    )
    // #Critical, crit-old, crit-recent, #Low, low-old
    expect(firstRecentRowIndex(rows, TODAY)).toBe(2)
    const rows2 = buildTimelineRows([done('crit-old', 1, 4), done('low', 10, 1)], TODAY, 'priority')
    // #Critical, crit-old, #Low, low
    expect(firstRecentRowIndex(rows2, TODAY)).toBe(2)
  })

  it('is 0 when nothing qualifies or there are no rows', () => {
    expect(firstRecentRowIndex(buildTimelineRows([old1, old2], TODAY, 'none'), TODAY)).toBe(0)
    expect(firstRecentRowIndex([], TODAY)).toBe(0)
  })

  it('measures row offsets from fixed heights', () => {
    const rows: TimelineRow[] = buildTimelineRows([old1, open], TODAY, 'status')
    // #Not Started, open, #Done, old1
    const h = { task: 32, group: 30 }
    expect(rowOffset(rows, 0, h)).toBe(0)
    expect(rowOffset(rows, 2, h)).toBe(30 + 32)
    expect(rowOffset(rows, 3, h)).toBe(30 + 32 + 30)
    expect(rowOffset(rows, 99, h)).toBe(30 + 32 + 30 + 32)
  })
})
