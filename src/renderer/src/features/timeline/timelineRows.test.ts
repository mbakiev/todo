import { makeTask } from '@shared/test/factories'
import { buildTimelineRows, compareTimelineTasks } from './timelineRows'

describe('timeline rows', () => {
  const a = makeTask({ id: 'a', startDate: '2026-11-10', dueDate: '2026-11-20', priority: 1 })
  const b = makeTask({ id: 'b', dueDate: '2026-11-10', priority: 4, status: 'blocked' })
  const c = makeTask({ id: 'c', dueDate: '2026-11-01', priority: 2 })
  const d = makeTask({ id: 'd', startDate: '2026-11-15', priority: 2, status: 'in_progress' })

  it('sorts by anchor date, then priority desc', () => {
    expect([a, b, c, d].sort(compareTimelineTasks).map((t) => t.id)).toEqual(['c', 'b', 'a', 'd'])
  })

  it('returns flat task rows without grouping', () => {
    const rows = buildTimelineRows([a, b, c, d], 'none')
    expect(rows.every((r) => r.kind === 'task')).toBe(true)
    expect(rows).toHaveLength(4)
  })

  it('groups by status in fixed order, skipping empty groups', () => {
    const rows = buildTimelineRows([a, b, c, d], 'status')
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
    const rows = buildTimelineRows([a, b, c, d], 'priority', new Set(['priority:2']))
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
